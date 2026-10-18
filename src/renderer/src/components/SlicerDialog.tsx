import { useEffect, useMemo, useRef, useState } from 'react'
import type { SlicerApp, SlicerFilament, SlicerObject, SlicerPreferences, SlicerPresetList } from '@shared/types'
import { SLICER_APP_LABEL } from '@shared/types'
import { parseScadColor } from '../lib/viewer'

const toHex = (color: string): string => `#${parseScadColor(color).getHexString()}`

interface Props {
  app: SlicerApp
  projectName: string
  parts: string[]
  currentPart: string
  modelColors: string[]
  saved: SlicerPreferences | null
  onSavePreferences(preferences: SlicerPreferences): void
  onExport(payload: {
    printer: string
    process: string
    filaments: SlicerFilament[]
    objects: SlicerObject[]
    colorMap: Record<string, number>
    settings: Record<string, string>
  }): Promise<void>
  onClose(): void
}

const STORAGE_KEY = 'slicer-export-preferences'

interface LegacyPreferences {
  printer: string
  process: string
  filaments: SlicerFilament[]
  infill: string
  brim: boolean
}

function legacyPreferences(app: SlicerApp): SlicerPreferences | null {
  const legacy = loadPreferences(app)
  return legacy ? { ...legacy, colorMap: {} } : null
}

function initialFilaments(saved: SlicerPreferences | null, modelColors: string[]): { filaments: SlicerFilament[]; colorMap: Record<string, number> } {
  const savedFilaments = saved?.filaments?.length ? saved.filaments : null
  if (!modelColors.length) return { filaments: savedFilaments ?? [{ preset: '', colour: '#161616' }], colorMap: { ...(saved?.colorMap ?? {}) } }
  if (!savedFilaments) {
    return {
      filaments: modelColors.map((color) => ({ preset: '', colour: toHex(color) })),
      colorMap: Object.fromEntries(modelColors.map((color, index) => [color, index + 1]))
    }
  }
  const filaments = [...savedFilaments]
  const colorMap: Record<string, number> = { ...(saved?.colorMap ?? {}) }
  for (const color of modelColors) {
    const slot = colorMap[color]
    if (slot && slot <= filaments.length) continue
    const hex = toHex(color).toLowerCase()
    const sameColour = filaments.findIndex((filament) => filament.colour.toLowerCase() === hex)
    if (sameColour !== -1) {
      colorMap[color] = sameColour + 1
    } else if (filaments.length < 16) {
      filaments.push({ preset: filaments[0]?.preset ?? '', colour: hex })
      colorMap[color] = filaments.length
    } else {
      colorMap[color] = 1
    }
  }
  return { filaments, colorMap }
}

function loadPreferences(app: SlicerApp): LegacyPreferences | null {
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

export function SlicerDialog({ app, projectName, parts, currentPart, modelColors, saved: savedPreferences, onSavePreferences, onExport, onClose }: Props) {
  const [presets, setPresets] = useState<SlicerPresetList | null>(null)
  const [saved] = useState(() => savedPreferences ?? legacyPreferences(app))
  const [initial] = useState(() => initialFilaments(saved, modelColors))
  const [printer, setPrinter] = useState(saved?.printer ?? '')
  const [process, setProcess] = useState(saved?.process ?? '')
  const [filaments, setFilaments] = useState<SlicerFilament[]>(initial.filaments)
  const [colorMap, setColorMap] = useState<Record<string, number>>(initial.colorMap)
  const saveCallback = useRef(onSavePreferences)
  saveCallback.current = onSavePreferences
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

  const removeFilament = (index: number): void => {
    setFilaments(filaments.filter((_, i) => i !== index))
    const slot = index + 1
    setColorMap(Object.fromEntries(Object.entries(colorMap).map(([color, value]) => [color, value === slot ? 1 : value > slot ? value - 1 : value])))
    setObjects(objects.map((object) => ({ ...object, filament: object.filament === slot ? 1 : object.filament > slot ? object.filament - 1 : object.filament })))
  }

  useEffect(() => {
    if (!presets || !printer) return
    const timer = setTimeout(() => saveCallback.current({ printer, process, filaments, colorMap, infill, brim }), 300)
    return () => clearTimeout(timer)
  }, [presets, printer, process, filaments, colorMap, infill, brim])

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    onSavePreferences({ printer, process, filaments, colorMap, infill, brim })
    const settings: Record<string, string> = { enable_prime_tower: '0', sparse_infill_density: infill }
    if (brim) {
      settings.brim_type = 'outer_only'
      settings.brim_width = '3'
    }
    try {
      const safeMap = Object.fromEntries(Object.entries(colorMap).map(([color, slot]) => [color, Math.min(filaments.length, Math.max(1, slot))]))
      await onExport({ printer, process, filaments, objects, colorMap: safeMap, settings })
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
            {modelColors.length > 0 && (
              <>
                <h3>Colours in the model</h3>
                <p className="hint">Pick which printer filament prints each colour. Several colours can share one filament.</p>
                {modelColors.map((color) => (
                  <div key={color} className="row filament-row">
                    <span className="color-chip" style={{ background: toHex(color) }} />
                    <span className="color-name">{color}</span>
                    <span className="muted">→</span>
                    <select value={colorMap[color] ?? 1} onChange={(event) => setColorMap({ ...colorMap, [color]: Number(event.target.value) })}>
                      {filaments.map((filament, index) => (
                        <option key={index} value={index + 1}>
                          Filament {index + 1} · {filament.preset || 'choose preset'} ({filament.colour})
                        </option>
                      ))}
                    </select>
                    <span className="color-chip" style={{ background: filaments[(colorMap[color] ?? 1) - 1]?.colour ?? '#888' }} />
                  </div>
                ))}
                <button
                  onClick={() => {
                    setFilaments(modelColors.map((color, index) => ({ preset: filaments[index]?.preset ?? filaments[0]?.preset ?? '', colour: toHex(color) })))
                    setColorMap(Object.fromEntries(modelColors.map((color, index) => [color, index + 1])))
                  }}
                >
                  One filament per colour
                </button>
              </>
            )}
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
                {filaments.length > 1 && <button onClick={() => removeFilament(index)}>✕</button>}
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
