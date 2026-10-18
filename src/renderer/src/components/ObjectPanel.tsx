import { useEffect, useState } from 'react'
import type { Vector3 } from '@shared/types'
import { SHAPES, ShapeKind } from '../lib/shapes'

interface Bounds {
  min: Vector3
  max: Vector3
}

interface PartLabel {
  index: number
  label: string
}

interface Props {
  parts: PartLabel[]
  selected: number | null
  bounds: Bounds | null
  bed: [number, number, number]
  pending: boolean
  error: string | null
  onSelect(index: number): void
  onMove(delta: Vector3): void
  onRotate(axis: Vector3, degrees: number): void
  onScale(factor: Vector3, anchor: 'min' | 'base'): void
  onDrop(): void
  onCenter(): void
  onFit(): void
  onDuplicate(): void
  onDelete(): void
  onMirror(axis: 'x' | 'y' | 'z'): void
  onAddShape(shape: ShapeKind): void
}

const AXES = ['X', 'Y', 'Z'] as const

function CommitNumber({ label, value, step, onCommit }: { label: string; value: number; step?: number; onCommit(value: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(format(value)), [value])
  const commit = (): void => {
    const next = Number(text)
    if (!Number.isFinite(next) || Math.abs(next - value) < 1e-4) {
      setText(format(value))
      return
    }
    onCommit(next)
    setText(format(value))
  }
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 0.5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

const format = (value: number): string => String(Math.round(value * 1000) / 1000)

export function ObjectPanel(props: Props) {
  const { bounds, selected } = props
  const size = bounds ? (bounds.max.map((value, axis) => value - bounds.min[axis]) as Vector3) : null
  const [turnAxis, setTurnAxis] = useState<0 | 1 | 2>(2)
  const [turnBy, setTurnBy] = useState(90)
  const selectedPart = props.parts.find((part) => part.index === selected)

  return (
    <div className="object-panel">
      <p className="hint">These tools edit the part directly. The chat is optional.</p>
      <div className="ops-add">
        {SHAPES.map((shape) => (
          <button key={shape.shape} onClick={() => props.onAddShape(shape.shape)}>
            {shape.icon} {shape.label}
          </button>
        ))}
      </div>
      {props.error && <p className="error-text">{props.error}</p>}
      <div className="part-list">
        {props.parts.length === 0 && <p className="empty">No parts yet. Add a shape to start.</p>}
        {props.parts.map((part) => (
          <button key={part.index} className={part.index === selected ? 'active' : ''} onClick={() => props.onSelect(part.index)}>
            {part.index + 1}. {part.label}
          </button>
        ))}
      </div>
      {selectedPart && (
        <div className="object-card">
          <div className="pane-title">{selectedPart.label}</div>
          {props.pending && !bounds && <p className="hint">Rendering this part…</p>}
          {bounds && size && (
            <>
              <h3>Position on the plate</h3>
              <div className="op-fields">
                {AXES.map((label, axis) => (
                  <CommitNumber
                    key={label}
                    label={label}
                    value={bounds.min[axis]}
                    onCommit={(next) => {
                      const delta: Vector3 = [0, 0, 0]
                      delta[axis] = next - bounds.min[axis]
                      props.onMove(delta)
                    }}
                  />
                ))}
              </div>
              <h3>Size (mm)</h3>
              <div className="op-fields">
                {AXES.map((label, axis) => (
                  <CommitNumber
                    key={label}
                    label={label}
                    value={size[axis]}
                    step={1}
                    onCommit={(next) => {
                      if (size[axis] < 0.05 || next <= 0) return
                      const factor: Vector3 = [1, 1, 1]
                      factor[axis] = next / size[axis]
                      props.onScale(factor, 'min')
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <h3>Turn</h3>
          <div className="op-fields">
            <div className="axis-picker">
              {AXES.map((label, axis) => (
                <button key={label} className={turnAxis === axis ? 'active' : ''} onClick={() => setTurnAxis(axis as 0 | 1 | 2)}>
                  {label}
                </button>
              ))}
            </div>
            <CommitNumber label="°" value={turnBy} step={5} onCommit={setTurnBy} />
            <button
              onClick={() => {
                const axis: Vector3 = [0, 0, 0]
                axis[turnAxis] = 1
                props.onRotate(axis, turnBy)
              }}
            >
              Apply
            </button>
          </div>
          <div className="ops-add">
            <button onClick={() => props.onRotate([0, 0, 1], 90)}>Turn left 90°</button>
            <button onClick={() => props.onRotate([0, 0, 1], -90)}>Turn right 90°</button>
            <button onClick={() => props.onRotate([1, 0, 0], 90)}>Tip over</button>
            <button onClick={() => props.onMirror('x')}>Mirror left-right</button>
            <button onClick={() => props.onMirror('y')}>Mirror front-back</button>
            <button onClick={() => props.onDrop()}>Drop to plate</button>
            <button onClick={() => props.onCenter()}>Center on plate</button>
            <button onClick={() => props.onFit()}>Fit on plate</button>
            <button onClick={() => props.onDuplicate()}>Duplicate</button>
            <button onClick={() => props.onDelete()}>Delete</button>
          </div>
          <p className="hint">
            Plate is {props.bed[0]} × {props.bed[1]} × {props.bed[2]} mm. Use Move, Rotate and Scale on the view for the handles. Right-click for colour.
          </p>
        </div>
      )}
    </div>
  )
}
