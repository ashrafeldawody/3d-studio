import { ChildProcess, spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { COLOR_ECHO_PREFIX, GeneratedSource, generateColorPass, generateWithOperations, geometryStatements, isolateStatement, sceneObjects } from '@shared/scad'
import type { ColorPart, MeshStats, Operation, RenderMessage, RenderResult, RenderedObject } from '@shared/types'
import { Triangle, analyseMesh, readStl, writeBinaryStl } from './mesh'
import { loadSettings } from './settings'

export const RENDER_SOURCE_NAME = '.studio-render.scad'

const running = new Map<string, Set<ChildProcess>>()

export interface RenderRequest {
  dir: string
  code: string
  ops: Operation[]
  part: string
  outputName?: string
  channel?: string
  quiet?: boolean
}

interface PassResult {
  log: string
  errors: RenderMessage[]
  warnings: RenderMessage[]
  triangles: Triangle[] | null
  empty: boolean
  cancelled: boolean
  startError?: string
}

function parseMessages(log: string, mapLine: (line: number) => number): { errors: RenderMessage[]; warnings: RenderMessage[] } {
  const errors: RenderMessage[] = []
  const warnings: RenderMessage[] = []
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim()
    const match = line.match(/^(ERROR|WARNING|TRACE):\s*(.*)$/)
    if (!match) continue
    const lineMatch = line.match(/line (\d+)/)
    const fileMatch = line.match(/in file ([^,]+),/)
    const inRenderFile = !fileMatch || fileMatch[1].includes('.studio-')
    const sourceLine = lineMatch && inRenderFile ? mapLine(Number(lineMatch[1])) : undefined
    const text = match[2].replace(/in file [^,]*\.studio-[^,]*\.scad, line \d+/, sourceLine ? `on line ${sourceLine}` : '')
    const message: RenderMessage = { text: text.trim(), line: sourceLine }
    if (match[1] === 'WARNING') warnings.push(message)
    else errors.push(message)
  }
  return { errors, warnings }
}

function cancelChannel(channel: string): void {
  running.get(channel)?.forEach((child) => child.kill())
  running.delete(channel)
}

const engineArgsCache = new Map<string, string[]>()

function fastEngineArgs(executable: string): string[] {
  const cached = engineArgsCache.get(executable)
  if (cached) return cached
  let help = ''
  try {
    const probe = spawnSync(executable, ['--help'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    help = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
  } catch {
    help = ''
  }
  const args = /--backend/.test(help) ? ['--backend=manifold'] : /manifold/i.test(help) ? ['--enable=manifold'] : []
  engineArgsCache.set(executable, args)
  return args
}

function runPass(request: RenderRequest, channel: string, generated: GeneratedSource, sourcePath: string, outputPath: string): Promise<PassResult> {
  const settings = loadSettings()
  writeFileSync(sourcePath, generated.code)
  try {
    rmSync(outputPath, { force: true })
  } catch {
    return Promise.resolve(passFailure('The previous render is still finishing. Try again in a moment.'))
  }
  const args = ['-o', outputPath, ...fastEngineArgs(settings.openscadPath || 'openscad')]
  if (request.part) args.push('-D', `part="${request.part.replace(/"/g, '\\"')}"`)
  args.push(sourcePath)
  return new Promise((resolve) => {
    let log = ''
    let child: ChildProcess
    try {
      child = spawn(settings.openscadPath || 'openscad', args, { cwd: request.dir, windowsHide: true })
    } catch (error) {
      resolve(passFailure(`Could not start OpenSCAD: ${(error as Error).message}`))
      return
    }
    const children = running.get(channel) ?? new Set<ChildProcess>()
    children.add(child)
    running.set(channel, children)
    child.stdout?.on('data', (chunk) => (log += chunk.toString()))
    child.stderr?.on('data', (chunk) => (log += chunk.toString()))
    child.on('error', (error) => {
      running.get(channel)?.delete(child)
      resolve(passFailure(`Could not start OpenSCAD at "${settings.openscadPath}". Install OpenSCAD or set its path in Settings. (${error.message})`))
    })
    child.on('close', (code, signal) => {
      running.get(channel)?.delete(child)
      rmSync(sourcePath, { force: true })
      const { errors, warnings } = parseMessages(log, generated.mapLine)
      const produced = code === 0 && !signal && existsSync(outputPath)
      const triangles = produced ? readStl(new Uint8Array(readFileSync(outputPath))) : null
      const empty = /top level object is empty|no top level geometry/i.test(log) || (triangles !== null && !triangles.length)
      resolve({ log, errors, warnings, triangles, empty, cancelled: Boolean(signal) })
    })
  })
}

function passFailure(text: string): PassResult {
  return { log: text, errors: [{ text }], warnings: [], triangles: null, empty: false, cancelled: false, startError: text }
}

const passFailed = (pass: PassResult): boolean => !pass.cancelled && !pass.triangles && (!pass.empty || pass.errors.length > 0)

const failureErrors = (pass: PassResult): RenderMessage[] => (pass.errors.length ? pass.errors : [{ text: 'OpenSCAD could not render the model' }])

function findColors(log: string): string[] {
  const colors: string[] = []
  for (const match of log.matchAll(new RegExp(`^ECHO: "${COLOR_ECHO_PREFIX}(.*)"\\s*$`, 'gm'))) {
    if (!colors.includes(match[1])) colors.push(match[1])
  }
  return colors
}

const withoutColorEchoes = (log: string): string =>
  log
    .split(/\r?\n/)
    .filter((line) => !line.includes(COLOR_ECHO_PREFIX))
    .join('\n')

interface CacheManifest {
  key: string
  colors: string[]
  stats: MeshStats
  warnings: RenderMessage[]
  log: string
}

function cacheKey(request: RenderRequest): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify([request.code, request.ops, request.part, loadSettings().openscadPath]))
  const assets = join(request.dir, 'assets')
  if (existsSync(assets)) {
    for (const name of readdirSync(assets).sort()) hash.update(`${name}:${statSync(join(assets, name)).mtimeMs}`)
  }
  return hash.digest('hex')
}

const cacheDir = (dir: string): string => join(dir, '.studio', 'render-cache')

function readCache(request: RenderRequest, key: string): RenderResult | null {
  const manifestPath = join(cacheDir(request.dir), 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CacheManifest
    if (manifest.key !== key) return null
    const parts: ColorPart[] = manifest.colors.map((color, index) => ({
      color,
      stl: new Uint8Array(readFileSync(join(cacheDir(request.dir), `part-${index}.stl`)))
    }))
    const stl = parts.length === 1 ? parts[0].stl : writeBinaryStl(parts.flatMap((part) => readStl(part.stl)))
    return { ok: true, stl, parts, stats: manifest.stats, log: manifest.log, errors: [], warnings: manifest.warnings, durationMs: 0 }
  } catch {
    return null
  }
}

function writeCache(request: RenderRequest, key: string, result: RenderResult): void {
  if (!result.ok || !result.parts || !result.stats) return
  try {
    const dir = cacheDir(request.dir)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    result.parts.forEach((part, index) => writeFileSync(join(dir, `part-${index}.stl`), part.stl))
    const manifest: CacheManifest = { key, colors: result.parts.map((part) => part.color), stats: result.stats, warnings: result.warnings, log: result.log }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  } catch {
    return
  }
}

export async function renderModel(request: RenderRequest): Promise<RenderResult> {
  const channel = request.channel ?? `${request.dir}:preview`
  if (request.outputName || channel !== `${request.dir}:preview`) return renderFresh(request)
  const key = cacheKey(request)
  const cached = readCache(request, key)
  if (cached) {
    cancelChannel(channel)
    return cached
  }
  const result = await renderFresh(request)
  writeCache(request, key, result)
  return result
}

async function renderFresh(request: RenderRequest): Promise<RenderResult> {
  const started = Date.now()
  const channel = request.channel ?? `${request.dir}:preview`
  const channelName = channel.slice(request.dir.length + 1) || 'preview'
  const outputBase = (request.outputName ?? `${channelName}.stl`).replace(/\.stl$/i, '')
  const finish = (result: Omit<RenderResult, 'durationMs'>): RenderResult => ({
    ...result,
    log: withoutColorEchoes(result.log),
    durationMs: Date.now() - started
  })
  cancelChannel(channel)
  const drawsSomething = geometryStatements(request.code).length > 0 || request.ops.some((operation) => operation.enabled && operation.kind === 'addBox')
  if (!drawsSomething) return finish({ ok: true, log: '', errors: [], warnings: [] })
  if (!request.quiet) {
    writeFileSync(
      join(request.dir, channelName === 'preview' ? RENDER_SOURCE_NAME : `.studio-render-${channelName}.scad`),
      generateWithOperations(request.code, request.ops).code
    )
  }
  const passSource = (index: number): string => join(request.dir, `.studio-pass-${channelName}-${index}.scad`)
  const passOutput = (index: number): string => join(request.dir, '.studio', `${outputBase}-pass-${index}.stl`)
  const base = await runPass(request, channel, generateColorPass(request.code, request.ops, '', false), passSource(0), passOutput(0))
  if (base.cancelled) return finish({ ok: false, log: base.log, errors: [{ text: 'Render cancelled' }], warnings: base.warnings })
  if (passFailed(base)) return finish({ ok: false, log: base.log, errors: failureErrors(base), warnings: base.warnings })
  const colors = findColors(base.log)
  const uncoloured = base.triangles ?? []
  const warnings = colors.length ? base.warnings.filter((warning) => !/top level/i.test(warning.text)) : base.warnings
  const blankPlate = (): RenderResult =>
    finish({
      ok: true,
      log: base.log,
      errors: [],
      warnings: warnings.filter((warning) => !/top level object is empty|no top level geometry/i.test(warning.text))
    })
  if (!colors.length && !uncoloured.length) return base.errors.length ? finish({ ok: false, log: base.log, errors: base.errors, warnings }) : blankPlate()
  const passes = await Promise.all(
    colors.map((color, index) =>
      runPass(request, channel, generateColorPass(request.code, request.ops, color, uncoloured.length > 0), passSource(index + 1), passOutput(index + 1))
    )
  )
  if (passes.some((pass) => pass.cancelled)) return finish({ ok: false, log: base.log, errors: [{ text: 'Render cancelled' }], warnings })
  const failed = passes.find(passFailed)
  if (failed) return finish({ ok: false, log: failed.log, errors: failureErrors(failed), warnings })
  const meshes: { color: string; triangles: Triangle[] }[] = []
  if (uncoloured.length) meshes.push({ color: '', triangles: uncoloured })
  passes.forEach((pass, index) => {
    if (pass.triangles?.length) meshes.push({ color: colors[index], triangles: pass.triangles })
  })
  if (!meshes.length) return blankPlate()
  const parts: ColorPart[] = meshes.map((mesh) => ({ color: mesh.color, stl: writeBinaryStl(mesh.triangles) }))
  const stl = parts.length === 1 ? parts[0].stl : writeBinaryStl(meshes.flatMap((mesh) => mesh.triangles))
  if (request.outputName) writeFileSync(join(request.dir, '.studio', request.outputName), stl)
  const stats = combineStats(meshes.map((mesh) => analyseMesh(mesh.triangles)))
  return finish({ ok: true, stl, parts, stats, log: base.log, errors: base.errors, warnings })
}

function combineStats(all: MeshStats[]): MeshStats {
  const axes = [0, 1, 2]
  const min = axes.map((axis) => Math.min(...all.map((stats) => stats.min[axis]))) as [number, number, number]
  const max = axes.map((axis) => Math.max(...all.map((stats) => stats.max[axis]))) as [number, number, number]
  const sum = (pick: (stats: MeshStats) => number): number => all.reduce((total, stats) => total + pick(stats), 0)
  return {
    triangles: sum((stats) => stats.triangles),
    min,
    max,
    size: axes.map((axis) => Math.round((max[axis] - min[axis]) * 1000) / 1000) as [number, number, number],
    volumeCm3: Math.round(sum((stats) => stats.volumeCm3) * 100) / 100,
    shells: sum((stats) => stats.shells),
    nonManifoldEdges: sum((stats) => stats.nonManifoldEdges)
  }
}

const objectCache = new Map<string, ColorPart[] | null>()
const OBJECT_CACHE_LIMIT = 80
const OBJECT_CONCURRENCY = 3

export async function renderObjects(request: RenderRequest): Promise<RenderedObject[]> {
  const objects = sceneObjects(request.code)
  const results: (RenderedObject | null)[] = new Array(objects.length).fill(null)
  let next = 0
  const worker = async (slot: number): Promise<void> => {
    while (next < objects.length) {
      const object = objects[next++]
      const code = isolateStatement(request.code, object.index)
      if (!code) continue
      const isolated: RenderRequest = { ...request, code, channel: `${request.dir}:object-${slot}`, quiet: true }
      const key = cacheKey(isolated)
      let parts = objectCache.get(key)
      if (parts === undefined) {
        const result = await renderFresh(isolated)
        if (result.errors[0]?.text === 'Render cancelled') return
        parts = result.ok && result.parts ? result.parts : null
        objectCache.set(key, parts)
        if (objectCache.size > OBJECT_CACHE_LIMIT) objectCache.delete(objectCache.keys().next().value!)
      }
      if (parts) results[object.index] = { index: object.index, label: object.label, parts }
    }
  }
  await Promise.all(Array.from({ length: OBJECT_CONCURRENCY }, (_, slot) => worker(slot)))
  return results.filter((result): result is RenderedObject => result !== null)
}

export function cancelObjectRenders(dir: string): void {
  for (let slot = 0; slot < OBJECT_CONCURRENCY; slot++) cancelChannel(`${dir}:object-${slot}`)
}

export function cancelRender(dir: string): void {
  cancelChannel(`${dir}:preview`)
}

export function summariseRender(result: RenderResult): string {
  const lines: string[] = []
  if (result.ok && result.stats) {
    const s = result.stats
    lines.push(
      `Render OK in ${(result.durationMs / 1000).toFixed(1)} s.`,
      `Size: ${s.size[0]} x ${s.size[1]} x ${s.size[2]} mm (x from ${s.min[0]} to ${s.max[0]}, y from ${s.min[1]} to ${s.max[1]}, z from ${s.min[2]} to ${s.max[2]}).`,
      `Volume: ${s.volumeCm3} cm3, ${s.triangles} triangles, ${s.shells} separate piece(s), ${s.nonManifoldEdges} non-manifold edges.`
    )
    if (result.parts && result.parts.length > 1) lines.push(`Colours: ${result.parts.map((part) => part.color || 'default').join(', ')}.`)
    if (Math.abs(s.min[2]) > 0.01) lines.push(`Note: lowest point is z=${s.min[2]}, not on the bed (z=0).`)
  } else {
    lines.push('Render FAILED.')
  }
  for (const error of result.errors) lines.push(`ERROR${error.line ? ` (line ${error.line})` : ''}: ${error.text}`)
  for (const warning of result.warnings.slice(0, 20)) lines.push(`WARNING${warning.line ? ` (line ${warning.line})` : ''}: ${warning.text}`)
  const echoes = result.log.split(/\r?\n/).filter((line) => line.startsWith('ECHO:')).slice(0, 20)
  lines.push(...echoes)
  return lines.join('\n')
}
