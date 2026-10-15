import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiProvider, ChatAttachments, ChatMessage, OpenRouterModel, Settings } from '@shared/types'
import { readImageFile } from '../lib/images'

interface Props {
  messages: ChatMessage[]
  busy: boolean
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
  { id: '', label: 'Default' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]

export function ChatPanel({ messages, busy, settings, attachments, onAttachmentsChange, onSend, onStop, onClear, onSettings, onOpenSettings }: Props) {
  const [draft, setDraft] = useState('')
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages, busy])

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

  const addFiles = async (files: File[]): Promise<void> => {
    const images = await Promise.all(files.filter((file) => file.type.startsWith('image/')).map(readImageFile))
    if (images.length) onAttachmentsChange({ ...attachments, images: [...attachments.images, ...images] })
  }

  const hasAttachments = attachments.images.length > 0 || attachments.pins.length > 0

  const submit = (): void => {
    const prompt = draft.trim() || (hasAttachments ? 'See the attached images and pins.' : '')
    if (!prompt || busy) return
    onSend(prompt)
    setDraft('')
  }

  const needsKey = settings.aiProvider === 'openrouter' && !settings.openrouterApiKey

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <select value={settings.aiProvider} onChange={(event) => onSettings({ aiProvider: event.target.value as AiProvider })}>
          <option value="openrouter">OpenRouter</option>
          <option value="claude-code">Claude Code CLI</option>
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
          <select value={settings.claudeModel} onChange={(event) => onSettings({ claudeModel: event.target.value })}>
            {CLAUDE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
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
        {busy && <div className="chat-message info thinking">Working...</div>}
      </div>
      {needsKey && (
        <div className="chat-notice">
          Add an OpenRouter API key in <button className="link" onClick={onOpenSettings}>Settings</button> to chat.
        </div>
      )}
      <div className="chat-input">
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
            if (files.some((file) => file.type.startsWith('image/'))) {
              event.preventDefault()
              addFiles(files)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            addFiles([...event.dataTransfer.files])
          }}
          onDragOver={(event) => event.preventDefault()}
          value={draft}
          placeholder="Ask for a change... Paste or drop photos here. Use Pin or Draw in the 3D view to point at things."
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
            <label className="attach-button" title="Attach photos or sketches (you can also paste or drop images)">
              📎 Photo
              <input
                type="file"
                accept="image/*"
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
