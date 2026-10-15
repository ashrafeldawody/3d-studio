import { useRef } from 'react'
import { findParameters, setParameter } from '@shared/scad'
import type { ModelParameter } from '@shared/types'

interface Props {
  code: string
  onChange(code: string): void
}

const humanize = (name: string): string => name.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())

function decimals(value: number): number {
  const text = String(value)
  return text.includes('.') ? text.split('.')[1].length : 0
}

function rangeFor(value: number): { min: number; max: number; step: number } {
  const places = decimals(value)
  const step = places === 0 ? (Math.abs(value) >= 20 ? 1 : 0.5) : 10 ** -Math.min(places, 2)
  if (value === 0) return { min: -10, max: 10, step: 0.1 }
  const span = Math.max(Math.abs(value) * 2, 1)
  return value > 0 ? { min: 0, max: round(value + span, step), step } : { min: round(value - span, step), max: round(-value + span, step), step }
}

const round = (value: number, step: number): number => Math.round(value / step) * step

type Range = { min: number; max: number; step: number }

function ParameterRow({ parameter, range, apply }: { parameter: ModelParameter; range: Range; apply(value: number | boolean | string): void }) {
  if (parameter.kind === 'boolean') {
    return (
      <label className="param-row checkbox">
        <input type="checkbox" checked={parameter.value as boolean} onChange={(event) => apply(event.target.checked)} />
        <span title={parameter.name}>{humanize(parameter.name)}</span>
      </label>
    )
  }
  if (parameter.kind === 'string') {
    return (
      <label className="param-row">
        <span title={parameter.name}>{humanize(parameter.name)}</span>
        <input value={parameter.value as string} onChange={(event) => apply(event.target.value)} />
      </label>
    )
  }
  const value = parameter.value as number
  return (
    <label className="param-row">
      <span title={`${parameter.name} (line ${parameter.line})`}>{humanize(parameter.name)}</span>
      <input type="range" min={range.min} max={range.max} step={range.step} value={value} onChange={(event) => apply(Number(event.target.value))} />
      <input
        type="number"
        className="param-number"
        step={range.step}
        value={value}
        onChange={(event) => {
          if (event.target.value === '' || Number.isNaN(Number(event.target.value))) return
          apply(Number(event.target.value))
        }}
      />
    </label>
  )
}

export function ParamsPanel({ code, onChange }: Props) {
  const ranges = useRef(new Map<string, Range>())
  const rangeOf = (parameter: ModelParameter): Range => {
    const value = typeof parameter.value === 'number' ? parameter.value : 0
    const known = ranges.current.get(parameter.name)
    if (known && value >= known.min && value <= known.max) return known
    const fresh = rangeFor(value)
    ranges.current.set(parameter.name, fresh)
    return fresh
  }
  const parameters = findParameters(code).filter((parameter) => parameter.name !== 'part')
  if (!parameters.length) {
    return (
      <p className="empty">
        No adjustable values found. Values written at the top level of the code, like <code>width = 40;</code>, show up here as sliders.
      </p>
    )
  }
  return (
    <div className="params-panel">
      <p className="hint">Change a value and the preview updates. Values are written straight into the code.</p>
      {parameters.map((parameter) => (
        <ParameterRow key={parameter.name} parameter={parameter} range={rangeOf(parameter)} apply={(value) => onChange(setParameter(code, parameter, value))} />
      ))}
    </div>
  )
}
