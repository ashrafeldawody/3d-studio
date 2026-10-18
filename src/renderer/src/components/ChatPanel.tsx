import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiProvider, ChatAttachments, ClaudeEffort, ChatMessage, CliAgent, OpenRouterModel, Settings } from '@shared/types'
import { formatFileSize, readChatFiles } from '../lib/chatFiles'
import { AiActivityState, AiStatusCard } from './AiActivity'

interface Props {
  messages: ChatMessage[]
  busy: boolean
  activity: AiActivityState
  settings: Settings
  attachments: ChatAttachments
  onAttachmentsChange(attachments: ChatAttachments): void
  onSend(prompt: string): void
  onStop(): void
  onClear(): void
  onSettings(update: Partial<Settings>): void
  onOpenSettings(): void
}

const CLAUDE_MODELS = [
  { id: '', label: 'Default model' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]

const CLAUDE_EFFORTS: { id: ClaudeEffort; label: string }[] = [
  { id: '', label: 'Default effort' },
  { id: 'low', label: 'Low effort' },
  { id: 'medium', label: 'Medium effort' },
  { id: 'high', label: 'High effort' },
  { id: 'xhigh', label: 'Extra high effort' },
  { id: 'max', label: 'Max effort' }
]

export function ChatPanel({ messages, busy, activity, settings, attachments, onAttachmentsChange, onSend, onStop, onClear, onSettings, onOpenSettings }: Props) {
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages, busy, activity.step])

  useEffect(() => {
    if (settings.aiProvider !== 'openrouter' || models.length) return
    window.studio.ai
      .models()
      .then(setModels)
      .catch((error) => setModelError(error.message))
  }, [settings.aiProvider])

  const filtered = useMemo(() => {
    const term = modelFilter.toLowerCase()
    return models.filter((model) => model.tools && (model.id.toLowerCase().includes(term) || model.name.toLowerCase().includes(term))).slice(0, 80)
  }, [models, modelFilter])

  const current = models.find((model) => model.id === settings.openrouterModel)

  const [dropping, setDropping] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const addFiles = async (files: File[]): Promise<void> => {
    if (!files.length) return
    const read = await readChatFiles(files)
    setFileError(read.errors.length ? read.errors.join(' ') : null)
    if (!read.images.length && !read.files.length) return
    onAttachmentsChange({
      ...attachments,
      images: [...attachments.images, ...read.images],
      files: [...(attachments.files ?? []), ...read.files]
    })
  }

  const attachedFiles = attachments.files ?? []
  const hasAttachments = attachments.images.length > 0 || attachments.pins.length > 0 || attachedFiles.length > 0

  const submit = (): void => {
    const prompt = draft.trim() || (hasAttachments ? 'See the attached files, images and pins.' : '')
    if (!prompt || busy) return
    onSend(prompt)
    setDraft('')
  }

  const needsKey = settings.aiProvider === 'openrouter' && !settings.openrouterApiKey

  return (
    <div
      className={`chat-panel${dropping ? ' dropping' : ''}`}
      data-chat-drop
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(event) => {
        setDropping(false)
        const files = [...event.dataTransfer.files]
        if (!files.length) return
        event.preventDefault()
        addFiles(files)
      }}
    >
      {dropping && <div className="chat-drop-hint">Drop to attach to the chat</div>}
      <div className="chat-header">
        <select value={settings.aiProvider} onChange={(event) => onSettings({ aiProvider: event.target.value as AiProvider })}>
          <option value="openrouter">OpenRouter</option>
          <option value="claude-code">Claude Code CLI</option>
          <option value="codex">Codex CLI</option>
          <option value="grok">Grok CLI</option>
          <option value="agy">Antigravity CLI</option>
        </select>
        {settings.aiProvider === 'openrouter' ? (
          <div className="model-picker">
            <button className="model-button" onClick={() => setPickerOpen(!pickerOpen)} title={settings.openrouterModel}>
              {current?.name ?? settings.openrouterModel}
              {current?.vision ? ' 👁' : ''}
            </button>
            {pickerOpen && (
              <div className="model-dropdown">
                <input autoFocus placeholder="Search models with tool support" value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} />
                {modelError && <div className="error-text">{modelError}</div>}
                <div className="model-list">
                  {filtered.map((model) => (
                    <button
                      key={model.id}
                      className={model.id === settings.openrouterModel ? 'active' : ''}
                      onClick={() => {
                        onSettings({ openrouterModel: model.id })
                        setPickerOpen(false)
                      }}
                    >
                      <span>{model.name}</span>
                      <small>
                        {model.id}
                        {model.vision ? ' · sees images' : ''}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {settings.aiProvider === 'claude-code' ? (
              <select title="Claude model" value={settings.claudeModel} onChange={(event) => onSettings({ claudeModel: event.target.value })}>
                {CLAUDE_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            ) : (
              <AgentModelPicker agent={settings.aiProvider} settings={settings} onSettings={onSettings} />
            )}
            <select
              title="How hard the AI thinks. Higher is slower and costs more, but handles tricky parts better."
              value={settings.claudeEffort ?? ''}
              onChange={(event) => onSettings({ claudeEffort: event.target.value as ClaudeEffort })}
            >
              {CLAUDE_EFFORTS.map((effort) => (
                <option key={effort.id} value={effort.id}>
                  {effort.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button title="Clear conversation" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>
      <div className="chat-messages" ref={scroller}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Describe what to make or change. Examples:</p>
            <ul>
              <li>Make a wall bracket for a 25 mm pipe with two 4 mm screw holes</li>
              <li>Make the hook 2 mm longer and round its tip</li>
              <li>Cut this part in half along X so it fits my printer</li>
            </ul>
          </div>
        )}
        {messages.map((message, index) => {
          const { text, options } = splitOptions(message.text)
          const isLatestAssistant = message.role === 'assistant' && !messages.slice(index + 1).some((later) => later.role === 'user' || later.role === 'assistant')
          return (
          <div key={message.id} className={`chat-message ${message.role}`}>
            {message.thumbnails && message.thumbnails.length > 0 && (
              <div className="message-thumbs">
                {message.thumbnails.map((thumbnail, index) => (
                  <img key={index} src={thumbnail} alt="" />
                ))}
              </div>
            )}
            {message.role === 'assistant' ? text : message.text}
            {options.length > 0 && isLatestAssistant && !busy && (
              <div className="chat-options">
                {options.map((option) => (
                  <button key={option} onClick={() => onSend(option)}>
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
          )
        })}
        {busy && <AiStatusCard activity={activity} />}
      </div>
      {needsKey && (
        <div className="chat-notice">
          Add an OpenRouter API key in <button className="link" onClick={onOpenSettings}>Settings</button> to chat.
        </div>
      )}
      <div className="chat-input">
        {fileError && <div className="error-text">{fileError}</div>}
        {hasAttachments && (
          <div className="composer-attachments">
            {attachments.images.map((image, index) => (
              <div key={index} className="attachment-image" title={image.name}>
                <img src={image.thumbnail} alt={image.name} />
                <button
                  title="Remove"
                  onClick={() => onAttachmentsChange({ ...attachments, images: attachments.images.filter((_, i) => i !== index) })}
                >
                  ✕
                </button>
              </div>
            ))}
            {attachedFiles.map((item, index) => (
              <div key={`${item.name}-${index}`} className="attachment-file" title={item.path ?? item.name}>
                <span className="attachment-file-icon">📄</span>
                <span className="attachment-file-name">{item.name}</span>
                <small>{formatFileSize(item.size)}</small>
                <button title="Remove" onClick={() => onAttachmentsChange({ ...attachments, files: attachedFiles.filter((_, i) => i !== index) })}>
                  ✕
                </button>
              </div>
            ))}
            {attachments.pins.map((pin) => (
              <div key={pin.id} className="attachment-pin">
                <span className="pin-badge">{pin.id}</span>
                <input
                  placeholder={`Note for pin ${pin.id} (e.g. make this 2 mm thicker)`}
                  value={pin.note}
                  onChange={(event) =>
                    onAttachmentsChange({
                      ...attachments,
                      pins: attachments.pins.map((item) => (item.id === pin.id ? { ...item, note: event.target.value } : item))
                    })
                  }
                />
                <button title="Remove pin" onClick={() => onAttachmentsChange({ ...attachments, pins: attachments.pins.filter((item) => item.id !== pin.id) })}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          onPaste={(event) => {
            const files = [...event.clipboardData.files]
            if (files.length) {
              event.preventDefault()
              addFiles(files)
            }
          }}
          value={draft}
          placeholder="Ask for a change... Drop or paste any file here. Right-click the model for more."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="chat-actions">
          <div className="chat-tools">
            <label className="attach-button" title="Attach any file: photos, sketches, drawings, documents, 3D models (you can also drop or paste)">
              📎 Attach
              <input
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  addFiles([...(event.target.files ?? [])])
                  event.target.value = ''
                }}
              />
            </label>
            <label className="checkbox" title="Also send a picture of the current 3D view">
              <input type="checkbox" checked={settings.attachViewToAi} onChange={(event) => onSettings({ attachViewToAi: event.target.checked })} />
              Auto view
            </label>
          </div>
          {busy ? (
            <button className="danger" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button className="primary" onClick={submit} disabled={(!draft.trim() && !hasAttachments) || needsKey}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const OPTION_PATTERN = /\[\[option:\s*([^\]]+?)\s*\]\]/gi

function splitOptions(text: string): { text: string; options: string[] } {
  const options = [...text.matchAll(OPTION_PATTERN)].map((match) => match[1])
  return { text: text.replace(OPTION_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim(), options }
}

const MODEL_SETTING: Record<CliAgent, 'codexModel' | 'grokModel' | 'agyModel'> = {
  codex: 'codexModel',
  grok: 'grokModel',
  agy: 'agyModel'
}

function AgentModelPicker({ agent, settings, onSettings }: { agent: CliAgent; settings: Settings; onSettings(update: Partial<Settings>): void }) {
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null)
  const key = MODEL_SETTING[agent]
  const value = settings[key]

  useEffect(() => {
    setModels(null)
    let current = true
    window.studio.ai
      .agentModels(agent)
      .then((list) => current && setModels(list))
      .catch(() => current && setModels([]))
    return () => {
      current = false
    }
  }, [agent])

  if (models && !models.length) {
    return (
      <input
        className="agent-model"
        title="Model name, or leave empty for the CLI's default"
        placeholder="Default model"
        defaultValue={value}
        key={agent}
        onBlur={(event) => event.target.value.trim() !== value && onSettings({ [key]: event.target.value.trim() })}
        onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
      />
    )
  }
  const options = models ?? []
  return (
    <select title="Model" value={value} onChange={(event) => onSettings({ [key]: event.target.value })}>
      <option value="">{models ? 'Default model' : 'Loading models...'}</option>
      {value && !options.some((model) => model.id === value) && <option value={value}>{value}</option>}
      {options.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  )
}
