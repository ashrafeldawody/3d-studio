import { spawn } from 'child_process'
import { RENDER_SOURCE_NAME } from '../openscad'
import { loadSettings } from '../settings'
import { AiRunContext, describeOperations } from './context'
import { systemPrompt } from './prompt'

interface StreamEvent {
  type: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  message?: { content?: ({ type: string; text?: string; name?: string; input?: Record<string, unknown> } | string)[] | string }
}

function describeToolUse(name: string, input: Record<string, unknown> = {}): string {
  const file = String(input.file_path ?? input.path ?? input.pattern ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
  switch (name) {
    case 'Read':
      return `Reading ${file}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${file}`
    case 'Write':
      return `Writing ${file}`
    case 'Bash':
      return `Running: ${String(input.command ?? '').slice(0, 120)}`
    case 'Glob':
    case 'Grep':
      return `Searching ${file}`
    default:
      return name
  }
}

export interface ClaudeCodeResult {
  sessionId?: string
  isError: boolean
}

export function runClaudeCode(
  context: AiRunContext,
  prompt: string,
  sessionId: string | undefined,
  imagePaths: { label: string; path: string }[]
): Promise<ClaudeCodeResult> {
  const settings = loadSettings()
  const tools = ['Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep']
  if (settings.claudeAllowBash) tools.push('Bash')
  const renderHint = settings.claudeAllowBash
    ? `To check your work, render with: "${settings.openscadPath}" -o .studio/check.stl ${RENDER_SOURCE_NAME} (the app regenerates ${RENDER_SOURCE_NAME} from model.scad when it renders; you can also render model.scad directly).`
    : 'You cannot run commands. The app renders model.scad automatically after you finish and sends you any errors.'
  const extra = [
    'Edit model.scad in the current folder with your file tools. Do not create other model files unless asked.',
    renderHint,
    describeOperations(context.ops),
    `Current part: ${context.part || '(none)'}.`
  ].join('\n')
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    tools.join(','),
    '--append-system-prompt',
    systemPrompt(extra)
  ]
  if (sessionId) args.push('--resume', sessionId)
  if (settings.claudeModel) args.push('--model', settings.claudeModel)
  const fullPrompt = imagePaths.length
    ? `${prompt}\n\nImages for this request (read them with your Read tool):\n${imagePaths.map((image) => `- ${image.label}: ${image.path}`).join('\n')}`
    : prompt
  return new Promise((resolve, reject) => {
    const child = spawn(settings.claudePath || 'claude', args, {
      cwd: context.dir,
      windowsHide: true,
      env: { ...process.env }
    })
    let buffer = ''
    let stderr = ''
    let result: ClaudeCodeResult = { sessionId, isError: false }
    const onAbort = (): void => {
      child.kill()
    }
    context.signal.addEventListener('abort', onAbort)
    child.stdin.write(fullPrompt)
    child.stdin.end()
    const handle = (event: StreamEvent): void => {
      if (event.session_id) result.sessionId = event.session_id
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message!.content) {
          if (typeof block === 'string') continue
          if (block.type === 'text' && block.text?.trim()) context.addMessage('assistant', block.text.trim())
          if (block.type === 'tool_use') context.addMessage('tool', describeToolUse(block.name ?? '', block.input))
        }
      }
      if (event.type === 'result') {
        result = { sessionId: event.session_id ?? result.sessionId, isError: Boolean(event.is_error) }
        if (event.is_error && event.result) context.addMessage('error', event.result)
        if (typeof event.total_cost_usd === 'number') context.addMessage('info', `Claude Code turn cost $${event.total_cost_usd.toFixed(3)}`)
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) {
          try {
            handle(JSON.parse(line))
          } catch {
            context.addMessage('info', line)
          }
        }
        newline = buffer.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error: NodeJS.ErrnoException) => {
      context.signal.removeEventListener('abort', onAbort)
      if (error.code === 'ENOENT') {
        reject(new Error(`Claude Code CLI was not found ("${settings.claudePath}"). Install it or set its path in Settings.`))
      } else {
        reject(error)
      }
    })
    child.on('close', (code) => {
      context.signal.removeEventListener('abort', onAbort)
      if (context.signal.aborted) {
        resolve({ ...result, isError: true })
        return
      }
      if (code !== 0 && !result.sessionId) {
        reject(new Error(stderr.trim() || `Claude Code exited with code ${code}`))
        return
      }
      resolve(result)
    })
  })
}
