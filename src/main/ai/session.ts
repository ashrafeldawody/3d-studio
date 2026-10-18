import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, extname, join, relative as relativePath } from 'path'
import type { ChatAttachments, ChatEvent, ChatFile, ChatImage, ChatMessage, ChatPin, Operation, RenderResult, ViewName } from '@shared/types'
import { renderModel, summariseRender } from '../openscad'
import { importArtwork, importMeshFile, loadChat, readCode, saveChat, snapshot, studioDir, writeCode } from '../project'
import { loadSettings } from '../settings'
import { AiRunContext } from './context'
import { runClaudeCode } from './claudeCode'
import { runCliAgent } from './cliAgents'
import { ApiMessage, runOpenRouter } from './openrouter'

export interface ChatHost {
  emit(event: ChatEvent): void
  codeChanged(code: string): void
  captureView(view: ViewName, result?: RenderResult): Promise<string | null>
}

const MAX_AUTO_FIX_ROUNDS = 2

let controller: AbortController | null = null

export function stopChat(): void {
  controller?.abort()
}

export function chatMessages(dir: string): ChatMessage[] {
  return loadChat(dir).messages
}

export function clearChat(dir: string): void {
  saveChat(dir, { messages: [] })
}

export async function sendChat(
  host: ChatHost,
  request: { dir: string; prompt: string; ops: Operation[]; part: string; attachments: ChatAttachments }
): Promise<void> {
  if (controller) throw new Error('The assistant is still working on the previous message.')
  const settings = loadSettings()
  const store = loadChat(request.dir)
  controller = new AbortController()
  const signal = controller.signal
  const startCode = readCode(request.dir)
  snapshot(request.dir, 'Before AI change', 'save')
  const addMessage = (role: ChatMessage['role'], text: string, thumbnails?: string[]): ChatMessage => {
    const message: ChatMessage = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, text, createdAt: Date.now(), thumbnails }
    store.messages.push(message)
    saveChat(request.dir, store)
    host.emit({ type: 'message', message })
    return message
  }
  const context: AiRunContext = {
    dir: request.dir,
    ops: request.ops,
    part: request.part,
    signal,
    readCode: () => readCode(request.dir),
    writeCode: (code) => {
      writeCode(request.dir, code)
      host.codeChanged(code)
    },
    render: () => renderModel({ dir: request.dir, code: readCode(request.dir), ops: request.ops, part: request.part, channel: `${request.dir}:ai` }),
    captureView: (view, result) => host.captureView(view, result),
    emit: host.emit,
    addMessage
  }
  const { images, pins } = request.attachments
  const pinText = describePins(pins)
  const fullPrompt = pinText ? `${request.prompt}\n\n${pinText}` : request.prompt
  const attachedNames = (request.attachments.files ?? []).map((file) => `📎 ${file.name}`).join('\n')
  addMessage('user', attachedNames ? `${fullPrompt}\n\n${attachedNames}` : fullPrompt, images.map((image) => image.thumbnail))
  const artworkNotes = importAttachedArtwork(request.dir, images, context.writeCode, addMessage)
  const fileNotes = shareAttachedFiles(request.dir, request.attachments.files ?? [], settings.aiProvider === 'openrouter', addMessage)
  host.emit({ type: 'busy', busy: true })
  try {
    const labelled = images.map((image) => ({ label: image.name, dataUrl: image.dataUrl }))
    if (settings.attachViewToAi && !images.some((image) => image.name.startsWith('Annotated'))) {
      const view = await host.captureView('iso')
      if (view) labelled.push({ label: 'Current preview (3D view)', dataUrl: view })
    }
    let prompt = [fullPrompt, ...artworkNotes, fileNotes].filter(Boolean).join('\n\n')
    for (let round = 0; round <= MAX_AUTO_FIX_ROUNDS; round++) {
      const provider = settings.aiProvider
      if (provider === 'claude-code') {
        const imagePaths = round === 0 ? saveAttachmentImages(request.dir, labelled) : []
        const result = await runClaudeCode(context, prompt, store.claudeSessionId, imagePaths)
        store.claudeSessionId = result.sessionId
        saveChat(request.dir, store)
        if (result.isError) break
      } else if (provider === 'codex' || provider === 'grok' || provider === 'agy') {
        const imagePaths = round === 0 ? saveAttachmentImages(request.dir, labelled) : []
        const result = await runCliAgent(provider, context, prompt, store.agentSessions?.[provider], imagePaths)
        store.agentSessions = { ...store.agentSessions, [provider]: result.sessionId }
        saveChat(request.dir, store)
        if (result.isError) break
      } else {
        const transcript = (store.openrouterTranscript ?? []) as ApiMessage[]
        store.openrouterTranscript = await runOpenRouter(context, prompt, transcript, round === 0 ? labelled : [])
        saveChat(request.dir, store)
      }
      if (signal.aborted || !settings.autoFixRenderErrors) break
      if (readCode(request.dir) === startCode) break
      const check = await context.render()
      if (check.ok) break
      if (round === MAX_AUTO_FIX_ROUNDS) {
        addMessage('error', `The model still does not render:\n${summariseRender(check)}`)
        break
      }
      addMessage('info', 'The model does not render yet; asking the assistant to fix it.')
      prompt = `The model fails to render. Fix it.\n\n${summariseRender(check)}`
    }
  } catch (error) {
    if (!signal.aborted) addMessage('error', (error as Error).message)
  } finally {
    if (signal.aborted) addMessage('info', 'Stopped.')
    controller = null
    const endCode = readCode(request.dir)
    if (endCode !== startCode) {
      host.codeChanged(endCode)
      const label = request.prompt.length > 60 ? `${request.prompt.slice(0, 57)}...` : request.prompt
      snapshot(request.dir, `AI: ${label}`, 'ai')
    }
    host.emit({ type: 'busy', busy: false })
  }
}

const TEXT_EXTENSIONS = /\.(txt|md|csv|json|scad|svg|xml|yaml|yml|ini|cfg|conf|log|gcode|py|js|ts|html|css|dxf|obj)$/i
const INLINE_LIMIT = 150_000

function shareAttachedFiles(dir: string, files: ChatFile[], inlineText: boolean, addMessage: (role: ChatMessage['role'], text: string) => ChatMessage): string {
  if (!files.length) return ''
  const folder = join(studioDir(dir), 'attachments', 'files')
  mkdirSync(folder, { recursive: true })
  const lines: string[] = []
  const inlined: string[] = []
  for (const file of files) {
    try {
      const extension = extname(file.name).toLowerCase()
      if ((extension === '.stl' || extension === '.3mf') && file.path) {
        const meshes = importMeshFile(dir, file.path)
        lines.push(`- ${file.name}: a 3D model, copied into the project as ${meshes.map((mesh) => mesh.file).join(', ')}. Use it with import("${meshes[0].file}") if it should become part of the design.`)
        continue
      }
      const target = join(folder, uniqueFileName(folder, basename(file.name)))
      if (file.path) copyFileSync(file.path, target)
      else if (file.data) writeFileSync(target, Buffer.from(file.data))
      else continue
      const relative = relativePath(dir, target).replace(/\\/g, '/')
      lines.push(`- ${file.name} (${formatSize(file.size)}): ${relative}`)
      if (inlineText && TEXT_EXTENSIONS.test(file.name) && file.size <= INLINE_LIMIT) inlined.push(`<file name="${file.name}">\n${readFileSync(target, 'utf8')}\n</file>`)
    } catch (error) {
      addMessage('error', `Could not attach ${file.name}: ${(error as Error).message}`)
    }
  }
  if (!lines.length) return ''
  const intro = inlineText
    ? 'The user shared these files (saved in the project folder; text files are included below):'
    : 'The user shared these files. They are saved in the project folder; open them with your file tools when they are relevant:'
  return [intro, ...lines, ...inlined].join('\n')
}

function uniqueFileName(folder: string, name: string): string {
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length) || 'file'
  let candidate = name
  let suffix = 2
  while (existsSync(join(folder, candidate))) candidate = `${stem}-${suffix++}${extension}`
  return candidate
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`

function importAttachedArtwork(
  dir: string,
  images: ChatImage[],
  writeModel: (code: string) => void,
  addMessage: (role: ChatMessage['role'], text: string) => ChatMessage
): string[] {
  const notes: string[] = []
  for (const image of images) {
    if (!image.artwork) continue
    try {
      const imported = importArtwork(dir, image.artwork)
      const current = readCode(dir).trimEnd()
      writeModel(current ? `${current}\n\n${imported.code}` : imported.code)
      notes.push(imported.summary)
      const warnings = image.artwork.warnings.length ? `\n${image.artwork.warnings.join('\n')}` : ''
      addMessage('info', `Added ${image.artwork.fileName} exactly as drawn, in ${image.artwork.colors.length} colour${image.artwork.colors.length === 1 ? '' : 's'}.${warnings}`)
    } catch (error) {
      addMessage('error', `Could not convert ${image.artwork.fileName}: ${(error as Error).message}`)
    }
  }
  return notes
}

function describePins(pins: ChatPin[]): string {
  if (!pins.length) return ''
  const format = (values: number[]): string => values.map((value) => value.toFixed(2)).join(', ')
  const lines = pins.map(
    (pin) => `- Pin ${pin.id} at (${format(pin.point)}) mm, surface facing (${format(pin.normal)})${pin.note.trim() ? `: ${pin.note.trim()}` : ''}`
  )
  return `Points the user pinned on the model (numbered markers in the images):\n${lines.join('\n')}`
}

function saveAttachmentImages(dir: string, images: { label: string; dataUrl: string }[]): { label: string; path: string }[] {
  const folder = join(studioDir(dir), 'attachments')
  mkdirSync(folder, { recursive: true })
  const stamp = Date.now()
  return images.map((image, index) => {
    const extension = image.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'
    const name = `${stamp}-${index + 1}.${extension}`
    writeFileSync(join(folder, name), Buffer.from(image.dataUrl.split(',')[1], 'base64'))
    return { label: image.label, path: `.studio/attachments/${name}` }
  })
}
