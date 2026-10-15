import type { ChatEvent, ChatMessage, Operation, RenderResult, ViewName } from '@shared/types'

export interface AiRunContext {
  dir: string
  ops: Operation[]
  part: string
  signal: AbortSignal
  readCode(): string
  writeCode(code: string): void
  render(): Promise<RenderResult>
  captureView(view: ViewName, result?: RenderResult): Promise<string | null>
  emit(event: ChatEvent): void
  addMessage(role: ChatMessage['role'], text: string): ChatMessage
}

export function numberedCode(code: string): string {
  return code
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(4, ' ')}| ${line}`)
    .join('\n')
}

export function describeOperations(ops: Operation[]): string {
  const enabled = ops.filter((op) => op.enabled)
  if (!enabled.length) return 'No extra operations are applied on top of the code.'
  const lines = enabled.map((op) => {
    switch (op.kind) {
      case 'translate':
      case 'rotate':
      case 'scale':
        return `${op.kind} [${op.x}, ${op.y}, ${op.z}]`
      case 'mirror':
        return `mirror across ${op.axis}`
      case 'cut':
        return `cut at ${op.axis}=${op.position}, keep ${op.keep}`
      case 'removeBox':
      case 'addBox':
        return `${op.kind === 'addBox' ? 'add' : 'remove'} box from [${op.min.join(', ')}] to [${op.max.join(', ')}]`
    }
  })
  return `The user applied these operations on top of the code, in order (the app adds them when rendering; do not repeat them in the code):\n- ${lines.join('\n- ')}`
}
