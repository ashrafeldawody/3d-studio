import type { VectorArtwork } from '@shared/types'

type Point = [number, number]

interface Subpath {
  points: Point[]
  closed: boolean
}

interface Paint {
  color: string
  code: string
  bounds: Bounds
}

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const ARTWORK_PREFIX = '__ART__'

const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const IGNORED_CONTAINERS = 'defs, clipPath, mask, symbol, pattern, marker, metadata, title, desc, foreignObject'
const MERGE_DISTANCE = 26

const NAMED_COLORS: [string, number[]][] = [
  ['black', [0, 0, 0]],
  ['white', [255, 255, 255]],
  ['grey', [128, 128, 128]],
  ['silver', [192, 192, 192]],
  ['red', [220, 20, 30]],
  ['crimson', [165, 0, 68]],
  ['maroon', [110, 0, 0]],
  ['orange', [255, 128, 0]],
  ['yellow', [255, 230, 0]],
  ['gold', [215, 170, 0]],
  ['green', [0, 160, 60]],
  ['dark_green', [0, 80, 30]],
  ['lime', [140, 220, 40]],
  ['cyan', [0, 190, 230]],
  ['blue', [0, 80, 180]],
  ['navy', [0, 30, 90]],
  ['purple', [120, 40, 150]],
  ['pink', [255, 120, 180]],
  ['brown', [130, 70, 20]],
  ['beige', [240, 220, 180]]
]

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

function parsePath(d: string, tolerance: number): Subpath[] {
  const subpaths: Subpath[] = []
  let current: Point[] = []
  let closed = false
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let cubicControl: Point | null = null
  let quadControl: Point | null = null
  let index = 0
  let command = ''

  const skip = (): void => {
    while (index < d.length && /[\s,]/.test(d[index])) index++
  }
  const hasNumber = (): boolean => {
    skip()
    return index < d.length && /[+\-.\d]/.test(d[index])
  }
  const number = (): number => {
    skip()
    const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(d.slice(index))
    if (!match) throw new Error(`Bad path data near "${d.slice(index, index + 12)}"`)
    index += match[0].length
    return parseFloat(match[0])
  }
  const flag = (): boolean => {
    skip()
    const value = d[index++]
    if (value !== '0' && value !== '1') throw new Error('Bad arc flag in path data')
    return value === '1'
  }
  const finish = (): void => {
    if (current.length > 1) subpaths.push({ points: current, closed })
    current = []
    closed = false
  }
  const lineTo = (point: Point): void => {
    if (!current.length) current.push([x, y])
    current.push(point)
    x = point[0]
    y = point[1]
  }
  const segments = (length: number): number => clamp(Math.ceil(length / tolerance), 2, 64)
  const cubic = (c1: Point, c2: Point, end: Point): void => {
    const start: Point = [x, y]
    const count = segments(distance(start, c1) + distance(c1, c2) + distance(c2, end))
    for (let step = 1; step <= count; step++) {
      const t = step / count
      const u = 1 - t
      lineTo([
        u * u * u * start[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
        u * u * u * start[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1]
      ])
    }
  }
  const quadratic = (control: Point, end: Point): void => {
    const start: Point = [x, y]
    const count = segments(distance(start, control) + distance(control, end))
    for (let step = 1; step <= count; step++) {
      const t = step / count
      const u = 1 - t
      lineTo([u * u * start[0] + 2 * u * t * control[0] + t * t * end[0], u * u * start[1] + 2 * u * t * control[1] + t * t * end[1]])
    }
  }

  while (true) {
    skip()
    if (index >= d.length) break
    if (/[a-zA-Z]/.test(d[index])) command = d[index++]
    else if (!command) throw new Error('Path data does not start with a command')
    const relative = command === command.toLowerCase()
    const offsetX = relative ? x : 0
    const offsetY = relative ? y : 0
    const point = (): Point => {
      const px = number() + offsetX
      return [px, number() + offsetY]
    }
    const kind = command.toUpperCase()
    if (kind !== 'C' && kind !== 'S') cubicControl = null
    if (kind !== 'Q' && kind !== 'T') quadControl = null
    if (kind === 'M') {
      finish()
      ;[x, y] = point()
      startX = x
      startY = y
      current = [[x, y]]
      command = relative ? 'l' : 'L'
    } else if (kind === 'Z') {
      if (current.length) closed = true
      finish()
      x = startX
      y = startY
      command = ''
      if (hasNumber()) throw new Error('Unexpected numbers after Z in path data')
    } else if (kind === 'L') {
      lineTo(point())
    } else if (kind === 'H') {
      lineTo([number() + offsetX, y])
    } else if (kind === 'V') {
      lineTo([x, number() + offsetY])
    } else if (kind === 'C') {
      const c1 = point()
      const c2 = point()
      const end = point()
      cubic(c1, c2, end)
      cubicControl = c2
    } else if (kind === 'S') {
      const c1: Point = cubicControl ? [2 * x - cubicControl[0], 2 * y - cubicControl[1]] : [x, y]
      const c2 = point()
      const end = point()
      cubic(c1, c2, end)
      cubicControl = c2
    } else if (kind === 'Q') {
      const control = point()
      const end = point()
      quadratic(control, end)
      quadControl = control
    } else if (kind === 'T') {
      const control: Point = quadControl ? [2 * x - quadControl[0], 2 * y - quadControl[1]] : [x, y]
      quadratic(control, point())
      quadControl = control
    } else if (kind === 'A') {
      const rx = number()
      const ry = number()
      const rotation = number()
      const large = flag()
      const sweep = flag()
      const end = point()
      for (const arcPoint of arcPoints([x, y], rx, ry, rotation, large, sweep, end, tolerance)) lineTo(arcPoint)
    } else {
      throw new Error(`Unknown path command "${command}"`)
    }
  }
  finish()
  return subpaths
}

function arcPoints(start: Point, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, end: Point, tolerance: number): Point[] {
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (!rx || !ry || distance(start, end) < 1e-9) return [end]
  const phi = (rotation * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (start[0] - end[0]) / 2
  const dy = (start[1] - end[1]) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let coefficient = Math.sqrt(Math.max(0, numerator / denominator))
  if (large === sweep) coefficient = -coefficient
  const cx1 = (coefficient * rx * y1) / ry
  const cy1 = (-coefficient * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (start[0] + end[0]) / 2
  const cy = sin * cx1 + cos * cy1 + (start[1] + end[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const count = clamp(Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / tolerance), 4, 96)
  const points: Point[] = []
  for (let step = 1; step <= count; step++) {
    const t = theta + (delta * step) / count
    const px = rx * Math.cos(t)
    const py = ry * Math.sin(t)
    points.push([cos * px - sin * py + cx, sin * px + cos * py + cy])
  }
  points[points.length - 1] = end
  return points
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, tolerance: number): Point[] {
  const count = clamp(Math.ceil((2 * Math.PI * Math.max(rx, ry)) / tolerance), 16, 128)
  return Array.from({ length: count }, (_, step) => {
    const t = (2 * Math.PI * step) / count
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Point
  })
}

function rectPoints(element: SVGRectElement, tolerance: number): Point[] {
  const x = element.x.baseVal.value
  const y = element.y.baseVal.value
  const width = element.width.baseVal.value
  const height = element.height.baseVal.value
  const hasRx = element.hasAttribute('rx')
  const hasRy = element.hasAttribute('ry')
  let rx = hasRx ? element.rx.baseVal.value : hasRy ? element.ry.baseVal.value : 0
  let ry = hasRy ? element.ry.baseVal.value : rx
  rx = Math.min(rx, width / 2)
  ry = Math.min(ry, height / 2)
  if (!rx || !ry) return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
  const corner = (cx: number, cy: number, from: number): Point[] => {
    const count = clamp(Math.ceil((Math.PI / 2) * Math.max(rx, ry) / tolerance), 3, 24)
    return Array.from({ length: count + 1 }, (_, step) => {
      const t = from + ((Math.PI / 2) * step) / count
      return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Point
    })
  }
  return [
    ...corner(x + width - rx, y + ry, -Math.PI / 2),
    ...corner(x + width - rx, y + height - ry, 0),
    ...corner(x + rx, y + height - ry, Math.PI / 2),
    ...corner(x + rx, y + ry, Math.PI)
  ]
}

function listPoints(list: SVGPointList): Point[] {
  const points: Point[] = []
  for (let index = 0; index < list.numberOfItems; index++) {
    const point = list.getItem(index)
    points.push([point.x, point.y])
  }
  return points
}

function shapeSubpaths(element: SVGGraphicsElement, tolerance: number): Subpath[] {
  const tag = element.tagName.toLowerCase()
  if (tag === 'path') return parsePath(element.getAttribute('d') ?? '', tolerance)
  if (tag === 'rect') return [{ points: rectPoints(element as SVGRectElement, tolerance), closed: true }]
  if (tag === 'circle') {
    const circle = element as SVGCircleElement
    const r = circle.r.baseVal.value
    return r > 0 ? [{ points: ellipsePoints(circle.cx.baseVal.value, circle.cy.baseVal.value, r, r, tolerance), closed: true }] : []
  }
  if (tag === 'ellipse') {
    const ellipse = element as SVGEllipseElement
    const rx = ellipse.rx.baseVal.value
    const ry = ellipse.ry.baseVal.value
    return rx > 0 && ry > 0 ? [{ points: ellipsePoints(ellipse.cx.baseVal.value, ellipse.cy.baseVal.value, rx, ry, tolerance), closed: true }] : []
  }
  if (tag === 'line') {
    const line = element as SVGLineElement
    return [{ points: [[line.x1.baseVal.value, line.y1.baseVal.value], [line.x2.baseVal.value, line.y2.baseVal.value]], closed: false }]
  }
  if (tag === 'polyline' || tag === 'polygon') {
    return [{ points: listPoints((element as SVGPolygonElement).points), closed: tag === 'polygon' }]
  }
  return []
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

function cssColor(value: string): { hex: string; alpha: number } | null {
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/)
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])
  return { hex: toHex(Number(match[1]), Number(match[2]), Number(match[3])), alpha }
}

function paintColor(value: string, root: SVGSVGElement): string | null {
  if (!value || value === 'none') return null
  const reference = value.match(/url\(\s*["']?#([^"')]+)["']?\s*\)/)
  if (reference) {
    const stops = [...(root.querySelector(`[id="${CSS.escape(reference[1])}"]`)?.querySelectorAll('stop') ?? [])]
    const stopColor = stops.map((stop) => cssColor(getComputedStyle(stop).stopColor)).find(Boolean)
    return stopColor ? stopColor.hex : '#808080'
  }
  const color = cssColor(value)
  return color && color.alpha > 0.05 ? color.hex : null
}

const rgb = (hex: string): number[] => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
const colorDistance = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function isHidden(element: Element): boolean {
  if (element.closest(IGNORED_CONTAINERS)) return true
  if (getComputedStyle(element).visibility === 'hidden') return true
  for (let node: Element | null = element; node && node.tagName.toLowerCase() !== 'svg'; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || parseFloat(style.opacity) === 0) return true
  }
  return false
}

const format = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const pointList = (points: Point[]): string => `[${points.map(([px, py]) => `[${format(px)},${format(py)}]`).join(',')}]`

function signedArea(points: Point[]): number {
  let area = 0
  for (let index = 0; index < points.length; index++) {
    const [ax, ay] = points[index]
    const [bx, by] = points[(index + 1) % points.length]
    area += ax * by - bx * ay
  }
  return area / 2
}

function dedupe(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (!result.length || distance(result[result.length - 1], point) > 1e-6) result.push(point)
  }
  if (result.length > 2 && distance(result[0], result[result.length - 1]) < 1e-6) result.pop()
  return result
}

function polygonCode(rings: Point[][]): string {
  if (rings.length === 1) return `polygon(${pointList(rings[0])});`
  const points: Point[] = []
  const paths = rings.map((ring) => {
    const indices = ring.map((_, index) => points.length + index)
    points.push(...ring)
    return `[${indices.join(',')}]`
  })
  return `polygon(points=${pointList(points)}, paths=[${paths.join(',')}]);`
}

function fillCode(subpaths: Point[][], evenOdd: boolean): string | null {
  const rings = subpaths.map(dedupe).filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-6)
  if (!rings.length) return null
  if (evenOdd || rings.length === 1) return polygonCode(rings)
  const reference = Math.sign(signedArea(rings.reduce((largest, ring) => (Math.abs(signedArea(ring)) > Math.abs(signedArea(largest)) ? ring : largest))))
  const solid = rings.filter((ring) => Math.sign(signedArea(ring)) === reference)
  const holes = rings.filter((ring) => Math.sign(signedArea(ring)) !== reference)
  const solidCode = solid.map((ring) => `polygon(${pointList(ring)});`).join(' ')
  if (!holes.length) return `union() { ${solidCode} }`
  return `difference() { union() { ${solidCode} } ${holes.map((ring) => `polygon(${pointList(ring)});`).join(' ')} }`
}

function strokeCode(subpaths: Subpath[], width: number): string | null {
  const parts: string[] = []
  for (const subpath of subpaths) {
    const points = dedupe(subpath.points)
    if (points.length < 2) continue
    if (subpath.closed && points.length >= 3) {
      const ring = pointList(points)
      parts.push(`difference() { offset(delta=${format(width / 2)}) polygon(${ring}); offset(delta=${format(-width / 2)}) polygon(${ring}); }`)
    } else {
      parts.push(`${ARTWORK_PREFIX}_line(${pointList(points)}, ${format(width)});`)
    }
  }
  return parts.length ? parts.join('\n    ') : null
}

function boundsOf(points: Point[], margin: number): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const [px, py] of points) {
    bounds.minX = Math.min(bounds.minX, px - margin)
    bounds.minY = Math.min(bounds.minY, py - margin)
    bounds.maxX = Math.max(bounds.maxX, px + margin)
    bounds.maxY = Math.max(bounds.maxY, py + margin)
  }
  return bounds
}

function nameColors(colors: string[]): Map<string, string> {
  const names = new Map<string, string>()
  const used = new Map<string, number>()
  for (const color of colors) {
    const value = rgb(color)
    const [base] = NAMED_COLORS.reduce((best, entry) => (colorDistance(entry[1], value) < colorDistance(best[1], value) ? entry : best))
    const count = (used.get(base) ?? 0) + 1
    used.set(base, count)
    names.set(color, count === 1 ? base : `${base}_${count}`)
  }
  return names
}

function sanitise(svg: SVGSVGElement): void {
  svg.querySelectorAll('script, foreignObject, iframe').forEach((node) => node.remove())
  svg.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !attribute.value.startsWith('#'))) node.removeAttribute(attribute.name)
    }
  })
}

export function convertSvg(text: string, fileName: string): VectorArtwork {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml')
  const source = parsed.documentElement
  if (parsed.querySelector('parsererror') || source.tagName.toLowerCase() !== 'svg') throw new Error(`${fileName} is not a valid SVG file.`)
  const svg = document.importNode(source, true) as unknown as SVGSVGElement
  sanitise(svg)
  const viewBox = svg.viewBox.baseVal
  if (!svg.getAttribute('width') && viewBox?.width) svg.setAttribute('width', String(viewBox.width))
  if (!svg.getAttribute('height') && viewBox?.height) svg.setAttribute('height', String(viewBox.height))
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none'
  host.appendChild(svg)
  document.body.appendChild(host)
  try {
    return convertMounted(svg, fileName)
  } finally {
    host.remove()
  }
}

function convertMounted(svg: SVGSVGElement, fileName: string): VectorArtwork {
  const warnings: string[] = []
  const box = svg.getBoundingClientRect()
  const screenTolerance = Math.max(box.width, box.height, 1) / 900
  const paints: Paint[] = []
  const palette: { hex: string; value: number[] }[] = []
  const merged = (hex: string): string => {
    const value = rgb(hex)
    const match = palette.find((entry) => colorDistance(entry.value, value) < MERGE_DISTANCE)
    if (match) return match.hex
    palette.push({ hex, value })
    return hex
  }
  if (svg.querySelector('text')) warnings.push('Text in the SVG was skipped. Convert text to paths in your design program first.')
  if (svg.querySelector('[clip-path], [mask]')) warnings.push('Clipping and masks were ignored, so some shapes may show more than in the original.')
  if (svg.querySelector('image')) warnings.push('Embedded pictures inside the SVG were skipped.')
  let useWarned = false
  for (const element of svg.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase()
    if (tag === 'use' && !useWarned && !element.closest(IGNORED_CONTAINERS)) {
      warnings.push('Reused shapes (<use>) were skipped.')
      useWarned = true
    }
    if (!SHAPE_TAGS.has(tag) || isHidden(element)) continue
    const shape = element as SVGGraphicsElement
    const matrix = shape.getCTM()
    if (!matrix) continue
    const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1
    let subpaths: Subpath[]
    try {
      subpaths = shapeSubpaths(shape, screenTolerance / scale)
    } catch (error) {
      warnings.push(`A shape was skipped: ${(error as Error).message}`)
      continue
    }
    const transformed = subpaths.map((subpath) => ({
      closed: subpath.closed,
      points: subpath.points.map(([px, py]) => [matrix.a * px + matrix.c * py + matrix.e, matrix.b * px + matrix.d * py + matrix.f] as Point)
    }))
    if (!transformed.length) continue
    const style = getComputedStyle(shape)
    const fill = paintColor(style.fill, svg)
    const fillOpacity = parseFloat(style.fillOpacity || '1')
    if (fill && fillOpacity > 0.05) {
      const code = fillCode(transformed.map((subpath) => subpath.points), style.fillRule === 'evenodd')
      if (code) paints.push({ color: merged(fill), code, bounds: boundsOf(transformed.flatMap((subpath) => subpath.points), 0) })
    }
    const stroke = paintColor(style.stroke, svg)
    const strokeWidth = parseFloat(style.strokeWidth || '0') * scale
    const strokeOpacity = parseFloat(style.strokeOpacity || '1')
    if (stroke && strokeWidth > 0 && strokeOpacity > 0.05) {
      const code = strokeCode(transformed, strokeWidth)
      if (code) paints.push({ color: merged(stroke), code, bounds: boundsOf(transformed.flatMap((subpath) => subpath.points), strokeWidth / 2) })
    }
  }
  if (!paints.length) throw new Error(`No filled shapes were found in ${fileName}.`)
  return buildLibrary(paints, fileName, warnings)
}

function buildLibrary(paints: Paint[], fileName: string, warnings: string[]): VectorArtwork {
  const bounds = paints.reduce(
    (total, paint) => ({
      minX: Math.min(total.minX, paint.bounds.minX),
      minY: Math.min(total.minY, paint.bounds.minY),
      maxX: Math.max(total.maxX, paint.bounds.maxX),
      maxY: Math.max(total.maxY, paint.bounds.maxY)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  )
  const layers: { color: string; codes: string[] }[] = []
  for (const paint of paints) {
    const last = layers[layers.length - 1]
    if (last && last.color === paint.color) last.codes.push(paint.code)
    else layers.push({ color: paint.color, codes: [paint.code] })
  }
  const colors = [...new Set(layers.map((layer) => layer.color))]
  const names = nameColors(colors)
  const P = ARTWORK_PREFIX
  const lines: string[] = [
    `module ${P}_line(points, width) {`,
    `    for (i = [0 : len(points) - 2]) hull() {`,
    `        translate(points[i]) circle(d = width, $fn = 12);`,
    `        translate(points[i + 1]) circle(d = width, $fn = 12);`,
    `    }`,
    `}`,
    '',
    `module ${P}_placed() {`,
    `    mirror([0, 1, 0]) translate([${format(-bounds.minX)}, ${format(-bounds.maxY)}]) children();`,
    `}`,
    ''
  ]
  layers.forEach((layer, index) => {
    lines.push(`module ${P}_layer_${index}() {`, `    ${layer.codes.join('\n    ')}`, `}`, '')
  })
  layers.forEach((_, index) => {
    const next = index + 1 < layers.length ? `${P}_layer_${index + 1}(); ${P}_above_${index + 1}();` : ''
    lines.push(`module ${P}_above_${index}() { ${next} }`)
  })
  lines.push('')
  for (const color of colors) {
    const visible = layers
      .map((layer, index) => (layer.color === color ? `difference() { ${P}_layer_${index}(); ${P}_above_${index}(); }` : ''))
      .filter(Boolean)
    lines.push(`module ${P}_${names.get(color)}() {`, `    ${P}_placed() {`, ...visible.map((code) => `        ${code}`), `    }`, `}`, '')
  }
  lines.push(`module ${P}_outline() {`, `    ${P}_placed() {`, ...layers.map((_, index) => `        ${P}_layer_${index}();`), `    }`, `}`, '')
  return {
    fileName,
    library: lines.join('\n'),
    colors: colors.map((color) => ({ color, module: names.get(color)! })),
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    warnings
  }
}
