import type { Axis, MeshStats, Operation, OperationKind } from '@shared/types'

interface Props {
  ops: Operation[]
  stats: MeshStats | null
  bed: [number, number]
  selectedId: string | null
  onSelect(id: string | null): void
  onChange(ops: Operation[]): void
  onBake(): void
}

const newId = (): string => Math.random().toString(36).slice(2, 10)

function createOperation(kind: OperationKind, stats: MeshStats | null): Operation {
  const min = stats?.min ?? [0, 0, 0]
  const max = stats?.max ?? [10, 10, 10]
  const mid = (axis: number): number => Math.round(((min[axis] + max[axis]) / 2) * 100) / 100
  switch (kind) {
    case 'translate':
      return { id: newId(), kind, enabled: true, x: 0, y: 0, z: 0 }
    case 'rotate':
      return { id: newId(), kind, enabled: true, x: 0, y: 0, z: 0, center: [mid(0), mid(1), mid(2)] }
    case 'scale':
      return { id: newId(), kind, enabled: true, x: 1, y: 1, z: 1, center: [mid(0), mid(1), min[2]] }
    case 'mirror':
      return { id: newId(), kind, enabled: true, axis: 'x', center: [mid(0), mid(1), mid(2)] }
    case 'cut':
      return { id: newId(), kind, enabled: true, axis: 'z', position: mid(2), keep: 'below' }
    case 'removeBox':
    case 'addBox':
      return {
        id: newId(),
        kind,
        enabled: true,
        min: [mid(0) - 2, mid(1) - 2, min[2]],
        max: [mid(0) + 2, mid(1) + 2, max[2]]
      }
  }
}

const LABELS: Record<OperationKind, string> = {
  translate: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
  mirror: 'Mirror',
  cut: 'Cut with plane',
  removeBox: 'Remove box',
  addBox: 'Add box'
}

function NumberField({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange(value: number): void }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 0.1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
      />
    </label>
  )
}

function OperationEditor({ operation, update }: { operation: Operation; update(next: Operation): void }) {
  switch (operation.kind) {
    case 'translate':
    case 'rotate':
    case 'scale':
      return (
        <div className="op-fields">
          {(['x', 'y', 'z'] as Axis[]).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              value={operation[axis]}
              step={operation.kind === 'rotate' ? 5 : operation.kind === 'scale' ? 0.05 : 0.5}
              onChange={(value) => update({ ...operation, [axis]: value })}
            />
          ))}
        </div>
      )
    case 'mirror':
      return (
        <div className="op-fields">
          <AxisPicker value={operation.axis} onChange={(axis) => update({ ...operation, axis })} />
        </div>
      )
    case 'cut':
      return (
        <div className="op-fields">
          <AxisPicker value={operation.axis} onChange={(axis) => update({ ...operation, axis })} />
          <NumberField label="At" value={operation.position} step={0.2} onChange={(position) => update({ ...operation, position })} />
          <select value={operation.keep} onChange={(event) => update({ ...operation, keep: event.target.value as 'below' | 'above' })}>
            <option value="below">keep below</option>
            <option value="above">keep above</option>
          </select>
        </div>
      )
    case 'removeBox':
    case 'addBox':
      return (
        <div className="op-fields box-fields">
          {(['min', 'max'] as const).map((corner) => (
            <div key={corner} className="box-row">
              <span className="box-label">{corner === 'min' ? 'From' : 'To'}</span>
              {[0, 1, 2].map((axis) => (
                <NumberField
                  key={axis}
                  label={'XYZ'[axis]}
                  value={operation[corner][axis]}
                  step={0.2}
                  onChange={(value) => {
                    const next = [...operation[corner]] as [number, number, number]
                    next[axis] = value
                    update({ ...operation, [corner]: next })
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )
  }
}

function AxisPicker({ value, onChange }: { value: Axis; onChange(axis: Axis): void }) {
  return (
    <div className="axis-picker">
      {(['x', 'y', 'z'] as Axis[]).map((axis) => (
        <button key={axis} className={value === axis ? 'active' : ''} onClick={() => onChange(axis)}>
          {axis.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function OpsPanel({ ops, stats, bed, selectedId, onSelect, onChange, onBake }: Props) {
  const add = (kind: OperationKind): void => {
    const operation = createOperation(kind, stats)
    onChange([...ops, operation])
    onSelect(operation.id)
  }
  const update = (next: Operation): void => onChange(ops.map((op) => (op.id === next.id ? next : op)))
  const remove = (id: string): void => onChange(ops.filter((op) => op.id !== id))
  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= ops.length) return
    const next = [...ops]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const placeOnBed = (): void => {
    if (!stats) return
    onChange([...ops, { id: newId(), kind: 'translate', enabled: true, x: 0, y: 0, z: -stats.min[2] }])
  }
  const centerOnBed = (bedX: number, bedY: number): void => {
    if (!stats) return
    const cx = (stats.min[0] + stats.max[0]) / 2
    const cy = (stats.min[1] + stats.max[1]) / 2
    onChange([...ops, { id: newId(), kind: 'translate', enabled: true, x: round(bedX / 2 - cx), y: round(bedY / 2 - cy), z: round(-stats.min[2]) }])
  }

  return (
    <div className="ops-panel">
      <p className="hint">
        Operations are applied on top of the code, in order, without changing it. Click one to edit it with handles in the 3D view. Bake them when you are happy to write them into the code.
      </p>
      <div className="ops-add">
        {(Object.keys(LABELS) as OperationKind[]).map((kind) => (
          <button key={kind} onClick={() => add(kind)}>
            + {LABELS[kind]}
          </button>
        ))}
        <button onClick={placeOnBed} disabled={!stats}>
          Place on bed
        </button>
        <button onClick={() => centerOnBed(bed[0], bed[1])} disabled={!stats}>
          Center on bed
        </button>
      </div>
      {ops.length === 0 && <p className="empty">No operations yet.</p>}
      {ops.map((op, index) => (
        <div
          key={op.id}
          className={`op-card ${op.enabled ? '' : 'disabled'} ${selectedId === op.id ? 'selected' : ''}`}
          onClick={() => onSelect(op.id)}
        >
          <div className="op-header">
            <label>
              <input type="checkbox" checked={op.enabled} onChange={(event) => update({ ...op, enabled: event.target.checked })} />
              {index + 1}. {LABELS[op.kind]}
            </label>
            <div className="op-actions">
              <button title="Move up" onClick={() => move(index, -1)}>
                ↑
              </button>
              <button title="Move down" onClick={() => move(index, 1)}>
                ↓
              </button>
              <button title="Delete" onClick={() => remove(op.id)}>
                ✕
              </button>
            </div>
          </div>
          <OperationEditor operation={op} update={update} />
        </div>
      ))}
      {ops.length > 0 && (
        <button className="primary bake" onClick={onBake}>
          Bake operations into code
        </button>
      )}
    </div>
  )
}

const round = (value: number): number => Math.round(value * 100) / 100
