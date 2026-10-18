import { FSWatcher, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { findParts } from '@shared/scad'
import type { ChatMessage, CliAgent, HistoryEntry, Operation, ProjectState, VectorArtwork } from '@shared/types'
import { read3mf, readStl, safeName, writeBinaryStl } from './mesh'

export const MODEL_FILE = 'model.scad'
const HISTORY_LIMIT = 300

interface ProjectMeta {
  ops: Operation[]
  part: string
}

interface ChatStore {
  messages: ChatMessage[]
  claudeSessionId?: string
  agentSessions?: Partial<Record<CliAgent, string>>
  openrouterTranscript?: unknown[]
}

export const studioDir = (dir: string): string => join(dir, '.studio')
const metaFile = (dir: string): string => join(studioDir(dir), 'project.json')
const historyDir = (dir: string): string => join(studioDir(dir), 'history')
const historyIndex = (dir: string): string => join(historyDir(dir), 'index.json')
const chatFile = (dir: string): string => join(studioDir(dir), 'chat.json')
export const assetsDir = (dir: string): string => join(dir, 'assets')

const NEW_MODEL_TEMPLATE = ''

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function ensureLayout(dir: string): void {
  mkdirSync(historyDir(dir), { recursive: true })
  mkdirSync(assetsDir(dir), { recursive: true })
  const gitignore = join(studioDir(dir), '.gitignore')
  if (!existsSync(gitignore)) writeFileSync(gitignore, '*.stl\nview.png\nattachments/\n')
}

export function isProject(dir: string): boolean {
  return existsSync(join(dir, MODEL_FILE))
}

export function createProject(dir: string, code = NEW_MODEL_TEMPLATE): void {
  mkdirSync(dir, { recursive: true })
  ensureLayout(dir)
  if (!existsSync(join(dir, MODEL_FILE))) writeFileSync(join(dir, MODEL_FILE), code)
  snapshot(dir, 'Project created', 'import')
}

export function loadProject(dir: string): ProjectState {
  ensureLayout(dir)
  const code = readFileSync(join(dir, MODEL_FILE), 'utf8')
  const meta = readJson<ProjectMeta>(metaFile(dir), { ops: [], part: '' })
  const { parts, defaultPart } = findParts(code)
  const part = meta.part && parts.includes(meta.part) ? meta.part : defaultPart
  return {
    dir,
    name: basename(dir),
    code,
    ops: meta.ops ?? [],
    parts,
    part,
    assets: listAssets(dir),
    history: listHistory(dir)
  }
}

export function listAssets(dir: string): string[] {
  try {
    return readdirSync(assetsDir(dir)).filter((name) => /\.(stl|3mf|svg|dxf|png|scad)$/i.test(name))
  } catch {
    return []
  }
}

export function writeCode(dir: string, code: string): void {
  writeFileSync(join(dir, MODEL_FILE), code)
  markOwnWrite(dir, code)
}

export function readCode(dir: string): string {
  return readFileSync(join(dir, MODEL_FILE), 'utf8')
}

export function saveMeta(dir: string, meta: ProjectMeta): void {
  writeFileSync(metaFile(dir), JSON.stringify(meta, null, 2))
}

export function listHistory(dir: string): HistoryEntry[] {
  return readJson<HistoryEntry[]>(historyIndex(dir), [])
}

export function snapshot(dir: string, label: string, source: HistoryEntry['source']): HistoryEntry[] {
  ensureLayout(dir)
  const code = readCode(dir)
  const history = listHistory(dir)
  const last = history[history.length - 1]
  if (last && existsSync(join(historyDir(dir), `${last.id}.scad`))) {
    if (readFileSync(join(historyDir(dir), `${last.id}.scad`), 'utf8') === code) return history
  }
  const entry: HistoryEntry = { id: `${Date.now()}`, label, createdAt: Date.now(), source }
  writeFileSync(join(historyDir(dir), `${entry.id}.scad`), code)
  history.push(entry)
  while (history.length > HISTORY_LIMIT) {
    const removed = history.shift()
    if (removed) rmSync(join(historyDir(dir), `${removed.id}.scad`), { force: true })
  }
  writeFileSync(historyIndex(dir), JSON.stringify(history, null, 2))
  return history
}

export function historyCode(dir: string, id: string): string {
  return readFileSync(join(historyDir(dir), `${id}.scad`), 'utf8')
}

export function loadChat(dir: string): ChatStore {
  return readJson<ChatStore>(chatFile(dir), { messages: [] })
}

export function saveChat(dir: string, store: ChatStore): void {
  writeFileSync(chatFile(dir), JSON.stringify(store, null, 2))
}

export interface ImportedMesh {
  file: string
  moduleName: string
  color?: string
}

export function importMeshFile(dir: string, filePath: string): ImportedMesh[] {
  ensureLayout(dir)
  const extension = extname(filePath).toLowerCase()
  const data = new Uint8Array(readFileSync(filePath))
  const used = new Set(listAssets(dir).map((name) => name.replace(/\.[^.]+$/, '')))
  const uniqueName = (base: string): string => {
    let name = base
    let suffix = 2
    while (used.has(name)) name = `${base}-${suffix++}`
    used.add(name)
    return name
  }
  if (extension === '.stl') {
    const name = uniqueName(safeName(basename(filePath)))
    copyFileSync(filePath, join(assetsDir(dir), `${name}.stl`))
    readStl(data)
    return [{ file: `assets/${name}.stl`, moduleName: moduleNameFor(name) }]
  }
  if (extension === '.3mf') {
    const meshes = read3mf(data)
    if (!meshes.length) throw new Error('No printable objects were found in this 3MF file.')
    return meshes.map((mesh) => {
      const name = uniqueName(mesh.name)
      writeFileSync(join(assetsDir(dir), `${name}.stl`), writeBinaryStl(mesh.triangles))
      return { file: `assets/${name}.stl`, moduleName: moduleNameFor(name), color: mesh.color }
    })
  }
  throw new Error(`Unsupported file type: ${extension}`)
}

const moduleNameFor = (name: string): string => {
  const cleaned = name.replace(/[^\w]/g, '_')
  return /^\d/.test(cleaned) ? `mesh_${cleaned}` : cleaned
}

const meshCall = (mesh: ImportedMesh): string => (mesh.color ? `color("${mesh.color}") ${mesh.moduleName}();` : `${mesh.moduleName}();`)

export function codeForImportedMeshes(meshes: ImportedMesh[]): string {
  const modules = meshes.map((mesh) => `module ${mesh.moduleName}() { import("${mesh.file}"); }`).join('\n')
  if (meshes.length === 1) return `${modules}\n\n${meshCall(meshes[0])}\n`
  const switches = meshes.map((mesh) => `if (part == "all" || part == "${mesh.moduleName}") ${meshCall(mesh)}`).join('\n')
  return `part = "all";\n\n${modules}\n\n${switches}\n`
}

export function appendImportedMeshes(code: string, meshes: ImportedMesh[]): string {
  const modules = meshes.map((mesh) => `module ${mesh.moduleName}() { import("${mesh.file}"); }`).join('\n')
  const calls = meshes.map(meshCall).join('\n')
  return `${code.trimEnd()}\n\n${modules}\n${calls}\n`
}

const ARTWORK_PREFIX = '__ART__'
const PX_TO_MM = 25.4 / 96

export function importArtwork(dir: string, artwork: VectorArtwork): { code: string; summary: string } {
  ensureLayout(dir)
  const used = new Set(listAssets(dir).map((name) => name.replace(/\.[^.]+$/, '')))
  const base = safeName(artwork.fileName.replace(/\.svg$/i, ''))
  let name = base
  let suffix = 2
  while (used.has(name)) name = `${base}-${suffix++}`
  const prefix = moduleNameFor(name)
  writeFileSync(join(assetsDir(dir), `${name}.scad`), artwork.library.split(ARTWORK_PREFIX).join(prefix))
  const naturalWidth = artwork.width * PX_TO_MM
  const width = Math.round(Math.min(Math.max(naturalWidth, 80), 150))
  const height = Math.round((width * artwork.height) / artwork.width)
  const calls = artwork.colors.map(({ color, module }) => `    color("${color}") linear_extrude(${prefix}_thickness) scale(s) ${prefix}_${module}();`)
  const code = [
    `use <assets/${name}.scad>`,
    '',
    `${prefix}_width = ${width};`,
    `${prefix}_thickness = 3;`,
    '',
    `module ${prefix}() {`,
    `    s = ${prefix}_width / ${Math.round(artwork.width * 1000) / 1000};`,
    ...calls,
    `}`,
    '',
    `${prefix}();`,
    ''
  ].join('\n')
  const colours = artwork.colors.map(({ color, module }) => `${prefix}_${module}() is ${color}`).join(', ')
  const summary =
    `The SVG file "${artwork.fileName}" was converted exactly into 3D (no tracing or redrawing) and added to model.scad as the module ${prefix}(), ` +
    `${width} x ${height} mm and ${prefix}_thickness mm thick. assets/${name}.scad holds the exact 2D artwork: one module per colour (${colours}), ` +
    `all at the same scale, already cut so colours never overlap, plus ${prefix}_outline() for the whole silhouette. ` +
    `Build on these modules (scale them with s = ${prefix}_width / ${Math.round(artwork.width * 1000) / 1000}) instead of redrawing the artwork; do not edit the asset file.` +
    (artwork.warnings.length ? ` Notes from the conversion: ${artwork.warnings.join(' ')}` : '')
  return { code, summary }
}

const lastOwnWrite = new Map<string, string>()

function markOwnWrite(dir: string, code: string): void {
  lastOwnWrite.set(dir, code)
}

let watcher: FSWatcher | null = null
let watchTimer: NodeJS.Timeout | null = null

export function watchModel(dir: string, onExternalChange: (code: string) => void): void {
  watcher?.close()
  lastOwnWrite.set(dir, readCode(dir))
  try {
    watcher = watch(dir, (_event, filename) => {
      if (filename && filename.toString() !== MODEL_FILE) return
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(() => {
        let code: string
        try {
          code = readCode(dir)
        } catch {
          return
        }
        if (code === lastOwnWrite.get(dir)) return
        lastOwnWrite.set(dir, code)
        onExternalChange(code)
      }, 150)
    })
  } catch {
    watcher = null
  }
}

export function stopWatching(): void {
  watcher?.close()
  watcher = null
}

export function undoTarget(dir: string): HistoryEntry | null {
  const current = readCode(dir)
  const entries = listHistory(dir).filter((entry) => entry.source !== 'restore')
  const codes = entries.map((entry) => {
    try {
      return historyCode(dir, entry.id)
    } catch {
      return null
    }
  })
  let index = codes.lastIndexOf(current)
  if (index === -1) index = entries.length
  for (let candidate = index - 1; candidate >= 0; candidate--) {
    if (codes[candidate] !== null && codes[candidate] !== current) return entries[candidate]
  }
  return null
}

export function uniqueProjectFolder(root: string, name: string): string {
  const base = name.replace(/[<>:"/\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || 'New part'
  let candidate = join(root, base)
  let suffix = 2
  while (existsSync(candidate)) candidate = join(root, `${base} ${suffix++}`)
  return candidate
}
