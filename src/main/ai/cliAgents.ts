import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { ClaudeEffort, CliAgent, Settings } from '@shared/types'
import { studioDir } from '../project'
import { loadSettings } from '../settings'
import { AiRunContext, describeOperations } from './context'
import { systemPrompt } from './prompt'

export const AGENT_NAMES: Record<CliAgent, string> = {
  codex: 'Codex CLI',
  grok: 'Grok CLI',
  agy: 'Antigravity CLI'
}

export interface AgentResult {
  sessionId?: string
  isError: boolean
}

interface AgentState {
  sessionId?: string
  isError: boolean
  text: string
}

interface Reporter {
  say(text: string): void
  tool(text: string): void
  error(text: string): void
  info(text: string): void
}

interface Invocation {
  args: string[]
  stdin?: string
}

type JsonEvent = Record<string, any>

interface AgentAdapter {
  invocation(request: AgentRequest): Invocation
  handle(event: JsonEvent, state: AgentState, report: Reporter): void
}

interface AgentRequest {
  settings: Settings
  dir: string
  prompt: string
  instructions: string
  sessionId?: string
  images: { label: string; path: string }[]
}

const fileName = (value: unknown): string => basename(String(value ?? '').replace(/\\/g, '/'))

function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const file = fileName(input.file_path ?? input.path ?? input.AbsolutePath ?? input.TargetFile ?? input.target_file ?? input.target_directory ?? '')
  const command = String(input.command ?? input.CommandLine ?? input.cmd ?? '')
  if (/read|view/i.test(name)) return file ? `Reading ${file}` : 'Reading'
  if (/write|create/i.test(name)) return file ? `Writing ${file}` : 'Writing'
  if (/replace|edit|patch/i.test(name)) return file ? `Editing ${file}` : 'Editing'
  if (/terminal|command|shell|exec|bash/i.test(name)) return command ? `Running: ${command.slice(0, 120)}` : 'Running a command'
  if (/grep|search|find|list|glob/i.test(name)) return file ? `Searching ${file}` : 'Searching'
  return name
}

const imageList = (images: AgentRequest['images']): string =>
  images.length ? `\n\nImages for this request (open them with your file viewing tool):\n${images.map((image) => `- ${image.label}: ${image.path}`).join('\n')}` : ''

const EFFORTS: Record<CliAgent, Partial<Record<ClaudeEffort, string>>> = {
  codex: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' },
  grok: { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' },
  agy: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
}

const codex: AgentAdapter = {
  invocation({ settings, dir, prompt, instructions, sessionId, images }) {
    const options = ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', '-c', `developer_instructions=${JSON.stringify(instructions)}`]
    if (settings.codexModel) options.push('-m', settings.codexModel)
    const effort = EFFORTS.codex[settings.claudeEffort]
    if (effort) options.push('-c', `model_reasoning_effort="${effort}"`)
    for (const image of images) options.push('-i', join(dir, image.path))
    const args = sessionId ? ['exec', 'resume', ...options, sessionId, '-'] : ['exec', ...options, '-']
    const labels = images.length ? `\n\nAttached images, in order: ${images.map((image) => image.label).join('; ')}` : ''
    return { args, stdin: `${prompt}${labels}` }
  },
  handle(event, state, report) {
    if (event.type === 'thread.started' && event.thread_id) state.sessionId = event.thread_id
    const item = event.item
    if (event.type === 'item.started' && item?.type === 'command_execution') report.tool(`Running: ${String(item.command ?? '').slice(0, 120)}`)
    if (event.type === 'item.completed' && item) {
      if (item.type === 'agent_message' && item.text?.trim()) report.say(item.text.trim())
      if (item.type === 'file_change') {
        for (const change of item.changes ?? []) report.tool(`${change.kind === 'add' ? 'Writing' : 'Editing'} ${fileName(change.path)}`)
      }
      if (item.type === 'error' && item.message) report.info(item.message)
    }
    if (event.type === 'turn.failed') {
      state.isError = true
      report.error(event.error?.message ?? 'Codex failed.')
    }
    if (event.type === 'error' && event.message) {
      state.isError = true
      report.error(event.message)
    }
  }
}

const grok: AgentAdapter = {
  invocation({ settings, dir, prompt, instructions, sessionId, images }) {
    const promptFile = join(studioDir(dir), 'ai-prompt.md')
    writeFileSync(promptFile, `${prompt}${imageList(images)}`)
    const args = ['--prompt-file', promptFile, '--output-format', 'streaming-json', '--rules', instructions, '--no-subagents']
    args.push('--permission-mode', settings.claudeAllowBash ? 'bypassPermissions' : 'acceptEdits')
    if (settings.grokModel) args.push('-m', settings.grokModel)
    const effort = EFFORTS.grok[settings.claudeEffort]
    if (effort) args.push('--reasoning-effort', effort)
    if (sessionId) args.push('--resume', sessionId)
    return { args }
  },
  handle(event, state, report) {
    if (event.type === 'text' && typeof event.data === 'string') state.text += event.data
    if (event.type === 'tool_call') {
      flush(state, report)
      report.tool(describeTool(String(event.toolName ?? event.title ?? ''), event.rawInput))
    }
    if (event.type === 'end') {
      flush(state, report)
      if (event.sessionId) state.sessionId = event.sessionId
      if (event.stopReason && !['end_turn', 'stop', 'max_turns'].includes(event.stopReason)) state.isError = true
    }
    if (event.type === 'error') {
      flush(state, report)
      state.isError = true
      report.error(String(event.message ?? event.data ?? 'Grok failed.'))
    }
  }
}

const agy: AgentAdapter = {
  invocation({ settings, prompt, instructions, sessionId, images }) {
    const fullPrompt = `<app_instructions>\n${instructions}\n</app_instructions>\n\n<user_request>\n${prompt}${imageList(images)}\n</user_request>`
    const args = ['-p', fullPrompt, '--output-format', 'stream-json', '--disable-slash-commands']
    if (settings.claudeAllowBash) args.push('--dangerously-skip-permissions')
    else args.push('--mode', 'accept-edits')
    if (settings.agyModel) args.push('--model', settings.agyModel)
    const effort = EFFORTS.agy[settings.claudeEffort]
    if (effort) args.push('--effort', effort)
    if (sessionId) args.push('--conversation', sessionId)
    return { args }
  },
  handle(event, state, report) {
    if (event.event === 'init' && event.conversation_id) state.sessionId = event.conversation_id
    const step = event.step_update
    if (event.event === 'step_update' && step) {
      if (step.conversation_id) state.sessionId = step.conversation_id
      if (step.step_type === 'agent_response') {
        if (typeof step.text_delta === 'string') state.text += step.text_delta
        if (step.state === 'DONE') flush(state, report)
      }
      if (step.step_type === 'tool' && step.state === 'ACTIVE') report.tool(describeTool(String(step.tool_name ?? ''), step.tool_info?.parameters))
    }
    if (event.event === 'result' && event.result) {
      flush(state, report)
      if (event.result.conversation_id) state.sessionId = event.result.conversation_id
      if (event.result.status && event.result.status !== 'SUCCESS') {
        state.isError = true
        report.error(String(event.result.error ?? event.result.response ?? `Antigravity finished with status ${event.result.status}`))
      }
    }
    if (event.event === 'error') {
      state.isError = true
      report.error(String(event.error?.message ?? event.message ?? 'Antigravity failed.'))
    }
  }
}

const ADAPTERS: Record<CliAgent, AgentAdapter> = { codex, grok, agy }

function flush(state: AgentState, report: Reporter): void {
  const text = state.text.trim()
  state.text = ''
  if (text) report.say(text)
}

export const agentPath = (settings: Settings, agent: CliAgent): string =>
  ({ codex: settings.codexPath, grok: settings.grokPath, agy: settings.agyPath })[agent] || agent

export function runCliAgent(
  agent: CliAgent,
  context: AiRunContext,
  prompt: string,
  sessionId: string | undefined,
  images: { label: string; path: string }[]
): Promise<AgentResult> {
  const settings = loadSettings()
  const name = AGENT_NAMES[agent]
  const renderHint = settings.claudeAllowBash
    ? `To check your work you may render with: "${settings.openscadPath}" -o .studio/check.stl model.scad`
    : 'Do not run commands. The app renders model.scad automatically after you finish and sends you any errors.'
  const instructions = systemPrompt(
    [
      'You are running inside the 3D Studio app. Edit model.scad in the current folder with your file editing tools. Do not create other model files unless asked.',
      renderHint,
      describeOperations(context.ops),
      `Current part: ${context.part || '(none)'}.`
    ].join('\n')
  )
  const adapter = ADAPTERS[agent]
  const { args, stdin } = adapter.invocation({ settings, dir: context.dir, prompt, instructions, sessionId, images })
  const executable = agentPath(settings, agent)
  const report: Reporter = {
    say: (text) => context.addMessage('assistant', text),
    tool: (text) => context.addMessage('tool', text),
    error: (text) => context.addMessage('error', text),
    info: (text) => context.addMessage('info', text)
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: context.dir,
      windowsHide: true,
      env: { ...process.env },
      shell: /\.(cmd|bat)$/i.test(executable)
    })
    const state: AgentState = { sessionId, isError: false, text: '' }
    let buffer = ''
    let stderr = ''
    const onAbort = (): void => {
      child.kill()
    }
    context.signal.addEventListener('abort', onAbort)
    if (stdin !== undefined) child.stdin.write(stdin)
    child.stdin.end()
    const handleLine = (line: string): void => {
      let event: JsonEvent
      try {
        event = JSON.parse(line)
      } catch {
        if (!/^Reading additional input from stdin/i.test(line)) stderr += `${line}\n`
        return
      }
      adapter.handle(event, state, report)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) handleLine(line)
        newline = buffer.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error: NodeJS.ErrnoException) => {
      context.signal.removeEventListener('abort', onAbort)
      if (error.code === 'ENOENT') reject(new Error(`${name} was not found ("${executable}"). Install it or set its path in Settings.`))
      else reject(error)
    })
    child.on('close', (code) => {
      context.signal.removeEventListener('abort', onAbort)
      if (buffer.trim()) handleLine(buffer.trim())
      flush(state, report)
      if (context.signal.aborted) {
        resolve({ sessionId: state.sessionId, isError: true })
        return
      }
      if (code !== 0 && !state.isError) {
        const detail = stderr.trim().split('\n').slice(-6).join('\n')
        reject(new Error(detail || `${name} exited with code ${code}`))
        return
      }
      resolve({ sessionId: state.sessionId, isError: state.isError })
    })
  })
}

export function listAgentModels(agent: CliAgent): Promise<{ id: string; label: string }[]> {
  if (agent === 'codex') return Promise.resolve([])
  const executable = agentPath(loadSettings(), agent)
  return new Promise((resolve) => {
    const child = spawn(executable, ['models'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => child.kill(), 30000)
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      resolve([])
    })
    child.on('close', () => {
      clearTimeout(timer)
      const models =
        agent === 'grok'
          ? [...output.matchAll(/^\s*[*-]\s+(\S+)/gm)].map((match) => ({ id: match[1], label: match[1] }))
          : [...output.matchAll(/^([\w.-]+)\t(.+)$/gm)].map((match) => ({ id: match[1], label: match[2].trim() }))
      resolve(models)
    })
  })
}
