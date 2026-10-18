import { useState } from 'react'
import type { Settings } from '@shared/types'
import { PRINTER_PRESETS } from '@shared/printers'

interface Props {
  settings: Settings
  onSave(update: Partial<Settings>): void
  onClose(): void
}

const validSize = (value: number, fallback: number): number => (Number.isFinite(value) && value >= 10 ? Math.min(value, 2000) : fallback)

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings)
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setDraft({ ...draft, [key]: value })
  const presetValue = PRINTER_PRESETS.some((preset) => preset.name === draft.printerName) ? draft.printerName : ''

  const choosePreset = (name: string): void => {
    const preset = PRINTER_PRESETS.find((item) => item.name === name)
    if (!preset) {
      setDraft({ ...draft, printerName: '' })
      return
    }
    const [bedX, bedY, bedZ] = preset.size
    setDraft({ ...draft, printerName: preset.name, bedX, bedY, bedZ })
  }

  const setSize = (key: 'bedX' | 'bedY' | 'bedZ', raw: string): void => {
    const next = { ...draft, [key]: Number(raw) }
    const preset = PRINTER_PRESETS.find((item) => item.name === draft.printerName)
    const stillMatches = preset && preset.size[0] === next.bedX && preset.size[1] === next.bedY && preset.size[2] === next.bedZ
    setDraft({ ...next, printerName: stillMatches ? draft.printerName : '' })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>Settings</h2>
        <section>
          <h3>Printer and build plate</h3>
          <label className="field">
            <span>Printer</span>
            <select value={presetValue} onChange={(event) => choosePreset(event.target.value)}>
              <option value="">Custom size</option>
              {PRINTER_PRESETS.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name} ({preset.size.join(' x ')} mm)
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label className="field">
              <span>Width X (mm)</span>
              <input type="number" min={10} value={draft.bedX} onChange={(event) => setSize('bedX', event.target.value)} />
            </label>
            <label className="field">
              <span>Depth Y (mm)</span>
              <input type="number" min={10} value={draft.bedY} onChange={(event) => setSize('bedY', event.target.value)} />
            </label>
            <label className="field">
              <span>Height Z (mm)</span>
              <input type="number" min={10} value={draft.bedZ} onChange={(event) => setSize('bedZ', event.target.value)} />
            </label>
          </div>
          <p className="hint">The preview draws this build volume and warns when a model does not fit. The AI designs for it too.</p>
        </section>
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
          <h3>Command-line AI agents</h3>
          <label className="field">
            <span>Claude Code program</span>
            <input value={draft.claudePath} onChange={(event) => set('claudePath', event.target.value)} />
          </label>
          <label className="field">
            <span>Codex program</span>
            <input value={draft.codexPath} onChange={(event) => set('codexPath', event.target.value)} />
          </label>
          <label className="field">
            <span>Grok program</span>
            <input value={draft.grokPath} onChange={(event) => set('grokPath', event.target.value)} />
          </label>
          <label className="field">
            <span>Antigravity (agy) program</span>
            <input value={draft.agyPath} onChange={(event) => set('agyPath', event.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={draft.claudeAllowBash} onChange={(event) => set('claudeAllowBash', event.target.checked)} />
            Let the agents run commands without asking (so they can render and check their own work)
          </label>
          <p className="hint">Each agent uses its own sign-in. Codex always works inside the project folder only.</p>
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
              onSave({ ...draft, bedX: validSize(draft.bedX, settings.bedX), bedY: validSize(draft.bedY, settings.bedY), bedZ: validSize(draft.bedZ, settings.bedZ) })
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
