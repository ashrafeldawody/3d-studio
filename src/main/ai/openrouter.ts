import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { OpenRouterModel, ViewName } from '@shared/types'
import { analyseMesh, readStl } from '../mesh'
import { listAssets } from '../project'
import { summariseRender } from '../openscad'
import { loadSettings } from '../settings'
import { AiRunContext, describeOperations, numberedCode } from './context'
import { systemPrompt } from './prompt'

const API = 'https://openrouter.ai/api/v1'
const MAX_STEPS = 30
const KEPT_TRANSCRIPT = 60

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

let modelCache: OpenRouterModel[] | null = null

export async function listOpenRouterModels(force = false): Promise<OpenRouterModel[]> {
  if (modelCache && !force) return modelCache
  const response = await fetch(`${API}/models`)
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`)
  const body = (await response.json()) as {
    data: {
      id: string
      name: string
      context_length: number
      architecture?: { input_modalities?: string[] }
      supported_parameters?: string[]
    }[]
  }
  modelCache = body.data
    .map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.context_length,
      vision: model.architecture?.input_modalities?.includes('image') ?? false,
      tools: model.supported_parameters?.includes('tools') ?? false
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return modelCache
}

async function modelInfo(id: string): Promise<OpenRouterModel | undefined> {
  try {
    return (await listOpenRouterModels()).find((model) => model.id === id)
  } catch {
    return undefined
  }
}

const VIEWS: ViewName[] = ['iso', 'top', 'front', 'right', 'back', 'left', 'bottom']

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_model',
      description: 'Read model.scad with line numbers, plus the part list, imported assets and extra operations.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_model',
      description: 'Replace the whole content of model.scad.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'Complete new OpenSCAD source' } },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_model',
      description: 'Replace one exact snippet of model.scad. old_text must appear exactly once (without line-number prefixes).',
      parameters: {
        type: 'object',
        properties: { old_text: { type: 'string' }, new_text: { type: 'string' } },
        required: ['old_text', 'new_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'render_model',
      description: 'Render the current model with OpenSCAD. Returns errors, warnings, ECHO output, bounding box and volume.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'view_model',
      description: 'Render the model and look at it from a named view. Returns an image.',
      parameters: {
        type: 'object',
        properties: { view: { type: 'string', enum: VIEWS } },
        required: ['view']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'inspect_asset',
      description: 'Report size, bounding box and volume of an imported mesh in assets/.',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string', description: 'File name inside assets/, e.g. bracket.stl' } },
        required: ['file']
      }
    }
  }
]

interface ToolOutcome {
  text: string
  image?: string
}

async function runTool(context: AiRunContext, call: ToolCall, vision: boolean): Promise<ToolOutcome> {
  let args: Record<string, string> = {}
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
  } catch {
    return { text: 'Error: the tool arguments were not valid JSON.' }
  }
  switch (call.function.name) {
    case 'read_model': {
      const assets = listAssets(context.dir)
      return {
        text: [
          `model.scad:\n${numberedCode(context.readCode())}`,
          `Current part: ${context.part || '(none)'}`,
          `Assets: ${assets.length ? assets.join(', ') : '(none)'}`,
          describeOperations(context.ops)
        ].join('\n\n')
      }
    }
    case 'write_model': {
      if (typeof args.code !== 'string' || !args.code.trim()) return { text: 'Error: code is empty.' }
      context.writeCode(args.code)
      return { text: `Saved model.scad (${args.code.split('\n').length} lines). Render it to check.` }
    }
    case 'edit_model': {
      const code = context.readCode()
      const oldText = args.old_text ?? ''
      if (!oldText) return { text: 'Error: old_text is empty.' }
      const count = code.split(oldText).length - 1
      if (count === 0) return { text: 'Error: old_text was not found. Read the model again and copy the text exactly.' }
      if (count > 1) return { text: `Error: old_text appears ${count} times. Include more surrounding text so it is unique.` }
      context.writeCode(code.replace(oldText, () => args.new_text ?? ''))
      return { text: 'Edited model.scad. Render it to check.' }
    }
    case 'render_model':
      return { text: summariseRender(await context.render()) }
    case 'view_model': {
      const view = (VIEWS.includes(args.view as ViewName) ? args.view : 'iso') as ViewName
      const result = await context.render()
      if (!result.ok) return { text: summariseRender(result) }
      if (!vision) return { text: `${summariseRender(result)}\n(This model cannot see images, so only the numbers are returned.)` }
      const image = await context.captureView(view, result)
      if (!image) return { text: 'The preview could not be captured.' }
      return { text: `${summariseRender(result)}\nThe ${view} view is attached in the next message.`, image }
    }
    case 'inspect_asset': {
      const name = (args.file ?? '').replace(/^assets[\\/]/, '')
      const path = join(context.dir, 'assets', name)
      if (!name || !existsSync(path) || !name.toLowerCase().endsWith('.stl')) return { text: `Error: assets/${name} is not an STL in this project.` }
      const stats = analyseMesh(readStl(new Uint8Array(readFileSync(path))))
      return {
        text: `assets/${name}: size ${stats.size.join(' x ')} mm, x ${stats.min[0]}..${stats.max[0]}, y ${stats.min[1]}..${stats.max[1]}, z ${stats.min[2]}..${stats.max[2]}, volume ${stats.volumeCm3} cm3, ${stats.shells} piece(s).`
      }
    }
    default:
      return { text: `Error: unknown tool ${call.function.name}` }
  }
}

function toolLabel(call: ToolCall): string {
  let args: Record<string, string> = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    args = {}
  }
  switch (call.function.name) {
    case 'read_model':
      return 'Reading the model'
    case 'write_model':
      return 'Rewriting model.scad'
    case 'edit_model':
      return 'Editing model.scad'
    case 'render_model':
      return 'Rendering'
    case 'view_model':
      return `Looking at the ${args.view ?? 'iso'} view`
    case 'inspect_asset':
      return `Inspecting ${args.file ?? 'asset'}`
    default:
      return call.function.name
  }
}

function stripOldImages(messages: ApiMessage[]): ApiMessage[] {
  const lastImageIndex = messages.reduce(
    (found, message, index) => (Array.isArray(message.content) && message.content.some((p) => p.type === 'image_url') ? index : found),
    -1
  )
  return messages.map((message, index) => {
    if (!Array.isArray(message.content) || index === lastImageIndex) return message
    return {
      ...message,
      content: message.content.map((part) => (part.type === 'image_url' ? { type: 'text' as const, text: '(earlier image removed)' } : part))
    }
  })
}

function trimTranscript(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length <= KEPT_TRANSCRIPT) return messages
  let start = messages.length - KEPT_TRANSCRIPT
  while (start < messages.length && messages[start].role !== 'user') start++
  return messages.slice(start)
}

export async function runOpenRouter(
  context: AiRunContext,
  prompt: string,
  transcript: ApiMessage[],
  images: { label: string; dataUrl: string }[]
): Promise<ApiMessage[]> {
  const settings = loadSettings()
  if (!settings.openrouterApiKey) throw new Error('Add your OpenRouter API key in Settings first.')
  const info = await modelInfo(settings.openrouterModel)
  const vision = info?.vision ?? false
  const userContent: ContentPart[] = [{ type: 'text', text: prompt }]
  if (vision) {
    for (const image of images) {
      userContent.push({ type: 'text', text: `${image.label}:` })
      userContent.push({ type: 'image_url', image_url: { url: image.dataUrl } })
    }
  } else if (images.length) {
    userContent.push({ type: 'text', text: `(${images.length} image(s) were attached, but this model cannot see images.)` })
  }
  const history: ApiMessage[] = [...trimTranscript(transcript), { role: 'user', content: userContent }]
  const system: ApiMessage = {
    role: 'system',
    content: systemPrompt(
      'Use the tools to read, edit, render and look at the model. Always call read_model before your first edit in a conversation turn.'
    )
  }
  for (let step = 0; step < MAX_STEPS; step++) {
    if (context.signal.aborted) break
    const response = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      signal: context.signal,
      headers: {
        Authorization: `Bearer ${settings.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/3d-studio/3d-studio',
        'X-Title': '3D Studio'
      },
      body: JSON.stringify({
        model: settings.openrouterModel,
        messages: [system, ...stripOldImages(history)],
        tools: TOOLS,
        tool_choice: 'auto'
      })
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`OpenRouter error ${response.status}: ${detail.slice(0, 500)}`)
    }
    const body = (await response.json()) as {
      choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[]
      error?: { message: string }
    }
    if (body.error) throw new Error(body.error.message)
    const message = body.choices?.[0]?.message
    if (!message) throw new Error('OpenRouter returned no answer.')
    history.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls })
    if (message.content?.trim()) context.addMessage('assistant', message.content.trim())
    if (!message.tool_calls?.length) break
    const images: string[] = []
    for (const call of message.tool_calls) {
      if (context.signal.aborted) break
      context.addMessage('tool', toolLabel(call))
      const outcome = await runTool(context, call, vision)
      history.push({ role: 'tool', tool_call_id: call.id, content: outcome.text })
      if (outcome.image) images.push(outcome.image)
    }
    if (images.length) {
      history.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Images returned by view_model:' },
          ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
        ]
      })
    }
  }
  return history.map((message) =>
    Array.isArray(message.content)
      ? { ...message, content: message.content.map((part) => (part.type === 'image_url' ? { type: 'text' as const, text: '(image)' } : part)) }
      : message
  )
}
