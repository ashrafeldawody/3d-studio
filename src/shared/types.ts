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

export interface ColorPart {
  color: string
  stl: Uint8Array
}

export interface RenderResult {
  ok: boolean
  stl?: Uint8Array
  parts?: ColorPart[]
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

export type CliAgent = 'codex' | 'grok' | 'agy'

export type AiProvider = 'openrouter' | 'claude-code' | CliAgent

export type ClaudeEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface Settings {
  openscadPath: string
  claudePath: string
  claudeModel: string
  claudeEffort: ClaudeEffort
  claudeAllowBash: boolean
  codexPath: string
  codexModel: string
  grokPath: string
  grokModel: string
  agyPath: string
  agyModel: string
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
  bedZ: number
  printerName: string
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

export type SlicerApp = 'bambu' | 'snapmaker' | 'orca'

export const SLICER_APP_LABEL: Record<SlicerApp, string> = {
  bambu: 'Bambu Studio',
  snapmaker: 'Snapmaker Orca',
  orca: 'OrcaSlicer'
}

export interface SlicerPresetList {
  app: SlicerApp
  source: SlicerApp | null
  installed: SlicerApp[]
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
  app: SlicerApp
  printer: string
  process: string
  filaments: SlicerFilament[]
  objects: SlicerObject[]
  settings: Record<string, string>
}

export type ViewName = 'iso' | 'top' | 'front' | 'right' | 'back' | 'left' | 'bottom'

export type MenuCommand =
  | { type: 'newProject' }
  | { type: 'openProject' }
  | { type: 'openFile' }
  | { type: 'openRecent'; dir: string }
  | { type: 'clearRecent' }
  | { type: 'importModels' }
  | { type: 'save' }
  | { type: 'export'; format: 'stl' | '3mf' }
  | { type: 'slicer'; app: SlicerApp }
  | { type: 'closeProject' }
  | { type: 'settings' }
  | { type: 'undo' }
  | { type: 'render' }
  | { type: 'view'; view: ViewName }
  | { type: 'uiMode'; mode: Settings['uiMode'] }

export interface ChatPin {
  id: number
  point: Vector3
  normal: Vector3
  note: string
}

export interface ChatAttachments {
  images: ChatImage[]
  pins: ChatPin[]
  files?: ChatFile[]
}

export interface ModelParameter {
  name: string
  kind: 'number' | 'boolean' | 'string'
  value: number | boolean | string
  start: number
  end: number
  line: number
}

export interface VectorArtwork {
  fileName: string
  library: string
  colors: { color: string; module: string }[]
  width: number
  height: number
  warnings: string[]
}

export interface ChatImage {
  name: string
  dataUrl: string
  thumbnail: string
  artwork?: VectorArtwork
}

export interface RenderedObject {
  index: number
  label: string
  parts: ColorPart[]
}

export interface ChatFile {
  name: string
  size: number
  path?: string
  data?: Uint8Array
}
