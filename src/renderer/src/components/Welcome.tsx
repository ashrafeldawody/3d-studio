import { useState } from 'react'
import type { ChatAttachments } from '@shared/types'
import { formatFileSize, readChatFiles } from '../lib/chatFiles'

interface Props {
  recent: string[]
  onStart(name: string, prompt: string, attachments: ChatAttachments): void
  onCreateEmpty(): void
  onOpen(): void
  onImport(): void
  onOpenRecent(dir: string): void
  onSettings(): void
}

const IDEAS = [
  'A box with a sliding lid, 80 x 50 x 30 mm inside',
  'A wall hook that holds a 25 mm broom handle, with two screw holes',
  'A phone stand at 60 degrees for a phone 9 mm thick',
  'A replacement knob for a 6 mm D-shaped shaft, 30 mm wide',
  'A case for an Arduino Uno with holes for USB and power',
  'A cable organiser clip for 5 cables, 6 mm thick each'
]

export function Welcome({ recent, onStart, onCreateEmpty, onOpen, onImport, onOpenRecent, onSettings }: Props) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState<ChatAttachments['images']>([])
  const [files, setFiles] = useState<NonNullable<ChatAttachments['files']>>([])

  const addFiles = async (dropped: File[]): Promise<void> => {
    const read = await readChatFiles(dropped)
    setImages((current) => [...current, ...read.images])
    setFiles((current) => [...current, ...read.files])
  }

  const hasInput = Boolean(prompt.trim() || images.length || files.length)

  const start = (): void => {
    if (!hasInput) return
    const fallback = images.length ? 'Make the part shown in the photo.' : 'Make the part described in the attached files.'
    onStart(name.trim(), prompt.trim() || fallback, { images, pins: [], files })
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>What do you want to make?</h1>
        <p className="muted">Describe it, or start from a blank plate and build it with shapes, move, rotate and scale. The chat is optional.</p>
        <input
          className="welcome-name"
          value={name}
          placeholder="Project name (optional)"
          maxLength={48}
          onChange={(event) => setName(event.target.value)}
        />
        <textarea
          className="welcome-prompt"
          autoFocus
          value={prompt}
          placeholder="e.g. A holder for my TV remote that sticks to the side of the desk"
          onChange={(event) => setPrompt(event.target.value)}
          data-chat-drop
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files]
            if (pasted.length) {
              event.preventDefault()
              addFiles(pasted)
            }
          }}
          onDrop={(event) => {
            const dropped = [...event.dataTransfer.files]
            if (!dropped.length) return
            event.preventDefault()
            addFiles(dropped)
          }}
          onDragOver={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              start()
            }
          }}
        />
        {files.length > 0 && (
          <div className="composer-attachments">
            {files.map((item, index) => (
              <div key={`${item.name}-${index}`} className="attachment-file" title={item.path ?? item.name}>
                <span className="attachment-file-icon">📄</span>
                <span className="attachment-file-name">{item.name}</span>
                <small>{formatFileSize(item.size)}</small>
                <button onClick={() => setFiles(files.filter((_, i) => i !== index))}>✕</button>
              </div>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="welcome-images">
            {images.map((image, index) => (
              <div key={index} className="attachment-image">
                <img src={image.thumbnail} alt="" />
                <button onClick={() => setImages(images.filter((_, i) => i !== index))}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="welcome-row">
          <label className="attach-button">
            📎 Add photos or files
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
          <button onClick={onCreateEmpty}>Blank plate</button>
          <button className="primary big" disabled={!hasInput} onClick={start}>
            Make it →
          </button>
        </div>
        <div className="ideas">
          {IDEAS.map((idea) => (
            <button key={idea} className="idea" onClick={() => setPrompt(idea)}>
              {idea}
            </button>
          ))}
        </div>
        <div className="welcome-secondary">
          <button onClick={onImport} title="Or drag a file anywhere onto this window">
            Open a file (STL / 3MF / SVG / SCAD)
          </button>
          <button onClick={onOpen}>Open a project</button>
          <button onClick={onSettings}>Settings</button>
        </div>
        {recent.length > 0 && (
          <div className="recent">
            <h3>Recent</h3>
            {recent.slice(0, 6).map((dir) => (
              <button key={dir} className="recent-item" onClick={() => onOpenRecent(dir)}>
                <span>{dir.split(/[\\/]/).pop()}</span>
                <small>{dir}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
