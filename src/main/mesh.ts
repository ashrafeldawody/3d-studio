import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { MeshStats } from '@shared/types'

export type Vec3 = [number, number, number]
export type Triangle = [Vec3, Vec3, Vec3]

export interface NamedMesh {
  name: string
  triangles: Triangle[]
  color?: string
}

export function readStl(data: Uint8Array): Triangle[] {
  const head = strFromU8(data.subarray(0, Math.min(400, data.length)))
  if (head.startsWith('solid') && head.includes('facet')) return readAsciiStl(strFromU8(data))
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint32(80, true)
  const triangles: Triangle[] = []
  for (let index = 0; index < count; index++) {
    const base = 84 + index * 50 + 12
    if (base + 36 > data.byteLength) break
    const point = (offset: number): Vec3 => [
      view.getFloat32(base + offset, true),
      view.getFloat32(base + offset + 4, true),
      view.getFloat32(base + offset + 8, true)
    ]
    triangles.push([point(0), point(12), point(24)])
  }
  return triangles
}

function readAsciiStl(text: string): Triangle[] {
  const numbers = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(
    (match) => [Number(match[1]), Number(match[2]), Number(match[3])] as Vec3
  )
  const triangles: Triangle[] = []
  for (let index = 0; index + 2 < numbers.length; index += 3) {
    triangles.push([numbers[index], numbers[index + 1], numbers[index + 2]])
  }
  return triangles
}

export function writeBinaryStl(triangles: Triangle[]): Uint8Array {
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  triangles.forEach((triangle, index) => {
    const base = 84 + index * 50
    const normal = faceNormal(triangle)
    normal.forEach((value, axis) => view.setFloat32(base + axis * 4, value, true))
    triangle.forEach((point, corner) =>
      point.forEach((value, axis) => view.setFloat32(base + 12 + corner * 12 + axis * 4, value, true))
    )
  })
  return new Uint8Array(buffer)
}

function faceNormal([a, b, c]: Triangle): Vec3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
  const length = Math.hypot(...n) || 1
  return [n[0] / length, n[1] / length, n[2] / length]
}

const pointKey = (point: Vec3): string => point.map((value) => value.toFixed(4)).join(',')

export function analyseMesh(triangles: Triangle[]): MeshStats {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const edges = new Map<string, number>()
  const parent = new Map<string, string>()
  const find = (node: string): string => {
    let current = node
    if (!parent.has(current)) parent.set(current, current)
    while (parent.get(current) !== current) {
      const next = parent.get(parent.get(current)!)!
      parent.set(current, next)
      current = next
    }
    return current
  }
  let volume = 0
  for (const triangle of triangles) {
    const [a, b, c] = triangle
    for (const point of triangle) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis])
        max[axis] = Math.max(max[axis], point[axis])
      }
    }
    const keys = triangle.map(pointKey)
    for (const [u, v] of [[keys[0], keys[1]], [keys[1], keys[2]], [keys[2], keys[0]]]) {
      const edge = u < v ? `${u}|${v}` : `${v}|${u}`
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
    parent.set(find(keys[1]), find(keys[0]))
    parent.set(find(keys[2]), find(keys[0]))
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  let nonManifoldEdges = 0
  edges.forEach((count) => {
    if (count !== 2) nonManifoldEdges++
  })
  const roots = new Set<string>()
  parent.forEach((_, node) => roots.add(find(node)))
  const empty = triangles.length === 0
  return {
    triangles: triangles.length,
    min: empty ? [0, 0, 0] : min.map(round3) as Vec3,
    max: empty ? [0, 0, 0] : max.map(round3) as Vec3,
    size: empty ? [0, 0, 0] : [round3(max[0] - min[0]), round3(max[1] - min[1]), round3(max[2] - min[2])],
    volumeCm3: Math.round(Math.abs(volume) / 10) / 100,
    shells: roots.size,
    nonManifoldEdges
  }
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000

type Matrix = number[]

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY
  const numbers = value.trim().split(/\s+/).map(Number)
  return numbers.length === 12 && numbers.every(Number.isFinite) ? numbers : IDENTITY
}

function multiply(outer: Matrix, inner: Matrix): Matrix {
  const result: Matrix = new Array(12).fill(0)
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = row === 3 ? outer[9 + column] : 0
      for (let k = 0; k < 3; k++) sum += inner[row * 3 + k] * outer[k * 3 + column]
      result[row * 3 + column] = sum
    }
  }
  return result
}

function apply(matrix: Matrix, [x, y, z]: Vec3): Vec3 {
  return [
    x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9],
    x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10],
    x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11]
  ]
}

interface ModelObject {
  name: string
  color?: string
  mesh?: { vertices: Vec3[]; triangles: [number, number, number][] }
  components: { path: string; id: string; transform: Matrix }[]
}

function normaliseColor(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  return match ? `#${match[1].toLowerCase()}` : undefined
}

function readColorGroups(xml: string): Map<string, (string | undefined)[]> {
  const groups = new Map<string, (string | undefined)[]>()
  const groupPattern = /<(?:\w+:)?(basematerials|colorgroup)\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?\1>/g
  for (const match of xml.matchAll(groupPattern)) {
    const id = attributes(match[2]).id
    const entryPattern = match[1] === 'basematerials' ? /<(?:\w+:)?base\b([^>]*)\/?>/g : /<(?:\w+:)?color\b([^>]*)\/?>/g
    const colors = [...match[3].matchAll(entryPattern)].map((entry) => {
      const a = attributes(entry[1])
      return normaliseColor(a.displaycolor ?? a.color)
    })
    if (id) groups.set(id, colors)
  }
  return groups
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) result[match[1]] = match[2]
  return result
}

function parseModelFile(xml: string, path: string, objects: Map<string, ModelObject>): { id: string; transform: Matrix }[] {
  const colorGroups = readColorGroups(xml)
  const colorOf = (pid: string | undefined, index: string | undefined): string | undefined =>
    pid ? colorGroups.get(pid)?.[Number(index ?? 0)] : undefined
  const objectPattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/g
  for (const match of xml.matchAll(objectPattern)) {
    const attrs = attributes(match[1])
    const body = match[2]
    const object: ModelObject = { name: attrs.name ?? `object ${attrs.id}`, color: colorOf(attrs.pid, attrs.pindex), components: [] }
    const meshMatch = body.match(/<mesh\b[\s\S]*?<\/mesh>/)
    if (meshMatch) {
      const vertices: Vec3[] = []
      for (const vertex of meshMatch[0].matchAll(/<vertex\b([^>]*)\/?>/g)) {
        const a = attributes(vertex[1])
        vertices.push([Number(a.x), Number(a.y), Number(a.z)])
      }
      const triangles: [number, number, number][] = []
      const triangleColors = new Set<string | undefined>()
      for (const triangle of meshMatch[0].matchAll(/<triangle\b([^>]*)\/?>/g)) {
        const a = attributes(triangle[1])
        triangles.push([Number(a.v1), Number(a.v2), Number(a.v3)])
        if (!object.color && (a.pid || a.p1)) triangleColors.add(colorOf(a.pid ?? attrs.pid, a.p1))
      }
      if (triangleColors.size === 1) object.color = [...triangleColors][0]
      object.mesh = { vertices, triangles }
    }
    for (const component of body.matchAll(/<component\b([^>]*)\/?>/g)) {
      const a = attributes(component[1])
      const target = a['p:path'] ?? a.path ?? path
      object.components.push({ path: normalisePath(target), id: a.objectid, transform: parseTransform(a.transform) })
    }
    objects.set(`${path}#${attrs.id}`, object)
  }
  const items: { id: string; transform: Matrix }[] = []
  const buildMatch = xml.match(/<build\b[\s\S]*?<\/build>/)
  if (buildMatch) {
    for (const item of buildMatch[0].matchAll(/<item\b([^>]*)\/?>/g)) {
      const a = attributes(item[1])
      if (a.printable === '0') continue
      items.push({ id: a.objectid, transform: parseTransform(a.transform) })
    }
  }
  return items
}

const normalisePath = (path: string): string => path.replace(/^\//, '')

type ColorBuckets = Map<string, Triangle[]>

function addTriangles(buckets: ColorBuckets, color: string, triangles: Triangle[]): void {
  const bucket = buckets.get(color)
  if (bucket) bucket.push(...triangles)
  else buckets.set(color, triangles)
}

function collectTriangles(
  objects: Map<string, ModelObject>,
  path: string,
  id: string,
  transform: Matrix,
  inheritedColor: string,
  output: ColorBuckets,
  depth = 0
): void {
  const object = objects.get(`${path}#${id}`)
  if (!object || depth > 16) return
  const color = object.color ?? inheritedColor
  if (object.mesh) {
    const points = object.mesh.vertices.map((vertex) => apply(transform, vertex))
    const triangles: Triangle[] = []
    for (const [a, b, c] of object.mesh.triangles) {
      if (points[a] && points[b] && points[c]) triangles.push([points[a], points[b], points[c]])
    }
    addTriangles(output, color, triangles)
  }
  for (const component of object.components) {
    collectTriangles(objects, component.path, component.id, multiply(transform, component.transform), color, output, depth + 1)
  }
}

interface SlicerSettings {
  names: Map<string, string>
  objectExtruders: Map<string, number>
  partExtruders: Map<string, number>
  hiddenParts: Set<string>
  filamentColors: string[]
}

const extruderIn = (xml: string): number | undefined => {
  const match = xml.match(/key="extruder"\s+value="(\d+)"/)
  return match ? Number(match[1]) : undefined
}

function readSlicerSettings(files: Record<string, Uint8Array>): SlicerSettings {
  const settings: SlicerSettings = { names: new Map(), objectExtruders: new Map(), partExtruders: new Map(), hiddenParts: new Set(), filamentColors: [] }
  for (const configName of ['Metadata/Slic3r_PE_model.config', 'Metadata/model_settings.config']) {
    if (!files[configName]) continue
    for (const match of strFromU8(files[configName]).matchAll(/<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const [, objectId, body] = match
      const ownSettings = body.split(/<(?:part|volume)\b/)[0]
      const name = ownSettings.match(/key="name"\s+value="([^"]*)"/) ?? body.match(/key="name"\s+value="([^"]*)"/)
      if (name && !settings.names.has(objectId)) settings.names.set(objectId, name[1])
      const objectExtruder = extruderIn(ownSettings)
      if (objectExtruder !== undefined) settings.objectExtruders.set(objectId, objectExtruder)
      for (const part of body.matchAll(/<part\b([^>]*)>([\s\S]*?)<\/part>/g)) {
        const attrs = attributes(part[1])
        const key = `${objectId}:${attrs.id}`
        if (attrs.subtype && attrs.subtype !== 'normal_part') settings.hiddenParts.add(key)
        const partExtruder = extruderIn(part[2])
        if (partExtruder !== undefined) settings.partExtruders.set(key, partExtruder)
      }
    }
  }
  const projectSettings = files['Metadata/project_settings.config']
  if (projectSettings) {
    try {
      const parsed = JSON.parse(strFromU8(projectSettings)) as { filament_colour?: string[] }
      settings.filamentColors = (parsed.filament_colour ?? []).map((color) => normaliseColor(color) ?? '')
    } catch {
      settings.filamentColors = []
    }
  }
  const prusaSettings = files['Metadata/Slic3r_PE.config']
  if (prusaSettings && !settings.filamentColors.length) {
    const text = strFromU8(prusaSettings)
    const colorsFor = (key: string): string[] =>
      (text.match(new RegExp(`^; ${key} = (.*)$`, 'm'))?.[1] ?? '').split(';').map((value) => normaliseColor(value.replace(/"/g, '')) ?? '')
    const extruderColors = colorsFor('extruder_colour')
    settings.filamentColors = extruderColors.some(Boolean) ? extruderColors : colorsFor('filament_colour')
  }
  return settings
}

export function read3mf(data: Uint8Array): NamedMesh[] {
  const files = unzipSync(data)
  const modelPaths = Object.keys(files).filter((name) => name.toLowerCase().endsWith('.model'))
  const objects = new Map<string, ModelObject>()
  let rootItems: { id: string; transform: Matrix }[] = []
  let rootPath = modelPaths.find((name) => name.toLowerCase() === '3d/3dmodel.model') ?? modelPaths[0]
  for (const path of modelPaths) {
    const items = parseModelFile(strFromU8(files[path]), path, objects)
    if (path === rootPath) rootItems = items
  }
  if (!rootPath) return []
  const slicer = readSlicerSettings(files)
  for (const [key, object] of objects) {
    const id = key.split('#')[1]
    if (object.name.startsWith('object ') && slicer.names.has(id)) object.name = slicer.names.get(id)!
  }
  const filamentColor = (extruder: number | undefined): string | undefined =>
    extruder === undefined ? undefined : slicer.filamentColors[Math.max(extruder, 1) - 1] || undefined
  const meshes: NamedMesh[] = []
  const usedNames = new Set<string>()
  const uniqueName = (baseName: string): string => {
    let name = safeName(baseName)
    let suffix = 2
    while (usedNames.has(name)) name = `${safeName(baseName)}-${suffix++}`
    usedNames.add(name)
    return name
  }
  rootItems.forEach((item, index) => {
    const root = objects.get(`${rootPath}#${item.id}`)
    if (!root) return
    const configured = slicer.names.has(item.id)
    const rootColor = filamentColor(slicer.objectExtruders.get(item.id) ?? (configured ? 1 : undefined)) ?? root.color ?? ''
    const buckets: ColorBuckets = new Map()
    if (root.mesh) collectTriangles(objects, rootPath!, item.id, item.transform, rootColor, buckets)
    for (const component of root.mesh ? [] : root.components) {
      const partKey = `${item.id}:${component.id}`
      if (slicer.hiddenParts.has(partKey)) continue
      const partColor = filamentColor(slicer.partExtruders.get(partKey)) ?? rootColor
      collectTriangles(objects, component.path, component.id, multiply(item.transform, component.transform), partColor, buckets, 1)
    }
    const baseName = root.name ?? `part ${index + 1}`
    for (const [color, triangles] of buckets) {
      if (triangles.length) meshes.push({ name: uniqueName(baseName), triangles, color: color || undefined })
    }
  })
  return meshes
}

export function safeName(name: string): string {
  const cleaned = name
    .replace(/\.(stl|obj|3mf|step|stp)$/gi, '')
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return cleaned || 'part'
}

export function meshXml(triangles: Triangle[], offset: Vec3 = [0, 0, 0]): string {
  const index = new Map<string, number>()
  const vertices: string[] = []
  const faces: string[] = []
  for (const triangle of triangles) {
    const face: number[] = []
    for (const point of triangle) {
      const shifted = [point[0] - offset[0], point[1] - offset[1], point[2] - offset[2]]
      const key = shifted.map((value) => value.toFixed(5)).join(' ')
      let vertexIndex = index.get(key)
      if (vertexIndex === undefined) {
        vertexIndex = vertices.length
        index.set(key, vertexIndex)
        vertices.push(`<vertex x="${shifted[0].toFixed(5)}" y="${shifted[1].toFixed(5)}" z="${shifted[2].toFixed(5)}"/>`)
      }
      face.push(vertexIndex)
    }
    if (new Set(face).size === 3) faces.push(`<triangle v1="${face[0]}" v2="${face[1]}" v3="${face[2]}"/>`)
  }
  return `<mesh><vertices>${vertices.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh>`
}

export const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  '<Default Extension="config" ContentType="text/xml"/></Types>\n'

export const RELS_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  '</Relationships>\n'

export function write3mf(meshes: NamedMesh[], title: string): Uint8Array {
  const resources: string[] = []
  const items: string[] = []
  meshes.forEach((mesh, index) => {
    const id = index + 1
    resources.push(`<object id="${id}" name="${escapeXml(mesh.name)}" type="model">${meshXml(mesh.triangles)}</object>`)
    items.push(`<item objectid="${id}"/>`)
  })
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    `<metadata name="Title">${escapeXml(title)}</metadata>\n<metadata name="Application">3D Studio</metadata>\n` +
    `<resources>${resources.join('\n')}</resources>\n<build>${items.join('')}</build>\n</model>\n`
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES_XML),
    '_rels/.rels': strToU8(RELS_XML),
    '3D/3dmodel.model': strToU8(model)
  })
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
