import { useEffect, useMemo, useState } from 'react'
import type { SlicerFilament, SlicerObject, SlicerPresetList } from '@shared/types'

interface Props {
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

function loadPreferences(): Preferences | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    return null
  }
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

export function SlicerDialog({ projectName, parts, currentPart, onExport, onClose }: Props) {
  const [presets, setPresets] = useState<SlicerPresetList | null>(null)
  const saved = loadPreferences()
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
    window.studio.slicer.presets().then((list) => {
      setPresets(list)
      if (!printer && list.printers.length) setPrinter(list.printers.find((name) => /U1/.test(name)) ?? list.printers[0])
    })
  }, [])

  const processes = useMemo(() => {
    if (!presets) return []
    const key = printer.replace(/^.*?(\S+ \(\d\.\d nozzle\)).*$/, '$1')
    const matching = presets.processes.filter((name) => name.includes(key))
    return matching.length ? matching : presets.processes
  }, [presets, printer])

  const filamentOptions = useMemo(() => {
    if (!presets) return []
    const brand = printer.split(' ')[0]
    const model = printer.match(/\b([A-Z]\d+)\b/)?.[1]
    const matching = presets.filaments.filter((name) => (model ? name.includes(`@${model}`) || name.includes(`@${brand} ${model}`) : true))
    return matching.length ? matching : presets.filaments
  }, [presets, printer])

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ printer, process, filaments, infill, brim }))
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
          <h2>Slicer project</h2>
          <p>No Snapmaker Orca or OrcaSlicer installation was found. Install one of them, or export a plain 3MF instead.</p>
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
        <h2>Export slicer project (Snapmaker Orca / OrcaSlicer)</h2>
        {!presets && <p>Loading presets...</p>}
        {presets && (
          <>
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
