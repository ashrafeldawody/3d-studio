import { useState } from 'react'
import type { ChatAttachments } from '@shared/types'
import { readImageFile } from '../lib/images'

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

  const addFiles = async (files: File[]): Promise<void> => {
    const added = await Promise.all(files.filter((file) => file.type.startsWith('image/')).map(readImageFile))
    setImages((current) => [...current, ...added])
  }

  const start = (): void => {
    if (!prompt.trim() && !images.length) return
    onStart(name.trim(), prompt.trim() ||'Make the part shown in the photo.', { images, pins: [] })
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>What do you want to make?</h1>
        <p className="muted">Describe it in your own words. Add a photo or a sketch if it helps. You can change anything afterwards just by asking.</p>
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
          onPaste={(event) => {
            const files = [...event.clipboardData.files]
            if (files.length) {
              event.preventDefault()
              addFiles(files)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            addFiles([...event.dataTransfer.files])
          }}
          onDragOver={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              start()
            }
          }}
        />
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
            📎 Add photo or sketch
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
          <button className="primary big" disabled={!prompt.trim() && !images.length} onClick={start}>
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
          <button onClick={onImport}>Change an existing file (STL / 3MF / SCAD)</button>
          <button onClick={onOpen}>Open a project</button>
          <button onClick={onCreateEmpty}>Start empty</button>
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
