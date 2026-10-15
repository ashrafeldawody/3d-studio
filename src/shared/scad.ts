import type { Axis, ModelParameter, Operation, Vector3 } from './types'

export type StatementKind = 'definition' | 'assignment' | 'directive' | 'geometry'

export interface Statement {
  kind: StatementKind
  text: string
  start: number
  end: number
  startLine: number
}

const lineAt = (source: string, offset: number): number => {
  let line = 1
  for (let index = 0; index < offset; index++) if (source.charCodeAt(index) === 10) line++
  return line
}

function skipTrivia(source: string, index: number): number {
  let position = index
  while (position < source.length) {
    const char = source[position]
    if (/\s/.test(char)) {
      position++
    } else if (source.startsWith('//', position)) {
      const newline = source.indexOf('\n', position)
      position = newline === -1 ? source.length : newline + 1
    } else if (source.startsWith('/*', position)) {
      const close = source.indexOf('*/', position + 2)
      position = close === -1 ? source.length : close + 2
    } else {
      break
    }
  }
  return position
}

function classify(text: string): StatementKind {
  if (/^(module|function)\b/.test(text)) return 'definition'
  if (/^(include|use)\s*</.test(text)) return 'directive'
  if (/^[A-Za-z_$][\w$]*\s*=(?!=)/.test(text)) return 'assignment'
  return 'geometry'
}

export function splitTopLevel(source: string): Statement[] {
  const statements: Statement[] = []
  let position = skipTrivia(source, 0)
  while (position < source.length) {
    const start = position
    let depth = 0
    let index = position
    let finished = false
    const directive = /^(include|use)\s*</.test(source.slice(start, start + 12))
    while (index < source.length && !finished) {
      const char = source[index]
      if (char === '"') {
        index++
        while (index < source.length && source[index] !== '"') index += source[index] === '\\' ? 2 : 1
        index++
        continue
      }
      if (source.startsWith('//', index) || source.startsWith('/*', index)) {
        index = skipTrivia(source, index)
        continue
      }
      if (directive && char === '>') {
        index++
        finished = true
        continue
      }
      if (char === '(' || char === '[' || char === '{') depth++
      if (char === ')' || char === ']') depth--
      if (char === '}') {
        depth--
        if (depth === 0) {
          const next = skipTrivia(source, index + 1)
          if (!/^else\b/.test(source.slice(next, next + 5))) {
            index++
            finished = true
            continue
          }
        }
      }
      if (char === ';' && depth === 0) finished = true
      index++
    }
    const text = source.slice(start, index).trim()
    if (text) statements.push({ kind: classify(text), text, start, end: index, startLine: lineAt(source, start) })
    position = skipTrivia(source, index)
  }
  return statements
}

export function findParts(source: string): { parts: string[]; defaultPart: string } {
  const parts: string[] = []
  const add = (value: string): void => {
    if (!parts.includes(value)) parts.push(value)
  }
  const assignment = source.match(/^\s*part\s*=\s*"([^"]*)"\s*;/m)
  const defaultPart = assignment ? assignment[1] : ''
  if (defaultPart) add(defaultPart)
  for (const match of source.matchAll(/\bpart\s*==\s*"([^"]*)"/g)) add(match[1])
  for (const match of source.matchAll(/"([^"]*)"\s*==\s*part\b/g)) add(match[1])
  return { parts, defaultPart }
}

const BIG = 4000

const vector = (values: number[]): string => `[${values.map(formatNumber).join(', ')}]`

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 10000) / 10000)
}

const axisIndex = (axis: Axis): number => ({ x: 0, y: 1, z: 2 })[axis]

function cutBox(axis: Axis, position: number, keep: 'below' | 'above'): string {
  const index = axisIndex(axis)
  const origin = [-BIG / 2, -BIG / 2, -BIG / 2]
  const size = [BIG, BIG, BIG]
  if (keep === 'below') {
    size[index] = position + BIG / 2
  } else {
    origin[index] = position
    size[index] = BIG / 2 - position
  }
  return `translate(${vector(origin)}) cube(${vector(size)})`
}

function boxCode(min: number[], max: number[]): string {
  const low = min.map((value, axis) => Math.min(value, max[axis]))
  const size = min.map((value, axis) => Math.abs(max[axis] - value))
  return `translate(${vector(low)}) cube(${vector(size)})`
}

function aroundCenter(center: Vector3 | undefined, transform: string, body: string): string {
  if (!center || center.every((value) => Math.abs(value) < 1e-9)) return `${transform} ${body}`
  return `translate(${vector(center)}) ${transform} translate(${vector(center.map((value) => -value))}) ${body}`
}

const asStatement = (body: string): string => (body.trim().endsWith('}') ? body : `${body};`)

export function wrapWithOperation(operation: Operation, body: string): string {
  switch (operation.kind) {
    case 'translate':
      return `translate(${vector([operation.x, operation.y, operation.z])}) ${body}`
    case 'rotate':
      return aroundCenter(operation.center, `rotate(${vector([operation.x, operation.y, operation.z])})`, body)
    case 'scale':
      return aroundCenter(operation.center, `scale(${vector([operation.x, operation.y, operation.z])})`, body)
    case 'mirror': {
      const normal = [0, 0, 0]
      normal[axisIndex(operation.axis)] = 1
      return aroundCenter(operation.center, `mirror(${vector(normal)})`, body)
    }
    case 'cut':
      return `intersection() {\n  ${asStatement(body)}\n  ${cutBox(operation.axis, operation.position, operation.keep)};\n}`
    case 'removeBox':
      return `difference() {\n  ${asStatement(body)}\n  ${boxCode(operation.min, operation.max)};\n}`
    case 'addBox':
      return `union() {\n  ${asStatement(body)}\n  ${boxCode(operation.min, operation.max)};\n}`
  }
}

export function applyOperations(operations: Operation[], call: string): string {
  return operations
    .filter((operation) => operation.enabled)
    .reduce((body, operation) => wrapWithOperation(operation, body), call)
}

export interface GeneratedSource {
  code: string
  mapLine: (generatedLine: number) => number
}

export const GEOMETRY_MODULE = 'studio_model_geometry'

function uniqueModuleName(source: string): string {
  let name = GEOMETRY_MODULE
  let suffix = 2
  while (source.includes(name)) name = `${GEOMETRY_MODULE}_${suffix++}`
  return name
}

export function generateWithOperations(source: string, operations: Operation[]): GeneratedSource {
  const enabled = operations.filter((operation) => operation.enabled)
  if (!enabled.length) return { code: source, mapLine: (line) => line }
  const statements = splitTopLevel(source)
  const geometry = statements.filter((statement) => statement.kind === 'geometry')
  let kept = ''
  let cursor = 0
  for (const statement of geometry) {
    kept += source.slice(cursor, statement.start)
    kept += source.slice(statement.start, statement.end).replace(/[^\n]/g, ' ')
    cursor = statement.end
  }
  kept += source.slice(cursor)
  const keptLines = kept.split('\n').length
  const lineMap: { generated: number; original: number }[] = []
  let moduleBody = ''
  let generatedLine = keptLines + 2
  for (const statement of geometry) {
    lineMap.push({ generated: generatedLine, original: statement.startLine })
    moduleBody += `  ${statement.text}\n`
    generatedLine += statement.text.split('\n').length
  }
  const moduleName = uniqueModuleName(source)
  const call = applyOperations(enabled, `${moduleName}()`)
  const finalCall = call.trim().endsWith('}') ? call : `${call};`
  const code = `${kept}\nmodule ${moduleName}() {\n${moduleBody}}\n${finalCall}\n`
  const mapLine = (line: number): number => {
    if (line <= keptLines) return line
    let best = lineMap[0]
    for (const entry of lineMap) if (entry.generated <= line) best = entry
    return best ? best.original + (line - best.generated) : line
  }
  return { code, mapLine }
}

export function bakeOperations(source: string, operations: Operation[]): string {
  const enabled = operations.filter((operation) => operation.enabled)
  if (!enabled.length) return source
  const geometry = splitTopLevel(source).filter((statement) => statement.kind === 'geometry')
  let kept = ''
  let cursor = 0
  for (const statement of geometry) {
    kept += source.slice(cursor, statement.start)
    cursor = statement.end
  }
  kept += source.slice(cursor)
  const body = geometry.map((statement) => `  ${statement.text.split('\n').join('\n  ')}`).join('\n')
  const moduleName = uniqueModuleName(source)
  const call = applyOperations(enabled, `${moduleName}()`)
  const finalCall = call.trim().endsWith('}') ? call : `${call};`
  const tidy = kept.replace(/\n{3,}/g, '\n\n').trimEnd()
  return `${tidy}\n\nmodule ${moduleName}() {\n${body}\n}\n\n${finalCall}\n`
}

const PARAMETER_PATTERN = /^([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|-?\.\d+|true|false|"(?:[^"\\]|\\.)*")\s*;$/i

export function findParameters(source: string): ModelParameter[] {
  const parameters: ModelParameter[] = []
  const seen = new Set<string>()
  for (const statement of splitTopLevel(source)) {
    if (statement.kind !== 'assignment') continue
    const match = statement.text.match(PARAMETER_PATTERN)
    if (!match || match[1].startsWith('$')) continue
    const raw = match[2]
    const kind: ModelParameter['kind'] = raw === 'true' || raw === 'false' ? 'boolean' : raw.startsWith('"') ? 'string' : 'number'
    const value = kind === 'boolean' ? raw === 'true' : kind === 'string' ? raw.slice(1, -1) : Number(raw)
    const valueOffset = statement.start + statement.text.lastIndexOf(raw)
    const parameter: ModelParameter = { name: match[1], kind, value, start: valueOffset, end: valueOffset + raw.length, line: statement.startLine }
    if (seen.has(parameter.name)) {
      const index = parameters.findIndex((item) => item.name === parameter.name)
      parameters[index] = parameter
    } else {
      seen.add(parameter.name)
      parameters.push(parameter)
    }
  }
  return parameters
}

export function setParameter(source: string, parameter: ModelParameter, value: number | boolean | string): string {
  const literal = typeof value === 'string' ? JSON.stringify(value) : typeof value === 'number' ? formatNumber(value) : String(value)
  return source.slice(0, parameter.start) + literal + source.slice(parameter.end)
}
