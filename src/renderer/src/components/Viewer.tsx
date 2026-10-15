import { useEffect, useRef, useState } from 'react'
import type { ChatPin, MeshStats, Operation, ViewName } from '@shared/types'
import { BoxGizmoMode, ModelViewer, PinHit, SnapKind, ViewerMode } from '../lib/viewer'
import { AiActivityState, AiViewerOverlay } from './AiActivity'
import { DrawingLayer, DrawingLayerHandle } from './DrawingLayer'
import { QuickActions } from './QuickActions'

interface Props {
  stl: Uint8Array | null
  ops: Operation[]
  selectedOpId: string | null
  pins: ChatPin[]
  stats: MeshStats | null
  rendering: boolean
  bed: [number, number]
  onViewer(viewer: ModelViewer | null): void
  onEditOperation(operation: Operation): void
  simple: boolean
  busy: boolean
  activity: AiActivityState
  onPin(hit: PinHit): number
  onRemovePin(id: number): void
  onQuickAction(prompt: string): void
  onDescribePin(id: number): void
  onSnapshot(dataUrl: string, annotated: boolean): void
  onDeselect(): void
}

const VIEW_BUTTONS: { view: ViewName; label: string }[] = [
  { view: 'iso', label: '3D' },
  { view: 'top', label: 'Top' },
  { view: 'front', label: 'Front' },
  { view: 'right', label: 'Right' },
  { view: 'back', label: 'Back' },
  { view: 'left', label: 'Left' },
  { view: 'bottom', label: 'Bottom' }
]

const MODE_BUTTONS: { mode: ViewerMode; label: string; title: string }[] = [
  { mode: 'orbit', label: 'Orbit', title: 'Rotate, pan and zoom the view; drag gizmo arrows to edit' },
  { mode: 'measure', label: 'Measure', title: 'Click two points on the model' },
  { mode: 'pin', label: 'Pin', title: 'Click the model to drop numbered pins for the AI' },
  { mode: 'draw', label: 'Draw', title: 'Draw on the view to show the AI what you mean' }
]

const SNAP_LABELS: Record<SnapKind, string> = {
  corner: 'Corner',
  midpoint: 'Edge midpoint',
  edge: 'Edge',
  face: 'Face',
  bed: 'Bed'
}

const MEASURE_HINT = 'Click two points. Snaps to corners, edge midpoints and edges; two parallel faces also give the gap between them.'

const EDIT_HINTS: Partial<Record<Operation['kind'], string>> = {
  translate: 'Drag the arrows to move the model',
  rotate: 'Drag the rings to rotate the model',
  scale: 'Drag the handles to scale the model',
  cut: 'Drag the arrow to move the cut plane',
  addBox: 'Drag to place the box; switch to Resize to change its size',
  removeBox: 'Drag to place the box; switch to Resize to change its size'
}

export function Viewer(props: Props) {
  const { stl, ops, selectedOpId, pins, stats, rendering, bed } = props
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<ModelViewer | null>(null)
  const drawing = useRef<DrawingLayerHandle>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const [mode, setMode] = useState<ViewerMode>('orbit')
  const [boxMode, setBoxMode] = useState<BoxGizmoMode>('translate')
  const [measure, setMeasure] = useState<string | null>(null)
  const [wireframe, setWireframe] = useState(false)
  const [quick, setQuick] = useState<{ pin: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const instance = new ModelViewer(host.current!)
    viewer.current = instance
    instance.onMeasure = (result) => {
      if (result.distance !== null && result.delta) {
        const { x, y, z } = result.delta
        const gap = result.faceGap !== null ? ` · faces ${result.faceGap.toFixed(2)} mm apart` : ''
        setMeasure(`#${result.count}: ${result.distance.toFixed(2)} mm  (X ${x.toFixed(2)} · Y ${y.toFixed(2)} · Z ${z.toFixed(2)})${gap}`)
      } else {
        const { point, snap } = result.points[0]
        setMeasure(`${SNAP_LABELS[snap]} at ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)} · click a second point`)
      }
    }
    instance.onPin = (hit) => {
      const pin = callbacks.current.onPin(hit)
      if (callbacks.current.simple) {
        const rect = host.current!.getBoundingClientRect()
        setQuick({ pin, x: Math.min(hit.screenX + 12, rect.width - 330), y: Math.min(hit.screenY + 12, rect.height - 260) })
      }
    }
    instance.onEditCommit = (operation) => callbacks.current.onEditOperation(operation)
    callbacks.current.onViewer(instance)
    return () => {
      callbacks.current.onViewer(null)
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    viewer.current?.setBedSize(bed[0], bed[1])
  }, [bed[0], bed[1]])

  useEffect(() => {
    if (stl) viewer.current?.showStl(stl, true)
    else viewer.current?.clearModel()
  }, [stl])

  useEffect(() => {
    viewer.current?.setOperations(ops, selectedOpId)
  }, [ops, selectedOpId, stl])

  useEffect(() => {
    viewer.current?.setPins(pins)
  }, [pins, stl])

  useEffect(() => {
    viewer.current?.setBoxGizmoMode(boxMode)
  }, [boxMode])

  useEffect(() => {
    if (viewer.current) viewer.current.clickToPin = props.simple
    if (props.simple && mode === 'pin') changeMode('orbit')
  }, [props.simple])

  useEffect(() => {
    if (mode !== 'draw') return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target && target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
      if (!drawing.current?.hasStrokes()) return
      event.preventDefault()
      event.stopPropagation()
      drawing.current.undo()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode])

  const changeMode = (next: ViewerMode): void => {
    setMode(next)
    viewer.current?.setMode(next)
    setMeasure(next === 'measure' ? MEASURE_HINT : null)
  }

  const clearMeasurements = (): void => {
    viewer.current?.clearMeasurements()
    setMeasure(MEASURE_HINT)
  }

  const toggleWireframe = (): void => {
    setWireframe(!wireframe)
    viewer.current?.setWireframe(!wireframe)
  }

  const sendSnapshot = (): void => {
    const instance = viewer.current
    if (!instance) return
    const base = instance.snapshot()
    const annotated = drawing.current?.hasStrokes() ?? false
    if (!annotated) {
      props.onSnapshot(base, pins.length > 0)
      return
    }
    drawing.current!.composite(base).then((dataUrl) => {
      props.onSnapshot(dataUrl, true)
      drawing.current?.clear()
    })
  }

  const selected = ops.find((op) => op.id === selectedOpId && op.enabled)
  const isBox = selected?.kind === 'addBox' || selected?.kind === 'removeBox'

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={host} />
      <DrawingLayer ref={drawing} active={mode === 'draw'} />
      <div className="viewer-toolbar">
        {VIEW_BUTTONS.map((button) => (
          <button key={button.view} onClick={() => viewer.current?.setView(button.view)}>
            {button.label}
          </button>
        ))}
        <span className="divider" />
        <button className={wireframe ? 'active' : ''} onClick={toggleWireframe}>
          Wireframe
        </button>
      </div>
      <div className="viewer-modes">
        {MODE_BUTTONS.filter((button) => !props.simple || button.mode !== 'pin').map((button) => (
          <button key={button.mode} title={button.title} className={mode === button.mode ? 'active' : ''} onClick={() => changeMode(button.mode)}>
            {button.label}
          </button>
        ))}
        {mode === 'measure' && (
          <>
            <span className="divider" />
            <button onClick={clearMeasurements}>Clear</button>
          </>
        )}
        {mode === 'draw' && (
          <>
            <span className="divider" />
            <button onClick={() => drawing.current?.undo()}>Undo</button>
            <button onClick={() => drawing.current?.clear()}>Clear</button>
          </>
        )}
        <span className="divider" />
        <button className="primary" title="Attach the current view (with your drawing and pins) to the chat" onClick={sendSnapshot}>
          📷 To chat
        </button>
      </div>
      {selected && EDIT_HINTS[selected.kind] && (
        <div className="viewer-edit">
          <span>{EDIT_HINTS[selected.kind]}</span>
          {isBox && (
            <>
              <button className={boxMode === 'translate' ? 'active' : ''} onClick={() => setBoxMode('translate')}>
                Move
              </button>
              <button className={boxMode === 'scale' ? 'active' : ''} onClick={() => setBoxMode('scale')}>
                Resize
              </button>
            </>
          )}
          <button onClick={props.onDeselect}>Done</button>
        </div>
      )}
      {quick && !props.busy && (
        <QuickActions
          pin={quick.pin}
          x={quick.x}
          y={quick.y}
          onAction={(prompt) => {
            setQuick(null)
            props.onQuickAction(prompt)
          }}
          onDescribe={() => {
            props.onDescribePin(quick.pin)
            setQuick(null)
          }}
          onCancel={() => {
            props.onRemovePin(quick.pin)
            setQuick(null)
          }}
        />
      )}
      {props.simple && !stl && !rendering && !props.busy && (
        <div className="viewer-empty">
          <div>Nothing here yet.</div>
          <div className="muted">Describe what you want in the chat on the right.</div>
        </div>
      )}
      {props.simple && stl && mode === 'orbit' && !quick && !selected && !props.busy && (
        <div className="viewer-tip">Click anywhere on the part to change that spot · drag to turn · scroll to zoom</div>
      )}
      {props.busy && <AiViewerOverlay activity={props.activity} hasModel={Boolean(stl)} />}
      {rendering && !props.busy && (
        <div className="viewer-badge">
          <span className="render-dot" />
          Rendering
        </div>
      )}
      {measure && <div className="viewer-measure">{measure}</div>}
      {mode === 'pin' && <div className="viewer-measure">Click the model to drop a pin. Add notes to pins in the chat box.</div>}
      {mode === 'draw' && <div className="viewer-measure">Draw on the view, then press "📷 To chat"</div>}
      {stats && (
        <div className="viewer-stats">
          <div>
            {stats.size[0]} x {stats.size[1]} x {stats.size[2]} mm
          </div>
          <div>
            {stats.volumeCm3} cm³ · ~{Math.round(stats.volumeCm3 * 1.24 * 10) / 10} g PLA solid
          </div>
          <div className={stats.nonManifoldEdges ? 'warn' : ''}>
            {stats.shells} piece{stats.shells === 1 ? '' : 's'} · {stats.nonManifoldEdges ? `${stats.nonManifoldEdges} open edges` : 'watertight'}
          </div>
          {Math.abs(stats.min[2]) > 0.01 && <div className="warn">Lowest point z = {stats.min[2]} (not on bed)</div>}
        </div>
      )}
    </div>
  )
}
