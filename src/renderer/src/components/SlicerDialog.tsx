import { useEffect, useMemo, useState } from 'react'
import type { SlicerApp, SlicerFilament, SlicerObject, SlicerPresetList } from '@shared/types'
import { SLICER_APP_LABEL } from '@shared/types'

interface Props {
  app: SlicerApp
  projectName: string
  parts: string[]
  currentPart: string
  onExport(payload: {
    printer: string
    process: string
    filaments: SlicerFilament[]
    objects: SlicerObject[]
    settings: Record<string, string>
  }): Promise<void>
  onClose(): void
}

const STORAGE_KEY = 'slicer-export-preferences'

interface Preferences {
  printer: string
  process: string
  filaments: SlicerFilament[]
  infill: string
  brim: boolean
}

function loadPreferences(app: SlicerApp): Preferences | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!raw) return null
    if (raw.byApp?.[app]) return raw.byApp[app]
    if (app === 'snapmaker' && typeof raw.printer === 'string') return raw
    return null
  } catch {
    return null
  }
}

function savePreferences(app: SlicerApp, preferences: Preferences): void {
  let raw: { byApp?: Partial<Record<SlicerApp, Preferences>> } = {}
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {}
  } catch {
    raw = {}
  }
  const byApp = raw.byApp ?? {}
  byApp[app] = preferences
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ byApp }))
}

function preferredPrinter(app: SlicerApp, printers: string[]): string {
  const pattern: Record<SlicerApp, RegExp> = {
    bambu: /H2D|X1 Carbon|X1C|P1S|A1 mini|\bA1\b|Bambu/i,
    snapmaker: /U1|Artisan|Snapmaker/i,
    orca: /./
  }
  return printers.find((name) => pattern[app].test(name)) ?? printers[0] ?? ''
}

function printerModel(printer: string): string | null {
  return printer.match(/\b(A1 mini|A1|P1S|P1P|X1 Carbon|X1C|X1E|X1|H2D|H2S|H2C|U1|J1s|J1|Artisan)\b/i)?.[1] ?? null
}

function matchingProcesses(printer: string, processes: string[]): string[] {
  const nozzle = printer.match(/(\d+\.\d+)\s*nozzle/i)?.[1]
  const model = printerModel(printer)
  const matched = processes.filter((name) => {
    const nozzleOk = !nozzle || name.includes(nozzle)
    const modelOk = !model || name.toLowerCase().includes(model.toLowerCase())
    return nozzleOk && modelOk
  })
  return matched.length ? matched : processes
}

function matchingFilaments(printer: string, filaments: string[]): string[] {
  const model = printerModel(printer)
  const brand = printer.split(' ')[0]
  if (model) {
    const exact = filaments.filter((name) => name.includes(`@${model}`) || name.includes(`@${brand} ${model}`))
    if (exact.length) return exact
  }
  const branded = filaments.filter((name) => name.includes(`@${brand}`))
  return branded.length ? branded : filaments
}

function PresetSelect({ value, options, onChange }: { value: string; options: string[]; onChange(value: string): void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {!options.includes(value) && <option value={value}>{value || 'Choose...'}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

export function SlicerDialog({ app, projectName, parts, currentPart, onExport, onClose }: Props) {
  const [presets, setPresets] = useState<SlicerPresetList | null>(null)
  const saved = loadPreferences(app)
  const [printer, setPrinter] = useState(saved?.printer ?? '')
  const [process, setProcess] = useState(saved?.process ?? '')
  const [filaments, setFilaments] = useState<SlicerFilament[]>(saved?.filaments ?? [{ preset: '', colour: '#161616' }])
  const [infill, setInfill] = useState(saved?.infill ?? '15%')
  const [brim, setBrim] = useState(saved?.brim ?? false)
  const selectable = parts.length ? parts : ['']
  const [objects, setObjects] = useState<SlicerObject[]>(
    (currentPart ? [currentPart] : selectable.slice(0, 1)).map((part) => ({ name: part || projectName, part, filament: 1, copies: 1 }))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.studio.slicer.presets(app).then((list) => {
      setPresets(list)
      setPrinter((current) => (current && list.printers.includes(current) ? current : preferredPrinter(app, list.printers)))
    })
  }, [app])

  const processes = useMemo(() => (presets ? matchingProcesses(printer, presets.processes) : []), [presets, printer])

  const filamentOptions = useMemo(() => (presets ? matchingFilaments(printer, presets.filaments) : []), [presets, printer])

  useEffect(() => {
    if (processes.length && !processes.includes(process)) setProcess(processes.find((name) => name.includes('0.20mm Standard')) ?? processes[0])
  }, [processes])

  useEffect(() => {
    if (!filamentOptions.length) return
    setFilaments((current) =>
      current.map((filament) =>
        filamentOptions.includes(filament.preset) ? filament : { ...filament, preset: filamentOptions.find((name) => /PLA/.test(name)) ?? filamentOptions[0] }
      )
    )
  }, [filamentOptions])

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    savePreferences(app, { printer, process, filaments, infill, brim })
    const settings: Record<string, string> = { enable_prime_tower: '0', sparse_infill_density: infill }
    if (brim) {
      settings.brim_type = 'outer_only'
      settings.brim_width = '3'
    }
    try {
      await onExport({ printer, process, filaments, objects, settings })
      onClose()
    } catch (exportError) {
      setError((exportError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (presets && !presets.found) {
    return (
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
          <h2>{SLICER_APP_LABEL[app]} project</h2>
          <p>
            No presets for {SLICER_APP_LABEL[app]} were found. Install it and open it once so its printer profiles are on this computer.
            {presets.installed.length ? ` Already installed: ${presets.installed.map((item) => SLICER_APP_LABEL[item]).join(', ')}.` : ''} STL and 3MF still open in any slicer.
          </p>
          <div className="modal-actions">
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{SLICER_APP_LABEL[app]} project</h2>
        {!presets && <p>Loading presets...</p>}
        {presets && (
          <>
            {presets.source && presets.source !== app && (
              <p className="hint">
                {SLICER_APP_LABEL[app]} is not installed. These presets come from {SLICER_APP_LABEL[presets.source]}. Pick the {SLICER_APP_LABEL[app]} printer if it is in the list, or export STL / 3MF for any slicer.
              </p>
            )}
            <label className="field">
              <span>Printer</span>
              <PresetSelect value={printer} options={presets.printers} onChange={setPrinter} />
            </label>
            <label className="field">
              <span>Print settings</span>
              <PresetSelect value={process} options={processes} onChange={setProcess} />
            </label>
            <h3>Filaments</h3>
            {filaments.map((filament, index) => (
              <div key={index} className="row filament-row">
                <span className="filament-index">{index + 1}</span>
                <input
                  type="color"
                  value={filament.colour}
                  onChange={(event) => setFilaments(filaments.map((item, i) => (i === index ? { ...item, colour: event.target.value } : item)))}
                />
                <PresetSelect
                  value={filament.preset}
                  options={filamentOptions}
                  onChange={(preset) => setFilaments(filaments.map((item, i) => (i === index ? { ...item, preset } : item)))}
                />
                {filaments.length > 1 && <button onClick={() => setFilaments(filaments.filter((_, i) => i !== index))}>✕</button>}
              </div>
            ))}
            {filaments.length < 16 && (
              <button onClick={() => setFilaments([...filaments, { preset: filaments[0].preset, colour: '#F39200' }])}>+ Filament</button>
            )}
            <h3>Objects on the plate</h3>
            {objects.map((object, index) => (
              <div key={index} className="row object-row">
                <input
                  value={object.name}
                  onChange={(event) => setObjects(objects.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))}
                />
                {parts.length > 0 && (
                  <select
                    value={object.part}
                    onChange={(event) => setObjects(objects.map((item, i) => (i === index ? { ...item, part: event.target.value } : item)))}
                  >
                    {parts.map((part) => (
                      <option key={part} value={part}>
                        part: {part}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={object.filament}
                  onChange={(event) => setObjects(objects.map((item, i) => (i === index ? { ...item, filament: Number(event.target.value) } : item)))}
                >
                  {filaments.map((_, filamentIndex) => (
                    <option key={filamentIndex} value={filamentIndex + 1}>
                      filament {filamentIndex + 1}
                    </option>
                  ))}
                </select>
                <label className="number-field">
                  <span>×</span>
                  <input
                    type="number"
                    min={1}
                    value={object.copies}
                    onChange={(event) => setObjects(objects.map((item, i) => (i === index ? { ...item, copies: Math.max(1, Number(event.target.value)) } : item)))}
                  />
                </label>
                {objects.length > 1 && <button onClick={() => setObjects(objects.filter((_, i) => i !== index))}>✕</button>}
              </div>
            ))}
            <button
              onClick={() => {
                const part = selectable.find((candidate) => !objects.some((object) => object.part === candidate)) ?? selectable[0]
                setObjects([...objects, { name: part || projectName, part, filament: 1, copies: 1 }])
              }}
            >
              + Object
            </button>
            <h3>Options</h3>
            <div className="row">
              <label className="field">
                <span>Infill</span>
                <input value={infill} onChange={(event) => setInfill(event.target.value)} />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={brim} onChange={(event) => setBrim(event.target.checked)} />
                Brim (helps small parts stick)
              </label>
            </div>
          </>
        )}
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !presets || !printer || !process} onClick={submit}>
            {busy ? 'Exporting...' : 'Export .3mf'}
          </button>
        </div>
      </div>
    </div>
  )
}
