export type Axis = 'x' | 'y' | 'z'

export type Vector3 = [number, number, number]

export type Operation =
  | { id: string; kind: 'translate'; enabled: boolean; x: number; y: number; z: number }
  | { id: string; kind: 'rotate'; enabled: boolean; x: number; y: number; z: number; center?: Vector3 }
  | { id: string; kind: 'scale'; enabled: boolean; x: number; y: number; z: number; center?: Vector3 }
  | { id: string; kind: 'mirror'; enabled: boolean; axis: Axis; center?: Vector3 }
  | { id: string; kind: 'cut'; enabled: boolean; axis: Axis; position: number; keep: 'below' | 'above' }
  | { id: string; kind: 'removeBox'; enabled: boolean; min: [number, number, number]; max: [number, number, number] }
  | { id: string; kind: 'addBox'; enabled: boolean; min: [number, number, number]; max: [number, number, number] }

export type OperationKind = Operation['kind']

export interface MeshStats {
  triangles: number
  size: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  volumeCm3: number
  shells: number
  nonManifoldEdges: number
}

export interface RenderResult {
  ok: boolean
  stl?: Uint8Array
  stats?: MeshStats
  log: string
  errors: RenderMessage[]
  warnings: RenderMessage[]
  durationMs: number
}

export interface RenderMessage {
  text: string
  line?: number
}

export interface HistoryEntry {
  id: string
  label: string
  createdAt: number
  source: 'save' | 'ai' | 'import' | 'restore' | 'bake'
}

export interface ProjectState {
  dir: string
  name: string
  code: string
  ops: Operation[]
  parts: string[]
  part: string
  assets: string[]
  history: HistoryEntry[]
}

export type AiProvider = 'openrouter' | 'claude-code'

export type ClaudeEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface Settings {
  openscadPath: string
  claudePath: string
  claudeModel: string
  claudeEffort: ClaudeEffort
  claudeAllowBash: boolean
  openrouterApiKey: string
  openrouterModel: string
  aiProvider: AiProvider
  autoRender: boolean
  autoFixRenderErrors: boolean
  attachViewToAi: boolean
  aiInstructions: string
  uiMode: 'simple' | 'expert'
  bedX: number
  bedY: number
  recentProjects: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error' | 'info'
  text: string
  createdAt: number
  thumbnails?: string[]
}

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'append'; id: string; text: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'codeChanged' }

export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  vision: boolean
  tools: boolean
}

export interface SlicerPresetList {
  printers: string[]
  processes: string[]
  filaments: string[]
  found: boolean
}

export interface SlicerFilament {
  preset: string
  colour: string
}

export interface SlicerObject {
  name: string
  part: string
  filament: number
  copies: number
}

export interface SlicerExportRequest {
  outputPath: string
  title: string
  printer: string
  process: string
  filaments: SlicerFilament[]
  objects: SlicerObject[]
  settings: Record<string, string>
}

export type ViewName = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom'

export interface ChatPin {
  id: number
  point: Vector3
  normal: Vector3
  note: string
}

export interface ChatAttachments {
  images: { name: string; dataUrl: string; thumbnail: string }[]
  pins: ChatPin[]
}

export interface ModelParameter {
  name: string
  kind: 'number' | 'boolean' | 'string'
  value: number | boolean | string
  start: number
  end: number
  line: number
}
