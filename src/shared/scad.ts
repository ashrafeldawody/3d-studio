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
  return wrapGeometry(source, enabled, (call) => call)
}

export const COLOR_ECHO_PREFIX = 'STUDIO_COLOR:'

const COLOR_OVERRIDE = `module color(c, alpha = 1) {
  if (is_undef($studio_color_owner)) {
    if ($studio_color_target == "") echo(str("${COLOR_ECHO_PREFIX}", c));
    if (str(c) == $studio_color_target) { $studio_color_owner = str(c); children(); }
  } else children();
}`

export function generateColorPass(source: string, operations: Operation[], target: string, subtractUncoloured: boolean): GeneratedSource {
  const targetLiteral = JSON.stringify(target)
  if (!subtractUncoloured) {
    const base = generateWithOperations(source, operations)
    return { code: `${base.code}\n$studio_color_target = ${targetLiteral};\n${COLOR_OVERRIDE}\n`, mapLine: base.mapLine }
  }
  const enabled = operations.filter((operation) => operation.enabled)
  const generated = wrapGeometry(source, enabled, (call) => {
    const statement = asStatement(call)
    return `difference() {\n  union() { $studio_color_target = ${targetLiteral}; ${statement} }\n  union() { $studio_color_target = ""; ${statement} }\n}`
  })
  return { code: `${generated.code}\n${COLOR_OVERRIDE}\n`, mapLine: generated.mapLine }
}

function wrapGeometry(source: string, enabled: Operation[], wrapCall: (call: string) => string): GeneratedSource {
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
  const finalCall = asStatement(wrapCall(applyOperations(enabled, `${moduleName}()`)))
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

export interface SceneObject {
  index: number
  label: string
}

const WRAPPER_CALLS = new Set(['translate', 'rotate', 'scale', 'mirror', 'color', 'multmatrix', 'resize', 'offset', 'render', 'if', 'for', 'union', 'intersection', 'difference', 'hull', 'minkowski', 'linear_extrude', 'rotate_extrude', 'let'])

export function geometryStatements(source: string): Statement[] {
  return splitTopLevel(source).filter((statement) => statement.kind === 'geometry')
}

export function statementLabel(text: string): string {
  const calls = [...text.matchAll(/([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1])
  const name = calls.find((call) => !WRAPPER_CALLS.has(call)) ?? calls[0] ?? 'shape'
  return name.replace(/_/g, ' ')
}

export function sceneObjects(source: string): SceneObject[] {
  return geometryStatements(source).map((statement, index) => ({ index, label: statementLabel(statement.text) }))
}

function withoutGeometry(source: string, statements: Statement[]): string {
  let kept = ''
  let cursor = 0
  for (const statement of statements) {
    kept += source.slice(cursor, statement.start)
    cursor = statement.end
  }
  return kept + source.slice(cursor)
}

export function isolateStatement(source: string, index: number): string | null {
  const statements = geometryStatements(source)
  const target = statements[index]
  if (!target) return null
  return `${withoutGeometry(source, statements).trimEnd()}\n\n${target.text}\n`
}

const NUMBER = String.raw`(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)`
const LEADING_TRANSLATE = new RegExp(String.raw`^translate\s*\(\s*(?:v\s*=\s*)?\[\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*\]\s*\)\s*`, 'i')

function replaceStatement(source: string, statement: Statement, text: string): string {
  return source.slice(0, statement.start) + text + source.slice(statement.end)
}

export function moveStatement(source: string, index: number, delta: Vector3): string {
  const statement = geometryStatements(source)[index]
  if (!statement) return source
  const match = statement.text.match(LEADING_TRANSLATE)
  if (match) {
    const moved = [Number(match[1]) + delta[0], Number(match[2]) + delta[1], Number(match[3]) + delta[2]]
    const rest = statement.text.slice(match[0].length)
    const text = moved.every((value) => Math.abs(value) < 1e-6) ? rest : `translate(${vector(moved)}) ${rest}`
    return replaceStatement(source, statement, text)
  }
  if (delta.every((value) => Math.abs(value) < 1e-6)) return source
  return replaceStatement(source, statement, `translate(${vector(delta)}) ${statement.text}`)
}

export function removeStatement(source: string, index: number): string {
  const statement = geometryStatements(source)[index]
  if (!statement) return source
  const lineStart = source.lastIndexOf('\n', statement.start - 1) + 1
  const before = source.slice(lineStart, statement.start)
  const afterEnd = source.slice(statement.end).match(/^[ \t]*\r?\n?/)?.[0].length ?? 0
  const start = before.trim() ? statement.start : lineStart
  return source.slice(0, start) + source.slice(statement.end + afterEnd)
}

export function duplicateStatement(source: string, index: number, offset: Vector3): string {
  const statement = geometryStatements(source)[index]
  if (!statement) return source
  const copy = moveStatement(statement.text, 0, offset)
  return `${source.slice(0, statement.end)}\n${copy}${source.slice(statement.end)}`
}

const TRANSFORM_CALLS = new Set(['translate', 'rotate', 'scale', 'mirror', 'color', 'multmatrix'])

interface LeadingCall {
  name: string
  start: number
  argsStart: number
  argsEnd: number
  end: number
}

function leadingCalls(text: string): LeadingCall[] {
  const calls: LeadingCall[] = []
  let position = 0
  while (position < text.length) {
    const match = /^\s*([A-Za-z_]\w*)\s*\(/.exec(text.slice(position))
    if (!match || !TRANSFORM_CALLS.has(match[1])) break
    const start = position + match[0].indexOf(match[1])
    const argsStart = position + match[0].length
    let depth = 1
    let index = argsStart
    while (index < text.length && depth > 0) {
      const char = text[index]
      if (char === '"') {
        index++
        while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1
      } else if (char === '(') depth++
      else if (char === ')') depth--
      index++
    }
    if (depth !== 0) break
    const end = index + (/^\s*/.exec(text.slice(index))?.[0].length ?? 0)
    calls.push({ name: match[1], start, argsStart, argsEnd: index - 1, end })
    position = index
  }
  return calls
}

export function paintStatement(source: string, index: number, color: string | null): string {
  const statement = geometryStatements(source)[index]
  if (!statement) return source
  const text = statement.text
  const existing = leadingCalls(text).find((call) => call.name === 'color')
  let next: string
  if (existing) {
    next = color ? `${text.slice(0, existing.argsStart)}${JSON.stringify(color)}${text.slice(existing.argsEnd)}` : text.slice(0, existing.start) + text.slice(existing.end)
  } else {
    if (!color) return source
    next = `color(${JSON.stringify(color)}) ${text}`
  }
  return replaceStatement(source, statement, next)
}

export function replaceColorLiteral(source: string, oldColor: string, newColor: string): { code: string; count: number } {
  const escaped = oldColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`"${escaped}"`, 'gi')
  let count = 0
  const code = source.replace(pattern, () => {
    count++
    return JSON.stringify(newColor)
  })
  return { code, count }
}

export function prefixStatement(source: string, index: number, prefix: string): string {
  const statement = geometryStatements(source)[index]
  if (!statement) return source
  return replaceStatement(source, statement, `${prefix} ${statement.text}`)
}

export function aroundPoint(center: Vector3, transform: string, shift: Vector3 = [0, 0, 0]): string {
  const there = center.map((value, axis) => value + shift[axis])
  const outer = there.some((value) => Math.abs(value) > 1e-9)
  const inner = center.some((value) => Math.abs(value) > 1e-9)
  const wrapped = inner ? `${transform} translate(${vector(center.map((value) => -value))})` : transform
  return outer ? `translate(${vector(there)}) ${wrapped}` : wrapped
}

export function rotateStatement(source: string, index: number, axis: Vector3, degrees: number, center: Vector3, shift: Vector3 = [0, 0, 0]): string {
  const statement = geometryStatements(source)[index]
  if (!statement || Math.abs(degrees) < 1e-4) return source
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1
  const normal = axis.map((value) => value / length)
  const transform = `rotate(a = ${formatNumber(degrees)}, v = ${vector(normal)})`
  return replaceStatement(source, statement, `${aroundPoint(center, transform, shift)} ${statement.text}`)
}

export function scaleStatement(source: string, index: number, factor: Vector3, center: Vector3): string {
  const statement = geometryStatements(source)[index]
  if (!statement) return source
  const safe = factor.map((value) => (Number.isFinite(value) && Math.abs(value) > 1e-4 ? value : 1)) as Vector3
  if (safe.every((value) => Math.abs(value - 1) < 1e-4)) return source
  return replaceStatement(source, statement, `${aroundPoint(center, `scale(${vector(safe)})`)} ${statement.text}`)
}

export function appendStatement(source: string, statement: string): string {
  return `${source.trimEnd()}\n\n${statement}\n`
}
