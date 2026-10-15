import type {
  ChatAttachments,
  ChatEvent,
  ChatMessage,
  HistoryEntry,
  Operation,
  OpenRouterModel,
  ProjectState,
  RenderResult,
  Settings,
  SlicerExportRequest,
  SlicerPresetList,
  ViewName
} from '@shared/types'

export interface CaptureRequest {
  id: string
  view: ViewName
  stl?: Uint8Array
}

export interface StudioApi {
  settings: {
    get(): Promise<Settings>
    set(update: Partial<Settings>): Promise<Settings>
  }
  project: {
    create(): Promise<ProjectState | null>
    open(): Promise<ProjectState | null>
    openPath(dir: string): Promise<ProjectState>
    startup(): Promise<ProjectState | null>
    quickCreate(name: string): Promise<ProjectState>
    undo(): Promise<{ code: string; label: string; history: HistoryEntry[] } | null>
    importModels(currentCode: string | null): Promise<ProjectState | null>
    close(): Promise<void>
    save(payload: { code: string; ops: Operation[]; part: string; label?: string }): Promise<HistoryEntry[]>
    saveMeta(payload: { ops: Operation[]; part: string }): Promise<void>
    history(): Promise<HistoryEntry[]>
    restore(id: string): Promise<{ code: string; history: HistoryEntry[] }>
    reveal(): Promise<void>
    onCodeChanged(callback: (code: string) => void): () => void
  }
  render(payload: { code: string; ops: Operation[]; part: string }): Promise<RenderResult>
  exportMesh(payload: { code: string; ops: Operation[]; part: string; format: 'stl' | '3mf' }): Promise<string | null>
  slicer: {
    presets(): Promise<SlicerPresetList>
    chooseOutput(defaultName: string): Promise<string | null | undefined>
    exportProject(payload: { request: SlicerExportRequest; code: string; ops: Operation[] }): Promise<string>
    open(path: string): Promise<string>
  }
  ai: {
    models(force?: boolean): Promise<OpenRouterModel[]>
    messages(): Promise<ChatMessage[]>
    clear(): Promise<void>
    stop(): Promise<void>
    send(payload: { prompt: string; ops: Operation[]; part: string; code: string; attachments: ChatAttachments }): Promise<void>
    onEvent(callback: (event: ChatEvent) => void): () => void
  }
  capture: {
    onRequest(callback: (request: CaptureRequest) => void): () => void
    respond(id: string, dataUrl: string | null): void
  }
}

declare global {
  interface Window {
    studio: StudioApi
  }
}
