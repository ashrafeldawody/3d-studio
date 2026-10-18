import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { strToU8, zipSync } from 'fflate'
import type { SlicerApp, SlicerExportRequest, SlicerPresetList } from '@shared/types'
import { SLICER_APP_LABEL } from '@shared/types'
import { CONTENT_TYPES_XML, RELS_XML, Triangle, Vec3, escapeXml, meshXml } from './mesh'

const META_KEYS = new Set(['name', 'inherits', 'from', 'instantiation', 'setting_id', 'type', 'description', 'renamed_from', 'is_custom_defined'])
const SKIPPED_FILAMENT_KEYS = new Set(['compatible_printers', 'compatible_prints', 'compatible_printers_condition', 'compatible_prints_condition'])
const PLATE_GAP = 6
const APP_ORDER: SlicerApp[] = ['bambu', 'snapmaker', 'orca']
const FALLBACK: Record<SlicerApp, SlicerApp[]> = {
  bambu: ['bambu', 'orca', 'snapmaker'],
  snapmaker: ['snapmaker', 'orca', 'bambu'],
  orca: ['orca', 'snapmaker', 'bambu']
}
const ROAMING: Record<SlicerApp, string> = {
  bambu: 'BambuStudio',
  snapmaker: 'Snapmaker_Orca',
  orca: 'OrcaSlicer'
}
const INSTALL_NAMES: Record<SlicerApp, string[]> = {
  bambu: ['Bambu Studio'],
  snapmaker: ['Snapmaker Orca', 'SnapmakerOrca'],
  orca: ['OrcaSlicer']
}

type Preset = Record<string, unknown>

interface LoadedPresets {
  source: SlicerApp | null
  presets: Map<string, Preset>
}

const presetCache = new Map<SlicerApp, { signature: string; presets: Map<string, Preset> }>()
let session: { app: SlicerApp; source: SlicerApp | null; presets: Map<string, Preset> } | null = null

function walkJson(dir: string, output: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    let info: ReturnType<typeof statSync>
    try {
      info = statSync(path)
    } catch {
      continue
    }
    if (info.isDirectory()) walkJson(path, output)
    else if (name.endsWith('.json')) output.push(path)
  }
}

function rootSignature(roots: string[]): string {
  return roots.map((root) => `${root}:${existsSync(root) ? statSync(root).mtimeMs : 0}`).join('|')
}

function presetRoots(source: SlicerApp): { base: string[]; user: string[] } {
  const appData = app.getPath('appData')
  const local = process.env.LOCALAPPDATA ?? ''
  const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((path): path is string => Boolean(path))
  const roaming = join(appData, ROAMING[source])
  const system = [join(roaming, 'system')].filter((path) => existsSync(path))
  const user = [join(roaming, 'user')].filter((path) => existsSync(path))
  const bundled = INSTALL_NAMES[source].flatMap((name) => [
    ...programFiles.map((root) => join(root, name, 'resources', 'profiles')),
    local ? join(local, 'Programs', name, 'resources', 'profiles') : ''
  ]).filter((path) => path && existsSync(path))
  return { base: system.length ? system : bundled, user }
}

function appInstalled(source: SlicerApp): boolean {
  const roots = presetRoots(source)
  return roots.base.length + roots.user.length > 0
}

function instantiated(data: Preset): boolean {
  const value = data.instantiation
  return value === undefined || value === true || value === 'true'
}

function presetKind(file: string, data: Preset): string | null {
  if (typeof data.type === 'string') return data.type
  const path = file.replace(/\\/g, '/').toLowerCase()
  if (path.includes('/machine/')) return 'machine'
  if (path.includes('/process/')) return 'process'
  if (path.includes('/filament/')) return 'filament'
  return null
}

function readPresets(source: SlicerApp): Map<string, Preset> {
  const roots = presetRoots(source)
  const ordered = [...roots.base, ...roots.user]
  const signature = rootSignature(ordered)
  const cached = presetCache.get(source)
  if (cached && cached.signature === signature) return cached.presets
  const presets = new Map<string, Preset>()
  for (const root of ordered) {
    const files: string[] = []
    walkJson(root, files)
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Preset
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.name !== 'string') continue
        data.type = presetKind(file, data)
        presets.set(data.name, data)
      } catch {
        continue
      }
    }
  }
  presetCache.set(source, { signature, presets })
  return presets
}

function loadFor(app: SlicerApp): LoadedPresets {
  for (const source of FALLBACK[app]) {
    const presets = readPresets(source)
    if (presets.size) return { source, presets }
  }
  return { source: null, presets: new Map() }
}

export function listSlicerPresets(app: SlicerApp): SlicerPresetList {
  presetCache.clear()
  const installed = APP_ORDER.filter((candidate) => appInstalled(candidate))
  const loaded = loadFor(app)
  session = { app, source: loaded.source, presets: loaded.presets }
  const result: SlicerPresetList = { app, source: loaded.source, installed, printers: [], processes: [], filaments: [], found: false }
  loaded.presets.forEach((data, name) => {
    if (!instantiated(data)) return
    if (data.type === 'machine') result.printers.push(name)
    else if (data.type === 'process') result.processes.push(name)
    else if (data.type === 'filament') result.filaments.push(name)
  })
  result.printers.sort()
  result.processes.sort()
  result.filaments.sort()
  result.found = result.printers.length > 0 && result.processes.length > 0
  return result
}

function presetsFor(app: SlicerApp): Map<string, Preset> {
  if (session?.app === app && session.presets.size) return session.presets
  const loaded = loadFor(app)
  session = { app, source: loaded.source, presets: loaded.presets }
  return loaded.presets
}

function resolvePreset(presets: Map<string, Preset>, name: string): Preset {
  const chain: Preset[] = []
  const seen = new Set<string>()
  let current: string | undefined = name
  while (current) {
    if (seen.has(current)) break
    seen.add(current)
    const preset = presets.get(current)
    if (!preset) throw new Error(`Slicer preset not found: "${current}"`)
    chain.push(preset)
    current = typeof preset.inherits === 'string' && preset.inherits ? preset.inherits : undefined
  }
  const merged: Preset = {}
  for (const preset of chain.reverse()) {
    for (const [key, value] of Object.entries(preset)) if (!META_KEYS.has(key)) merged[key] = value
  }
  return merged
}

const first = (value: unknown): unknown => (Array.isArray(value) && value.length ? value[0] : value)

function buildProjectConfig(presets: Map<string, Preset>, request: SlicerExportRequest): Preset {
  const config: Preset = {}
  Object.assign(config, resolvePreset(presets, request.printer))
  Object.assign(config, resolvePreset(presets, request.process))
  const filamentNames = request.filaments.map((filament) => filament.preset)
  const filamentConfigs = filamentNames.map((name) => resolvePreset(presets, name))
  const keys = new Set<string>()
  filamentConfigs.forEach((filament) => Object.keys(filament).forEach((key) => keys.add(key)))
  for (const key of keys) {
    if (SKIPPED_FILAMENT_KEYS.has(key)) continue
    const baseValue = filamentConfigs[0][key]
    if (!Array.isArray(baseValue) || !baseValue.length) {
      config[key] = baseValue
      continue
    }
    config[key] = filamentConfigs.map((filament) => first(filament[key] ?? baseValue))
  }
  const count = filamentNames.length
  config.filament_colour = request.filaments.map((filament) => filament.colour || '#161616')
  config.printer_settings_id = request.printer
  config.print_settings_id = request.process
  config.filament_settings_id = filamentNames
  config.flush_volumes_matrix = new Array(count * count).fill('0')
  config.flush_volumes_vector = new Array(2 * count).fill('0')
  Object.assign(config, request.settings)
  config.different_settings_to_system = [Object.keys(request.settings).join(';'), ...new Array(count).fill(''), '']
  if (!config.version) config.version = request.app === 'bambu' ? '1.9.1' : '2.3.1'
  config.name = 'project_settings'
  config.from = 'project'
  return config
}

function bedSize(config: Preset): [number, number, number, number] {
  const area = (config.printable_area as string[] | undefined) ?? ['0x0', '250x0', '250x250', '0x250']
  const xs = area.map((point) => Number(point.split('x')[0]))
  const ys = area.map((point) => Number(point.split('x')[1]))
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function arrange(footprints: [number, number][], bed: [number, number, number, number]): { positions: [number, number][]; overflow: boolean } {
  const [x0, y0, x1, y1] = bed
  const positions: [number, number][] = []
  let cursorX = x0 + PLATE_GAP
  let cursorY = y0 + PLATE_GAP
  let rowHeight = 0
  for (const [width, depth] of footprints) {
    if (cursorX + width > x1 - PLATE_GAP && cursorX > x0 + PLATE_GAP) {
      cursorX = x0 + PLATE_GAP
      cursorY += rowHeight + PLATE_GAP
      rowHeight = 0
    }
    positions.push([cursorX + width / 2, cursorY + depth / 2])
    cursorX += width + PLATE_GAP
    rowHeight = Math.max(rowHeight, depth)
  }
  return { positions, overflow: cursorY + rowHeight > y1 - PLATE_GAP + 0.01 }
}

export interface SlicerObjectMesh {
  name: string
  filament: number
  copies: number
  triangles: Triangle[]
}

export function buildSlicerProject(request: SlicerExportRequest, meshes: SlicerObjectMesh[]): string {
  const presets = presetsFor(request.app)
  if (!presets.size) {
    throw new Error(`No presets for ${SLICER_APP_LABEL[request.app]} were found. Install it, open it once, then export again. STL and 3MF still open in any slicer.`)
  }
  const config = buildProjectConfig(presets, request)
  const bed = bedSize(config)
  const objects: { mesh: SlicerObjectMesh; offset: Vec3; footprint: [number, number] }[] = []
  for (const mesh of meshes) {
    if (!mesh.triangles.length) throw new Error(`"${mesh.name}" is empty.`)
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (const triangle of mesh.triangles) {
      for (const point of triangle) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis])
          max[axis] = Math.max(max[axis], point[axis])
        }
      }
    }
    const offset: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]]
    for (let copy = 0; copy < Math.max(1, mesh.copies); copy++) {
      objects.push({ mesh, offset, footprint: [max[0] - min[0], max[1] - min[1]] })
    }
  }
  const { positions, overflow } = arrange(
    objects.map((object) => object.footprint),
    bed
  )
  let nextId = 1
  const resources: string[] = []
  const buildItems: string[] = []
  const settingsXml: string[] = []
  const plateXml: string[] = []
  objects.forEach((object, index) => {
    const partId = nextId++
    resources.push(`<object id="${partId}" type="model">${meshXml(object.mesh.triangles, object.offset)}</object>`)
    const objectId = nextId++
    resources.push(`<object id="${objectId}" type="model"><components><component objectid="${partId}"/></components></object>`)
    const [x, y] = positions[index]
    buildItems.push(`<item objectid="${objectId}" transform="1 0 0 0 1 0 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)} 0" printable="1"/>`)
    const name = escapeXml(object.mesh.name)
    settingsXml.push(
      [
        `  <object id="${objectId}">`,
        `    <metadata key="name" value="${name}"/>`,
        `    <metadata key="extruder" value="${object.mesh.filament}"/>`,
        `    <part id="${partId}" subtype="normal_part">`,
        `      <metadata key="name" value="${name}"/>`,
        `      <metadata key="extruder" value="${object.mesh.filament}"/>`,
        '    </part>',
        '  </object>'
      ].join('\n')
    )
    plateXml.push(
      `    <model_instance>\n      <metadata key="object_id" value="${objectId}"/>\n      <metadata key="instance_id" value="0"/>\n    </model_instance>`
    )
  })
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
    'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n' +
    '<metadata name="Application">BambuStudio-01.10.00.00</metadata>\n' +
    '<metadata name="BambuStudio:3mfVersion">1</metadata>\n' +
    `<metadata name="Title">${escapeXml(request.title)}</metadata>\n` +
    `<resources>\n${resources.join('\n')}\n</resources>\n<build>\n${buildItems.join('\n')}\n</build>\n</model>\n`
  const modelSettings =
    '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' +
    settingsXml.join('\n') +
    '\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="locked" value="false"/>\n' +
    plateXml.join('\n') +
    '\n  </plate>\n</config>\n'
  const archive = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
    '_rels/.rels': strToU8(RELS_XML),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8(modelSettings),
    'Metadata/project_settings.config': strToU8(JSON.stringify(config, null, 4))
  })
  writeFileSync(request.outputPath, archive)
  const plate = `${(bed[2] - bed[0]).toFixed(0)} x ${(bed[3] - bed[1]).toFixed(0)} mm`
  return `${objects.length} object(s) on a ${plate} plate${overflow ? ' (warning: they may not all fit on one plate)' : ''}`
}
