import { ChildProcess, spawn } from 'child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { generateWithOperations } from '@shared/scad'
import type { Operation, RenderMessage, RenderResult } from '@shared/types'
import { analyseMesh, readStl } from './mesh'
import { loadSettings } from './settings'

export const RENDER_SOURCE_NAME = '.studio-render.scad'

const running = new Map<string, ChildProcess>()

export interface RenderRequest {
  dir: string
  code: string
  ops: Operation[]
  part: string
  outputName?: string
  channel?: string
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
    const inRenderFile = !fileMatch || fileMatch[1].includes('.studio-render')
    const sourceLine = lineMatch && inRenderFile ? mapLine(Number(lineMatch[1])) : undefined
    const text = match[2].replace(/in file [^,]*\.studio-render[^,]*\.scad, line \d+/, sourceLine ? `on line ${sourceLine}` : '')
    const message: RenderMessage = { text: text.trim(), line: sourceLine }
    if (match[1] === 'WARNING') warnings.push(message)
    else errors.push(message)
  }
  return { errors, warnings }
}

export function renderModel(request: RenderRequest): Promise<RenderResult> {
  const settings = loadSettings()
  const generated = generateWithOperations(request.code, request.ops)
  const channel = request.channel ?? `${request.dir}:preview`
  const channelName = channel.slice(request.dir.length + 1) || 'preview'
  const sourcePath = join(request.dir, channelName === 'preview' ? RENDER_SOURCE_NAME : `.studio-render-${channelName}.scad`)
  writeFileSync(sourcePath, generated.code)
  const outputPath = join(request.dir, '.studio', request.outputName ?? `${channelName}.stl`)
  running.get(channel)?.kill()
  try {
    rmSync(outputPath, { force: true })
  } catch {
    return Promise.resolve(failure('The previous render is still finishing. Try again in a moment.', Date.now()))
  }
  const args = ['-o', outputPath]
  if (request.part) args.push('-D', `part="${request.part.replace(/"/g, '\\"')}"`)
  args.push(sourcePath)
  const started = Date.now()
  return new Promise((resolve) => {
    let log = ''
    let child: ChildProcess
    try {
      child = spawn(settings.openscadPath || 'openscad', args, { cwd: request.dir, windowsHide: true })
    } catch (error) {
      resolve(failure(`Could not start OpenSCAD: ${(error as Error).message}`, started))
      return
    }
    running.set(channel, child)
    child.stdout?.on('data', (chunk) => (log += chunk.toString()))
    child.stderr?.on('data', (chunk) => (log += chunk.toString()))
    child.on('error', (error) => {
      running.delete(channel)
      resolve(
        failure(
          `Could not start OpenSCAD at "${settings.openscadPath}". Install OpenSCAD or set its path in Settings. (${error.message})`,
          started
        )
      )
    })
    child.on('close', (code, signal) => {
      if (running.get(channel) === child) running.delete(channel)
      const { errors, warnings } = parseMessages(log, generated.mapLine)
      if (signal) {
        resolve({ ok: false, log, errors: [{ text: 'Render cancelled' }], warnings, durationMs: Date.now() - started })
        return
      }
      if (/top level object is empty/i.test(log) && !errors.length) {
        errors.push({ text: 'The model is empty: nothing is drawn for this part.' })
      }
      if (code !== 0 || !existsSync(outputPath)) {
        if (!errors.length) errors.push({ text: `OpenSCAD exited with code ${code}` })
        resolve({ ok: false, log, errors, warnings, durationMs: Date.now() - started })
        return
      }
      const stl = new Uint8Array(readFileSync(outputPath))
      const stats = analyseMesh(readStl(stl))
      resolve({ ok: true, stl, stats, log, errors, warnings, durationMs: Date.now() - started })
    })
  })
}

function failure(text: string, started: number): RenderResult {
  return { ok: false, log: text, errors: [{ text }], warnings: [], durationMs: Date.now() - started }
}

export function cancelRender(dir: string): void {
  running.get(`${dir}:preview`)?.kill()
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
