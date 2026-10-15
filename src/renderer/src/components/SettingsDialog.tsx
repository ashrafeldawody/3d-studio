import { useState } from 'react'
import type { Settings } from '@shared/types'

interface Props {
  settings: Settings
  onSave(update: Partial<Settings>): void
  onClose(): void
}

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings)
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setDraft({ ...draft, [key]: value })

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>Settings</h2>
        <section>
          <h3>OpenSCAD</h3>
          <label className="field">
            <span>OpenSCAD program</span>
            <input value={draft.openscadPath} onChange={(event) => set('openscadPath', event.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={draft.autoRender} onChange={(event) => set('autoRender', event.target.checked)} />
            Render automatically while typing
          </label>
          <div className="row">
            <label className="field">
              <span>Bed width (mm)</span>
              <input type="number" value={draft.bedX} onChange={(event) => set('bedX', Number(event.target.value))} />
            </label>
            <label className="field">
              <span>Bed depth (mm)</span>
              <input type="number" value={draft.bedY} onChange={(event) => set('bedY', Number(event.target.value))} />
            </label>
          </div>
        </section>
        <section>
          <h3>OpenRouter</h3>
          <label className="field">
            <span>API key</span>
            <input type="password" value={draft.openrouterApiKey} placeholder="sk-or-..." onChange={(event) => set('openrouterApiKey', event.target.value)} />
          </label>
          <p className="hint">Stored encrypted on this computer. Get a key at openrouter.ai/keys.</p>
        </section>
        <section>
          <h3>Claude Code</h3>
          <label className="field">
            <span>Claude Code program</span>
            <input value={draft.claudePath} onChange={(event) => set('claudePath', event.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={draft.claudeAllowBash} onChange={(event) => set('claudeAllowBash', event.target.checked)} />
            Let Claude Code run commands (needed for it to render and check its own work)
          </label>
        </section>
        <section>
          <h3>Assistant</h3>
          <label className="checkbox">
            <input type="checkbox" checked={draft.autoFixRenderErrors} onChange={(event) => set('autoFixRenderErrors', event.target.checked)} />
            If the AI leaves the model broken, send it the errors automatically
          </label>
          <label className="field">
            <span>Extra instructions for every AI request</span>
            <textarea
              rows={4}
              value={draft.aiInstructions}
              placeholder="e.g. Never write comments in code. My printer is a Snapmaker U1."
              onChange={(event) => set('aiInstructions', event.target.value)}
            />
          </label>
        </section>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
