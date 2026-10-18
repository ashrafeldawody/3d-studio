import { useEffect, useRef, useState } from 'react'
import type { ChatPin, ColorPart, MeshStats, Operation, RenderedObject, Vector3, ViewName } from '@shared/types'
import { BoxGizmoMode, ModelViewer, ObjectGizmoMode, PinHit, SnapKind, ViewerContext, ViewerMode } from '../lib/viewer'
import { SHAPES, ShapeKind } from '../lib/shapes'
import { ColorPalette, ContextMenu, FILAMENT_COLORS, MenuEntry } from './ContextMenu'
import { AiActivityState, AiViewerOverlay } from './AiActivity'
import { DrawingLayer, DrawingLayerHandle } from './DrawingLayer'
import { QuickActions } from './QuickActions'

interface Props {
  model: ColorPart[] | null
  ops: Operation[]
  selectedOpId: string | null
  pins: ChatPin[]
  stats: MeshStats | null
  rendering: boolean
  bed: [number, number, number]
  fitProblem: string | null
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
  objects: RenderedObject[] | null
  objectsError: string | null
  onModeChange(mode: ViewerMode): void
  onObjectMove(index: number, delta: Vector3): void
  onObjectRotate(index: number, axis: Vector3, degrees: number, center: Vector3): void
  onObjectScale(index: number, factor: Vector3, center: Vector3): void
  onObjectDelete(index: number): void
  onObjectDuplicate(index: number, offset: Vector3): void
  onPartAction(action: PartAction): void
  focus: { index: number; token: number } | null
  onAddShape(shape: ShapeKind): void
  onSelection(index: number | null): void
}

export type PartAction =
  | { type: 'paint'; index: number; color: string | null }
  | { type: 'recolor'; from: string; to: string }
  | { type: 'rotate'; index: number; axis: 'x' | 'y' | 'z'; degrees: number }
  | { type: 'mirror'; index: number; axis: 'x' | 'y' | 'z' }
  | { type: 'drop'; index: number }
  | { type: 'export'; index: number }
  | { type: 'addShape'; shape: ShapeKind; at: Vector3 }

const colorName = (color: string): string => FILAMENT_COLORS.find((item) => item.hex === color.toLowerCase())?.name ?? color

const Swatch = ({ color }: { color: string }) => <span className="ctx-dot" style={{ background: color.startsWith('[') ? '#888' : color }} />

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
  { mode: 'move', label: 'Move', title: 'Click a part to select it, then drag it around the plate' },
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
  const { model, ops, selectedOpId, pins, stats, rendering, bed } = props
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
  const [selectedObject, setSelectedObject] = useState<number | null>(null)
  const [menu, setMenu] = useState<ViewerContext | null>(null)
  const [gizmoMode, setGizmoMode] = useState<ObjectGizmoMode>('translate')

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
    instance.onPinRemove = (id) => {
      callbacks.current.onRemovePin(id)
      setQuick((current) => (current?.pin === id ? null : current))
    }
    instance.onEditCommit = (operation) => callbacks.current.onEditOperation(operation)
    instance.onObjectSelect = (index) => {
      setSelectedObject(index)
      callbacks.current.onSelection(index)
    }
    instance.onContextMenu = (context) => {
      setQuick(null)
      setMenu(context)
    }
    instance.onObjectMove = (index, delta) => callbacks.current.onObjectMove(index, delta)
    instance.onObjectRotate = (index, axis, degrees, center) => callbacks.current.onObjectRotate(index, axis, degrees, center)
    instance.onObjectScale = (index, factor, center) => callbacks.current.onObjectScale(index, factor, center)
    callbacks.current.onViewer(instance)
    return () => {
      callbacks.current.onViewer(null)
      instance.dispose()
    }
  }, [])

  useEffect(() => {
    viewer.current?.setBedSize(bed[0], bed[1], bed[2])
  }, [bed[0], bed[1], bed[2]])

  useEffect(() => {
    if (model) viewer.current?.showModel(model, true)
    else viewer.current?.clearModel()
  }, [model])

  useEffect(() => {
    viewer.current?.setOperations(ops, selectedOpId)
  }, [ops, selectedOpId, model])

  useEffect(() => {
    viewer.current?.setPins(pins)
  }, [pins, model])

  useEffect(() => {
    viewer.current?.setBoxGizmoMode(boxMode)
  }, [boxMode])

  useEffect(() => {
    if (props.objects) viewer.current?.showObjects(props.objects)
    else viewer.current?.clearObjects()
  }, [props.objects, mode])

  useEffect(() => {
    if (mode !== 'move' || selectedObject === null) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
      const step = event.shiftKey ? 10 : 1
      const nudges: Record<string, Vector3> = {
        ArrowLeft: [-step, 0, 0],
        ArrowRight: [step, 0, 0],
        ArrowUp: [0, step, 0],
        ArrowDown: [0, -step, 0],
        PageUp: [0, 0, step],
        PageDown: [0, 0, -step]
      }
      if (nudges[event.key]) viewer.current?.nudgeSelected(nudges[event.key])
      else if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected()
      else if (event.key === 'Escape') viewer.current?.selectObject(null)
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') duplicateSelected()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selectedObject])

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

  useEffect(() => {
    if (!props.focus) return
    changeMode('move')
    viewer.current?.selectObject(props.focus.index)
  }, [props.focus])

  const changeGizmo = (next: ObjectGizmoMode): void => {
    setGizmoMode(next)
    viewer.current?.setObjectGizmoMode(next)
    if (mode !== 'move') changeMode('move')
  }

  const changeMode = (next: ViewerMode): void => {
    setMode(next)
    viewer.current?.setMode(next)
    props.onModeChange(next)
    if (next !== 'move') setSelectedObject(null)
    setMeasure(next === 'measure' ? MEASURE_HINT : null)
  }

  const clearMeasurements = (): void => {
    viewer.current?.clearMeasurements()
    setMeasure(MEASURE_HINT)
  }

  const dropPin = (context: ViewerContext, askAi: boolean): void => {
    if (!context.point) return
    const pin = props.onPin({ point: context.point, normal: context.normal ?? [0, 0, 1], screenX: context.screenX, screenY: context.screenY })
    if (!askAi) return
    const rect = host.current!.getBoundingClientRect()
    setQuick({ pin, x: Math.min(context.screenX + 12, rect.width - 330), y: Math.min(context.screenY + 12, rect.height - 260) })
  }

  const closeMenu = (): void => setMenu(null)

  const act = (action: PartAction): void => {
    setMenu(null)
    props.onPartAction(action)
  }

  const menuEntries = (context: ViewerContext): MenuEntry[] => {
    const entries: MenuEntry[] = []
    const index = context.objectIndex
    const object = index === null ? null : props.objects?.find((item) => item.index === index)
    const views: MenuEntry[] = VIEW_BUTTONS.map((button) => ({ kind: 'item', label: button.label === '3D' ? '3D view' : button.label, onSelect: () => viewer.current?.setView(button.view) }))
    const modes: MenuEntry[] = [
      { kind: 'item', label: 'Move parts', icon: '✥', disabled: mode === 'move', onSelect: () => changeMode('move') },
      { kind: 'item', label: 'Measure', icon: '📏', disabled: mode === 'measure', onSelect: () => changeMode('measure') },
      { kind: 'item', label: 'Pins for the AI', icon: '📍', disabled: mode === 'pin', onSelect: () => changeMode('pin') },
      { kind: 'item', label: 'Draw for the AI', icon: '✎', onSelect: () => changeMode('draw') },
      { kind: 'item', label: 'Just look around', icon: '⟲', disabled: mode === 'orbit', onSelect: () => changeMode('orbit') }
    ]
    const viewTools: MenuEntry[] = [
      { kind: 'submenu', label: 'View from', icon: '👁', entries: views },
      { kind: 'item', label: 'Zoom to fit', icon: '⤢', onSelect: () => viewer.current?.setView('iso') },
      { kind: 'item', label: wireframe ? 'Solid view' : 'Wireframe view', icon: '▦', onSelect: toggleWireframe },
      { kind: 'submenu', label: 'Tool', icon: '🛠', entries: modes },
      { kind: 'item', label: 'Attach this view to the chat', icon: '📷', onSelect: sendSnapshot }
    ]
    if (!context.point) {
      const at = context.bedPoint ?? [0, 0, 0]
      entries.push({ kind: 'header', label: 'Plate' })
      entries.push({
        kind: 'submenu',
        label: 'Add a shape here',
        icon: '＋',
        entries: SHAPES.map((shape) => ({ kind: 'item', label: shape.label, icon: shape.icon, onSelect: () => act({ type: 'addShape', shape: shape.shape, at }) }))
      })
      entries.push({ kind: 'separator' }, ...viewTools)
      return entries
    }
    entries.push({
      kind: 'header',
      label: (
        <>
          {context.color && <Swatch color={context.color} />}
          {object ? object.label : 'Model'}
          {props.objects && props.objects.length > 1 && object ? <span className="ctx-header-note">part {object.index + 1} of {props.objects.length}</span> : null}
        </>
      )
    })
    entries.push(
      { kind: 'item', label: 'Ask the AI to change this spot…', icon: '✨', onSelect: () => dropPin(context, true) },
      { kind: 'item', label: 'Add a pin here for the chat', icon: '📍', onSelect: () => dropPin(context, false) },
      { kind: 'separator' }
    )
    if (index !== null) {
      entries.push({
        kind: 'submenu',
        label: 'Colour of this part',
        icon: '🎨',
        content: (
          <ColorPalette
            current={context.color}
            onPick={(color) => act({ type: 'paint', index, color })}
            onClear={() => act({ type: 'paint', index, color: null })}
            clearLabel="Remove the colour I set"
          />
        )
      })
    }
    if (context.color) {
      const from = context.color
      entries.push({
        kind: 'submenu',
        label: `Change ${colorName(from)} everywhere`,
        icon: <Swatch color={from} />,
        content: <ColorPalette current={from} onPick={(to) => act({ type: 'recolor', from, to })} />
      })
    }
    if (index !== null) {
      entries.push(
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Move',
          icon: '✥',
          hint: 'drag',
          onSelect: () => {
            changeGizmo('translate')
            requestAnimationFrame(() => viewer.current?.selectObject(index))
          }
        },
        {
          kind: 'submenu',
          label: 'Rotate',
          icon: '⟳',
          entries: [
            { kind: 'item', label: 'Turn left 90°', onSelect: () => act({ type: 'rotate', index, axis: 'z', degrees: 90 }) },
            { kind: 'item', label: 'Turn right 90°', onSelect: () => act({ type: 'rotate', index, axis: 'z', degrees: -90 }) },
            { kind: 'item', label: 'Turn around 180°', onSelect: () => act({ type: 'rotate', index, axis: 'z', degrees: 180 }) },
            { kind: 'separator' },
            { kind: 'item', label: 'Tip forward 90°', onSelect: () => act({ type: 'rotate', index, axis: 'x', degrees: -90 }) },
            { kind: 'item', label: 'Tip backward 90°', onSelect: () => act({ type: 'rotate', index, axis: 'x', degrees: 90 }) },
            { kind: 'item', label: 'Tip to the left 90°', onSelect: () => act({ type: 'rotate', index, axis: 'y', degrees: -90 }) },
            { kind: 'item', label: 'Tip to the right 90°', onSelect: () => act({ type: 'rotate', index, axis: 'y', degrees: 90 }) },
            { kind: 'item', label: 'Upside down', onSelect: () => act({ type: 'rotate', index, axis: 'x', degrees: 180 }) },
            { kind: 'separator' },
            { kind: 'item', label: 'Free rotate with the rings', onSelect: () => {
              changeGizmo('rotate')
              requestAnimationFrame(() => viewer.current?.selectObject(index))
            } }
          ]
        },
        {
          kind: 'submenu',
          label: 'Scale',
          icon: '⇲',
          entries: [
            { kind: 'item', label: 'Half size', onSelect: () => scaleSelected(index, 0.5) },
            { kind: 'item', label: 'A bit smaller (80%)', onSelect: () => scaleSelected(index, 0.8) },
            { kind: 'item', label: 'A bit bigger (125%)', onSelect: () => scaleSelected(index, 1.25) },
            { kind: 'item', label: 'Double size', onSelect: () => scaleSelected(index, 2) },
            { kind: 'separator' },
            { kind: 'item', label: 'Free scale with the handles', onSelect: () => {
              changeGizmo('scale')
              requestAnimationFrame(() => viewer.current?.selectObject(index))
            } }
          ]
        },
        {
          kind: 'submenu',
          label: 'Mirror',
          icon: '⇋',
          entries: [
            { kind: 'item', label: 'Left ↔ right', onSelect: () => act({ type: 'mirror', index, axis: 'x' }) },
            { kind: 'item', label: 'Front ↔ back', onSelect: () => act({ type: 'mirror', index, axis: 'y' }) },
            { kind: 'item', label: 'Top ↔ bottom', onSelect: () => act({ type: 'mirror', index, axis: 'z' }) }
          ]
        },
        { kind: 'item', label: 'Drop onto the plate', icon: '⤓', onSelect: () => act({ type: 'drop', index }) },
        {
          kind: 'item',
          label: 'Duplicate',
          icon: '⧉',
          hint: 'Ctrl+D',
          onSelect: () => {
            const bounds = viewer.current?.objectBounds(index)
            const width = bounds ? bounds.max.x - bounds.min.x : 20
            props.onObjectDuplicate(index, [Math.round(width + 5), 0, 0])
          }
        },
        { kind: 'item', label: 'Delete', icon: '🗑', hint: 'Del', danger: true, onSelect: () => props.onObjectDelete(index) },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Zoom to this part',
          icon: '🔍',
          onSelect: () => {
            const bounds = viewer.current?.objectBounds(index)
            if (bounds) viewer.current?.frameBox(bounds)
          }
        },
        { kind: 'item', label: 'Save this part as STL…', icon: '💾', onSelect: () => act({ type: 'export', index }) }
      )
    } else if (!props.objects) {
      entries.push({ kind: 'item', label: 'Finding parts… (move, colour and rotate appear in a moment)', disabled: true, onSelect: () => undefined })
    }
    entries.push({ kind: 'separator' }, ...viewTools)
    return entries
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

  const scaleSelected = (index: number, factor: number): void => {
    const bounds = viewer.current?.objectBounds(index)
    if (!bounds) return
    const center: Vector3 = [(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, bounds.min.z]
    props.onObjectScale(index, [factor, factor, factor], center)
  }

  const deleteSelected = (): void => {
    if (selectedObject === null) return
    const index = selectedObject
    viewer.current?.selectObject(null)
    props.onObjectDelete(index)
  }

  const duplicateSelected = (): void => {
    const bounds = viewer.current?.selectedBounds()
    if (selectedObject === null || !bounds) return
    const width = bounds.max.x - bounds.min.x
    props.onObjectDuplicate(selectedObject, [Math.round(width + 5), 0, 0])
  }

  const dropSelected = (): void => {
    const bounds = viewer.current?.selectedBounds()
    if (!bounds || Math.abs(bounds.min.z) < 0.001) return
    viewer.current?.nudgeSelected([0, 0, Math.round(-bounds.min.z * 1000) / 1000])
  }

  const selectedLabel = props.objects?.find((object) => object.index === selectedObject)?.label
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
        {MODE_BUTTONS.map((button) => (
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
      {mode === 'move' && selectedObject !== null && (
        <div className="viewer-edit">
          <span>
            <strong>{selectedLabel ?? 'Part'}</strong>
            {gizmoMode === 'translate' ? ' · drag to move (arrow keys 1 mm, Shift 10 mm)' : gizmoMode === 'rotate' ? ' · drag the rings to rotate' : ' · drag the handles to scale'}
          </span>
          <button className={gizmoMode === 'translate' ? 'active' : ''} onClick={() => changeGizmo('translate')}>
            Move
          </button>
          <button className={gizmoMode === 'rotate' ? 'active' : ''} onClick={() => changeGizmo('rotate')}>
            Rotate
          </button>
          <button className={gizmoMode === 'scale' ? 'active' : ''} onClick={() => changeGizmo('scale')}>
            Scale
          </button>
          <button onClick={dropSelected} title="Put it flat on the plate">
            Drop to plate
          </button>
          <button onClick={duplicateSelected} title="Ctrl+D">
            Duplicate
          </button>
          <button onClick={deleteSelected} title="Delete key">
            Delete
          </button>
          <button onClick={() => viewer.current?.selectObject(null)}>Done</button>
        </div>
      )}
      {mode === 'move' && selectedObject === null && (
        <div className="viewer-measure">
          {props.objectsError
            ? props.objectsError
            : !props.objects
              ? 'Finding the parts...'
              : props.objects.length > 1
                ? `Click one of the ${props.objects.length} parts. Then move, rotate or scale it. Sizes are in the Parts panel.`
                : 'Click the model, then move, rotate or scale it. A model built as one piece edits as a whole. Add shapes to build more parts.'}
        </div>
      )}
      {menu && <ContextMenu x={menu.screenX} y={menu.screenY} entries={menuEntries(menu)} onClose={closeMenu} />}
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
      {props.simple && !model && !rendering && !props.busy && (
        <div className="viewer-empty">
          <div>Nothing on the plate yet.</div>
          <div className="muted">Add a shape, or describe it in the chat if you want help.</div>
          <div className="viewer-shapes">
            {SHAPES.map((shape) => (
              <button key={shape.shape} onClick={() => props.onAddShape(shape.shape)}>
                {shape.icon} {shape.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {props.simple && model && mode === 'orbit' && !quick && !selected && !props.busy && (
        <div className="viewer-tip">Right-click a part to move, rotate, scale or colour it · drag to turn the view · scroll to zoom</div>
      )}
      {props.busy && <AiViewerOverlay activity={props.activity} hasModel={Boolean(model)} />}
      {rendering && !props.busy && (
        <div className="viewer-badge">
          <span className="render-dot" />
          Rendering
        </div>
      )}
      {props.fitProblem && model && <div className="viewer-fit" title="Change the plate size in Settings, or scale or split the model">⚠ {props.fitProblem}</div>}
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
