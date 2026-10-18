import { useCallback, useEffect, useRef, useState } from 'react'
import {
  appendStatement,
  aroundPoint,
  bakeOperations,
  duplicateStatement,
  findParameters,
  findParts,
  formatNumber,
  isolateStatement,
  moveStatement,
  paintStatement,
  prefixStatement,
  removeStatement,
  replaceColorLiteral,
  rotateStatement,
  scaleStatement,
  sceneObjects
} from '@shared/scad'
import { plateFitProblem } from '@shared/printers'
import type { ChatAttachments, ChatMessage, ColorPart, RenderedObject, SlicerApp, Vector3, HistoryEntry, MenuCommand, MeshStats, Operation, ProjectState, RenderMessage, Settings } from '@shared/types'
import { SLICER_APP_LABEL } from '@shared/types'
import { useAiActivity } from './components/AiActivity'
import { ChatPanel } from './components/ChatPanel'
import { CodeEditor } from './components/CodeEditor'
import { HistoryPanel } from './components/HistoryPanel'
import { OpsPanel } from './components/OpsPanel'
import { ParamsPanel } from './components/ParamsPanel'
import { prepareImage } from './lib/images'
import { SettingsDialog } from './components/SettingsDialog'
import { SlicerDialog } from './components/SlicerDialog'
import { ObjectPanel } from './components/ObjectPanel'
import { PartAction, Viewer } from './components/Viewer'
import { ShapeKind } from './lib/shapes'
import { Welcome } from './components/Welcome'
import type { ModelViewer, ViewerMode } from './lib/viewer'
import { useFileDrop } from './lib/fileDrop'
import { convertSvg } from './lib/svgArtwork'

type LeftTab = 'parts' | 'params' | 'code' | 'ops' | 'history'

const EMPTY_ATTACHMENTS: ChatAttachments = { images: [], pins: [] }

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [project, setProject] = useState<ProjectState | null>(null)
  const [code, setCode] = useState('')
  const [savedCode, setSavedCode] = useState('')
  const [ops, setOps] = useState<Operation[]>([])
  const [part, setPart] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [model, setModel] = useState<ColorPart[] | null>(null)
  const [stats, setStats] = useState<MeshStats | null>(null)
  const [errors, setErrors] = useState<RenderMessage[]>([])
  const [warnings, setWarnings] = useState<RenderMessage[]>([])
  const [renderInfo, setRenderInfo] = useState('')
  const [rendering, setRendering] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<LeftTab>('parts')
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachments>(EMPTY_ATTACHMENTS)
  const [showSettings, setShowSettings] = useState(false)
  const [slicerApp, setSlicerApp] = useState<SlicerApp | null>(null)
  const [exportMenu, setExportMenu] = useState(false)
  const [selection, setSelection] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ index: number; token: number } | null>(null)
  const [liveBounds, setLiveBounds] = useState<{ min: Vector3; max: Vector3 } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [moveMode, setMoveMode] = useState(false)
  const [objects, setObjects] = useState<RenderedObject[] | null>(null)
  const [objectsError, setObjectsError] = useState<string | null>(null)
  const objectsToken = useRef(0)
  const movedCode = useRef<string | null>(null)
  const activity = useAiActivity(messages, busy)
  const viewer = useRef<ModelViewer | null>(null)
  const renderToken = useRef(0)
  const latest = useRef({ code, ops, part })
  latest.current = { code, ops, part }

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, text, kind }])
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])

  useEffect(() => {
    window.studio.settings.get().then(setSettings)
    window.studio.project.startup().then((opened) => opened && openProject(opened))
  }, [])

  const updateSettings = useCallback(async (update: Partial<Settings>) => {
    setSettings(await window.studio.settings.set(update))
  }, [])

  const render = useCallback(async () => {
    if (!project) return
    const token = ++renderToken.current
    setRendering(true)
    const { code: currentCode, ops: currentOps, part: currentPart } = latest.current
    const result = await window.studio.render({ code: currentCode, ops: currentOps, part: currentPart })
    if (token !== renderToken.current) return
    setRendering(false)
    setErrors(result.errors)
    setWarnings(result.warnings)
    if (result.ok && result.stl) {
      setModel(result.parts ?? [{ color: '', stl: result.stl }])
      setStats(result.stats ?? null)
      setRenderInfo(`Rendered in ${(result.durationMs / 1000).toFixed(1)} s`)
    } else if (result.ok || result.errors.every((error) => /model is empty|nothing is drawn/i.test(error.text))) {
      setModel(null)
      setStats(null)
      setErrors([])
      setRenderInfo('')
    } else {
      setRenderInfo(result.errors[0]?.text === 'Render cancelled' ? '' : 'Render failed')
    }
  }, [project])

  const openProject = useCallback(
    async (opened: ProjectState | null) => {
      if (!opened) return
      setProject(opened)
      setCode(opened.code)
      setSavedCode(opened.code)
      setOps(opened.ops)
      setPart(opened.part)
      setHistory(opened.history)
      setSelectedOpId(null)
      setAttachments(EMPTY_ATTACHMENTS)
      setModel(null)
      setStats(null)
      setErrors([])
      setWarnings([])
      setMessages(await window.studio.ai.messages())
      setSettings(await window.studio.settings.get())
    },
    []
  )

  const parts = findParts(code).parts

  useEffect(() => {
    if (!project) {
      setObjects(null)
      return
    }
    const keepCurrent = movedCode.current === code
    movedCode.current = null
    if (!keepCurrent) setObjects(null)
    setObjectsError(null)
    const token = ++objectsToken.current
    const timer = setTimeout(async () => {
      try {
        const found = await window.studio.renderObjects({ code, ops, part })
        if (token !== objectsToken.current) return
        setObjects(found)
        if (!found.length && sceneObjects(code).length) setObjectsError('Nothing to select: fix the model so it renders first.')
      } catch (error) {
        if (token === objectsToken.current) setObjectsError((error as Error).message)
      }
    }, keepCurrent ? 300 : moveMode ? 0 : 1200)
    return () => clearTimeout(timer)
  }, [project, moveMode, code, ops, part])

  const editObjects = (nextCode: string, label: string, keepObjects: boolean): void => {
    if (nextCode === latest.current.code) return
    movedCode.current = keepObjects ? nextCode : null
    setCode(nextCode)
    save(label, nextCode)
  }

  const runPartAction = async (action: PartAction): Promise<void> => {
    const current = latest.current.code
    const instance = viewer.current
    if (action.type === 'paint') {
      editObjects(paintStatement(current, action.index, action.color), action.color ? `Coloured ${objectLabel(action.index)}` : `Removed colour from ${objectLabel(action.index)}`, false)
      return
    }
    if (action.type === 'recolor') {
      const { code: recoloured, count } = replaceColorLiteral(current, action.from, action.to)
      if (!count) {
        toast('That colour is calculated inside the code, so it cannot be swapped directly. Use "Colour of this part" or ask the AI.', 'error')
        return
      }
      editObjects(recoloured, `Changed ${action.from} to ${action.to}`, false)
      return
    }
    if (action.type === 'addShape') {
      editObjects(appendStatement(current, shapeCode(action.shape, action.at)), `Added a ${action.shape}`, false)
      return
    }
    if (action.type === 'export') {
      const isolated = isolateStatement(current, action.index)
      if (!isolated) return
      try {
        const path = await window.studio.exportMesh({ code: isolated, ops, part, format: 'stl' })
        if (path) toast(`Saved ${path}`)
      } catch (error) {
        toast((error as Error).message, 'error')
      }
      return
    }
    const bounds = instance?.objectBounds(action.index)
    if (!bounds) return
    const center: Vector3 = [bounds.min.x + bounds.max.x, bounds.min.y + bounds.max.y, bounds.min.z + bounds.max.z].map((value) => Math.round(value * 500) / 1000) as Vector3
    const label = objectLabel(action.index)
    if (action.type === 'drop') {
      if (Math.abs(bounds.min.z) < 0.001) return
      editObjects(moveStatement(current, action.index, [0, 0, -Math.round(bounds.min.z * 1000) / 1000]), `Dropped ${label} onto the plate`, false)
    }
    if (action.type === 'rotate') {
      const axis: Vector3 = [0, 0, 0]
      axis['xyz'.indexOf(action.axis)] = 1
      const lowest = instance?.lowestAfterRotation(action.index, action.axis, action.degrees) ?? bounds.min.z
      const lift = Math.round((bounds.min.z - lowest) * 1000) / 1000
      editObjects(rotateStatement(current, action.index, axis, action.degrees, center, [0, 0, lift]), `Rotated ${label}`, true)
    }
    if (action.type === 'mirror') {
      const normal = [0, 0, 0]
      normal['xyz'.indexOf(action.axis)] = 1
      editObjects(prefixStatement(current, action.index, aroundPoint(center, `mirror([${normal.join(', ')}])`)), `Mirrored ${label}`, false)
    }
  }

  const objectLabel = (index: number): string => objects?.find((object) => object.index === index)?.label ?? partLabelsLabel(code, index)

  useEffect(() => {
    if (selection === null) {
      setLiveBounds(null)
      return
    }
    const box = viewer.current?.objectBounds(selection)
    if (!box) {
      setLiveBounds(null)
      return
    }
    setLiveBounds({
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z]
    })
  }, [selection, objects, model])

  const placeSelection = (kind: 'center' | 'fit'): void => {
    if (selection === null || !liveBounds || !settings) return
    const anchor = boundsCenter(liveBounds, 'base')
    if (!anchor) return
    const size = liveBounds.max.map((value, axis) => value - liveBounds.min[axis])
    let next = latest.current.code
    if (kind === 'fit') {
      if (size.some((value) => value < 0.05)) return
      const factor = Math.min((settings.bedX - 4) / size[0], (settings.bedY - 4) / size[1], Math.max(settings.bedZ - 1, 1) / size[2])
      if (!Number.isFinite(factor) || factor <= 0) return
      next = scaleStatement(next, selection, [factor, factor, factor], anchor)
    }
    const dx = settings.bedX / 2 - anchor[0]
    const dy = settings.bedY / 2 - anchor[1]
    const dz = -liveBounds.min[2]
    next = moveStatement(next, selection, [dx, dy, dz])
    editObjects(next, kind === 'fit' ? `Fitted ${objectLabel(selection)} on the plate` : `Centered ${objectLabel(selection)}`, true)
  }

  useEffect(() => {
    const drawable = sceneObjects(code).length > 0 || ops.some((operation) => operation.enabled && operation.kind === 'addBox')
    if (drawable) return
    setModel(null)
    setStats(null)
    setErrors([])
    setWarnings([])
    setRenderInfo('')
    setObjectsError(null)
  }, [code, ops])

  useEffect(() => {
    if (!project || !settings?.autoRender) return
    const timer = setTimeout(render, 600)
    return () => clearTimeout(timer)
  }, [code, ops, part, project, settings?.autoRender, render])

  useEffect(() => {
    if (!project) return
    const timer = setTimeout(() => window.studio.project.saveMeta({ ops, part }), 400)
    return () => clearTimeout(timer)
  }, [ops, part, project])

  useEffect(() => {
    return window.studio.project.onCodeChanged((nextCode) => {
      setCode(nextCode)
      setSavedCode(nextCode)
      window.studio.project.history().then(setHistory).catch(() => undefined)
    })
  }, [])

  useEffect(() => {
    return window.studio.ai.onEvent((event) => {
      if (event.type === 'message') setMessages((current) => [...current, event.message])
      if (event.type === 'busy') {
        setBusy(event.busy)
        if (!event.busy) window.studio.project.history().then(setHistory).catch(() => undefined)
      }
    })
  }, [])

  useEffect(() => {
    return window.studio.capture.onRequest((request) => {
      const instance = viewer.current
      if (!instance) {
        window.studio.capture.respond(request.id, null)
        return
      }
      if (request.parts) {
        setModel(request.parts)
        instance.showModel(request.parts, true)
      }
      requestAnimationFrame(() => window.studio.capture.respond(request.id, instance.capture(request.view)))
    })
  }, [])

  const save = useCallback(
    async (label?: string, nextCode?: string, nextOps?: Operation[]) => {
      if (!project) return
      const codeToSave = nextCode ?? latest.current.code
      const entries = await window.studio.project.save({ code: codeToSave, ops: nextOps ?? latest.current.ops, part: latest.current.part, label })
      setSavedCode(codeToSave)
      setHistory(entries)
    },
    [project]
  )

  const bake = async (): Promise<void> => {
    const baked = bakeOperations(code, ops)
    setCode(baked)
    setOps([])
    await save('Baked operations into code', baked, [])
    toast('Operations written into the code')
  }

  const restore = async (id: string): Promise<void> => {
    const result = await window.studio.project.restore(id)
    setCode(result.code)
    setSavedCode(result.code)
    setHistory(result.history)
    toast('Earlier version restored')
  }

  const exportMesh = async (format: 'stl' | '3mf'): Promise<void> => {
    setExportMenu(false)
    try {
      const path = await window.studio.exportMesh({ code, ops, part, format })
      if (path) toast(`Exported ${path}`)
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const loadFiles = async (load: (currentCode: string | null) => Promise<ProjectState | null>): Promise<void> => {
    try {
      const imported = await load(project ? latest.current.code : null)
      if (!imported) return
      if (project && imported.dir === project.dir) {
        setCode(imported.code)
        setSavedCode(imported.code)
        setHistory(imported.history)
        setProject(imported)
        toast('Model added')
      } else {
        await openProject(imported)
      }
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const importModels = (): Promise<void> => loadFiles((currentCode) => window.studio.project.importModels(currentCode))
  const openFile = (): Promise<void> => loadFiles((currentCode) => window.studio.project.openFile(currentCode))
  const openFiles = (paths: string[]): Promise<void> => loadFiles((currentCode) => window.studio.project.openFiles({ paths, currentCode }))

  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles

  useEffect(() => window.studio.project.onOpenRequest((paths) => openFilesRef.current(paths)), [])

  useEffect(
    () =>
      window.studio.project.onConvertSvg((request) => {
        try {
          window.studio.project.convertedSvg({ id: request.id, artwork: convertSvg(request.text, request.fileName) })
        } catch (error) {
          window.studio.project.convertedSvg({ id: request.id, error: (error as Error).message })
        }
      }),
    []
  )

  const sendChat = async (prompt: string, extra?: ChatAttachments): Promise<void> => {
    if (busy) {
      toast('The AI is still working on the last request. Wait for it or press Stop.')
      return
    }
    const payload = extra ?? attachments
    try {
      await window.studio.ai.send({ prompt, ops, part, code, attachments: payload })
      setSavedCode(code)
      setAttachments(EMPTY_ATTACHMENTS)
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const annotatedView = async (): Promise<ChatAttachments['images'][number] | null> => {
    const instance = viewer.current
    if (!instance) return null
    return prepareImage('Annotated view from the user (numbered pins and red marks show what they mean)', instance.snapshot())
  }

  const quickAction = async (prompt: string): Promise<void> => {
    const view = await annotatedView()
    await sendChat(prompt, { images: [...attachments.images, ...(view ? [view] : [])], pins: attachments.pins })
  }

  const undo = async (): Promise<void> => {
    if (busy) return
    if (code !== savedCode) {
      setCode(savedCode)
      toast('Undone: back to the last saved version')
      return
    }
    const result = await window.studio.project.undo()
    if (!result) {
      toast('Nothing to undo')
      return
    }
    setCode(result.code)
    setSavedCode(result.code)
    setHistory(result.history)
    toast(`Undone: back to "${result.label}"`)
  }

  const undoShortcut = useRef(undo)
  undoShortcut.current = undo

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], .cm-editor'))) return
      event.preventDefault()
      undoShortcut.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const startFromPrompt = async (name: string, prompt: string, startAttachments: ChatAttachments): Promise<void> => {
    try {
      const opened = await window.studio.project.quickCreate(name || 'New part')
      await openProject(opened)
      await window.studio.ai.send({ prompt, ops: [], part: '', code: opened.code, attachments: startAttachments })
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const canLeaveProject = (): boolean =>
    !project || code === savedCode || window.confirm('You have unsaved changes in the code. Leave this project without saving?')

  const closeProject = async (): Promise<void> => {
    await window.studio.project.close()
    setProject(null)
    setModel(null)
    setSettings(await window.studio.settings.get())
  }

  const guardedOpen = async (load: () => Promise<ProjectState | null>): Promise<void> => {
    if (!canLeaveProject()) return
    try {
      await openProject(await load())
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const runMenuCommand = (command: MenuCommand): void => {
    if (command.type === 'newProject') guardedOpen(() => window.studio.project.create())
    if (command.type === 'openProject') guardedOpen(() => window.studio.project.open())
    if (command.type === 'openFile') openFile()
    if (command.type === 'openRecent') guardedOpen(() => window.studio.project.openPath(command.dir))
    if (command.type === 'clearRecent') updateSettings({ recentProjects: [] })
    if (command.type === 'importModels') importModels()
    if (command.type === 'settings') setShowSettings(true)
    if (command.type === 'uiMode') updateSettings({ uiMode: command.mode })
    if (!project) return
    if (command.type === 'save') save()
    if (command.type === 'export') exportMesh(command.format)
    if (command.type === 'slicer') setSlicerApp(command.app)
    if (command.type === 'closeProject' && canLeaveProject()) closeProject()
    if (command.type === 'undo') undo()
    if (command.type === 'render') render()
    if (command.type === 'view') viewer.current?.setView(command.view)
  }

  const menuCommand = useRef(runMenuCommand)
  menuCommand.current = runMenuCommand

  useEffect(() => window.studio.menu.onCommand((command) => menuCommand.current(command)), [])

  const dropActive = useFileDrop((paths) => openFilesRef.current(paths), (text) => toast(text))

  const dropOverlay = dropActive && (
    <div className="drop-overlay">
      <div>
        <strong>Drop to open</strong>
        <span>STL, 3MF, SVG or OpenSCAD file, or a project folder</span>
      </div>
    </div>
  )

  if (!settings) return <div className="loading">Loading...</div>

  if (!project) {
    return (
      <>
        {dropOverlay}
        <Welcome
          recent={settings.recentProjects}
          onStart={startFromPrompt}
          onCreateEmpty={async () => openProject(await window.studio.project.create())}
          onOpen={async () => openProject(await window.studio.project.open())}
          onImport={importModels}
          onOpenRecent={async (dir) => {
            try {
              await openProject(await window.studio.project.openPath(dir))
            } catch (error) {
              toast((error as Error).message, 'error')
            }
          }}
          onSettings={() => setShowSettings(true)}
        />
        {showSettings && <SettingsDialog settings={settings} onSave={updateSettings} onClose={() => setShowSettings(false)} />}
        <Toasts toasts={toasts} />
      </>
    )
  }

  const dirty = code !== savedCode
  const simple = settings.uiMode === 'simple'
  const hasParameters = findParameters(code).some((parameter) => parameter.name !== 'part')
  const partLabels = sceneObjects(code)
  const showLeft = true

  const exportMenuElement = (
    <div className="menu">
      <button className={simple ? 'primary' : ''} onClick={() => setExportMenu(!exportMenu)}>
        {simple ? 'Save for printing ▾' : 'Export ▾'}
      </button>
      {exportMenu && (
        <div className="menu-items" onMouseLeave={() => setExportMenu(false)}>
          {(['bambu', 'snapmaker', 'orca'] as SlicerApp[]).map((app) => (
            <button
              key={app}
              onClick={() => {
                setExportMenu(false)
                setSlicerApp(app)
              }}
            >
              {SLICER_APP_LABEL[app]} project
            </button>
          ))}
          <button onClick={() => exportMesh('stl')}>STL (any printer)</button>
          <button onClick={() => exportMesh('3mf')}>3MF (any printer, keeps colours)</button>
        </div>
      )}
    </div>
  )

  const partsEditor = (
    <ObjectPanel
      parts={partLabels}
      selected={selection}
      bounds={liveBounds}
      bed={[settings.bedX, settings.bedY, settings.bedZ]}
      pending={!objects}
      error={objectsError}
      onSelect={(index) => {
        setSelection(index)
        setFocus({ index, token: Date.now() })
      }}
      onMove={(delta) => selection !== null && editObjects(moveStatement(latest.current.code, selection, delta), `Moved ${objectLabel(selection)}`, true)}
      onRotate={(axis, degrees) => {
        const center = boundsCenter(liveBounds, 'center')
        if (selection === null || !center || !liveBounds) return
        const dominant = axis.findIndex((value) => Math.abs(value) > 0.9)
        let shift: Vector3 = [0, 0, 0]
        if (dominant >= 0) {
          const lowest = viewer.current?.lowestAfterRotation(selection, 'xyz'[dominant] as 'x' | 'y' | 'z', degrees)
          if (lowest !== null && lowest !== undefined) shift = [0, 0, Math.round((liveBounds.min[2] - lowest) * 1000) / 1000]
        }
        editObjects(rotateStatement(latest.current.code, selection, axis, degrees, center, shift), `Rotated ${objectLabel(selection)}`, true)
      }}
      onScale={(factor, anchor) => {
        const center = boundsCenter(liveBounds, anchor)
        if (selection === null || !center) return
        editObjects(scaleStatement(latest.current.code, selection, factor, center), `Resized ${objectLabel(selection)}`, true)
      }}
      onDrop={() => {
        if (selection === null || !liveBounds || Math.abs(liveBounds.min[2]) < 0.001) return
        editObjects(moveStatement(latest.current.code, selection, [0, 0, -liveBounds.min[2]]), `Dropped ${objectLabel(selection)} onto the plate`, true)
      }}
      onCenter={() => placeSelection('center')}
      onFit={() => placeSelection('fit')}
      onDuplicate={() => {
        if (selection === null || !liveBounds) return
        const width = liveBounds.max[0] - liveBounds.min[0]
        editObjects(duplicateStatement(latest.current.code, selection, [Math.round(width + 5), 0, 0]), `Duplicated ${objectLabel(selection)}`, false)
      }}
      onDelete={() => {
        if (selection === null) return
        const index = selection
        setSelection(null)
        viewer.current?.selectObject(null)
        editObjects(removeStatement(latest.current.code, index), `Deleted ${objectLabel(index)}`, false)
      }}
      onMirror={(axis) => {
        if (selection === null) return
        const center = boundsCenter(liveBounds, 'center')
        if (!center) return
        const normal: Vector3 = [0, 0, 0]
        normal['xyz'.indexOf(axis)] = 1
        editObjects(prefixStatement(latest.current.code, selection, aroundPoint(center, `mirror([${normal.join(', ')}])`)), `Mirrored ${objectLabel(selection)}`, false)
      }}
      onAddShape={(shape) => editObjects(appendStatement(latest.current.code, shapeCode(shape, [settings.bedX / 2, settings.bedY / 2, 0])), `Added a ${shape}`, false)}
    />
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">3D Studio</div>
        <div className="project-name" title={project.dir} onClick={() => window.studio.project.reveal()}>
          {project.name}
          {dirty && !simple ? ' •' : ''}
        </div>
        <button
          onClick={() => canLeaveProject() && closeProject()}
        >
          {simple ? 'Home' : 'Projects'}
        </button>
        <button onClick={undo} disabled={busy} title="Go back to how it was before the last change (Ctrl+Z)">
          ↶ Undo
        </button>
        {simple ? (
          <button onClick={importModels}>Add a file</button>
        ) : (
          <>
            <button onClick={importModels}>Import STL/3MF</button>
            <button onClick={() => save()} disabled={!dirty}>
              Save
            </button>
          </>
        )}
        <span className="spacer" />
        {parts.length > 1 && (
          <label className="part-picker">
            {simple ? 'Show' : 'Part'}
            <select value={part} onChange={(event) => setPart(event.target.value)}>
              {parts.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!simple && (
          <button className="primary" onClick={render} disabled={rendering}>
            {rendering ? 'Rendering...' : 'Render (F5)'}
          </button>
        )}
        {exportMenuElement}
        <div className="mode-switch" title="Simple hides the technical tools">
          <button className={simple ? 'active' : ''} onClick={() => updateSettings({ uiMode: 'simple' })}>
            Simple
          </button>
          <button className={!simple ? 'active' : ''} onClick={() => updateSettings({ uiMode: 'expert' })}>
            Expert
          </button>
        </div>
        <button onClick={() => setShowSettings(true)}>Settings</button>
      </header>
      <main className={`workspace ${showLeft ? '' : 'no-left'} ${simple ? 'simple' : ''}`}>
        {showLeft && (
          <section className="left-pane">
            {simple ? (
              <>
                <div className="pane-title">Parts</div>
                <div className="tab-body scroll">
                  {partsEditor}
                  {hasParameters && (
                    <>
                      <div className="pane-title">Sizes</div>
                      <ParamsPanel code={code} onChange={setCode} />
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="tabs">
                  <button className={tab === 'parts' ? 'active' : ''} onClick={() => setTab('parts')}>
                    Parts
                  </button>
                  <button className={tab === 'params' ? 'active' : ''} onClick={() => setTab('params')}>
                    Parameters
                  </button>
                  <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>
                    Code
                  </button>
                  <button className={tab === 'ops' ? 'active' : ''} onClick={() => setTab('ops')}>
                    Operations{ops.length ? ` (${ops.length})` : ''}
                  </button>
                  <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
                    History
                  </button>
                </div>
                <div className="tab-body" style={{ display: tab === 'code' ? 'flex' : 'none' }}>
                  <CodeEditor value={code} onChange={setCode} onSave={() => save()} onRender={render} errors={errors} warnings={warnings} />
                </div>
                {tab === 'parts' && <div className="tab-body scroll">{partsEditor}</div>}
                {tab === 'params' && (
                  <div className="tab-body scroll">
                    <ParamsPanel code={code} onChange={setCode} />
                  </div>
                )}
                {tab === 'ops' && (
                  <div className="tab-body scroll">
                    <OpsPanel
                      ops={ops}
                      stats={stats}
                      bed={[settings.bedX, settings.bedY]}
                      selectedId={selectedOpId}
                      onSelect={setSelectedOpId}
                      onChange={setOps}
                      onBake={bake}
                    />
                  </div>
                )}
                {tab === 'history' && (
                  <div className="tab-body scroll">
                    <HistoryPanel history={history} onRestore={restore} />
                  </div>
                )}
                <div className={`render-log ${errors.length ? 'has-errors' : ''}`}>
                  {errors.map((error, index) => (
                    <div key={`e${index}`} className="error-text">
                      {error.line ? `Line ${error.line}: ` : ''}
                      {error.text}
                    </div>
                  ))}
                  {warnings.slice(0, 5).map((warning, index) => (
                    <div key={`w${index}`} className="warning-text">
                      {warning.line ? `Line ${warning.line}: ` : ''}
                      {warning.text}
                    </div>
                  ))}
                  {!errors.length && !warnings.length && <div className="muted">{renderInfo || 'Ctrl+S save · F5 or Ctrl+Enter render'}</div>}
                </div>
              </>
            )}
          </section>
        )}
        <section className="center-pane">
          <Viewer
            model={model}
            ops={ops}
            selectedOpId={!simple && tab === 'ops' ? selectedOpId : null}
            pins={attachments.pins}
            stats={simple ? null : stats}
            rendering={rendering}
            bed={[settings.bedX, settings.bedY, settings.bedZ]}
            fitProblem={stats ? plateFitProblem(stats.size, [settings.bedX, settings.bedY, settings.bedZ]) : null}
            simple={simple}
            busy={busy}
            activity={activity}
            onViewer={(instance) => (viewer.current = instance)}
            onEditOperation={(operation) => setOps((current) => current.map((op) => (op.id === operation.id ? operation : op)))}
            onDeselect={() => setSelectedOpId(null)}
            objects={objects}
            objectsError={objectsError}
            onModeChange={(mode: ViewerMode) => setMoveMode(mode === 'move')}
            onObjectMove={(index, delta) => editObjects(moveStatement(latest.current.code, index, delta), `Moved ${objectLabel(index)}`, true)}
            onObjectRotate={(index, axis, degrees, center) => editObjects(rotateStatement(latest.current.code, index, axis, degrees, center), `Rotated ${objectLabel(index)}`, true)}
            onObjectScale={(index, factor, center) => editObjects(scaleStatement(latest.current.code, index, factor, center), `Scaled ${objectLabel(index)}`, true)}
            onObjectDelete={(index) => editObjects(removeStatement(latest.current.code, index), `Deleted ${objectLabel(index)}`, false)}
            onPartAction={runPartAction}
            onObjectDuplicate={(index, offset) => editObjects(duplicateStatement(latest.current.code, index, offset), `Duplicated ${objectLabel(index)}`, false)}
            focus={focus}
            onAddShape={(shape) => editObjects(appendStatement(latest.current.code, shapeCode(shape, [settings.bedX / 2, settings.bedY / 2, 0])), `Added a ${shape}`, false)}
            onSelection={setSelection}
            onPin={(hit) => {
              const id = attachments.pins.reduce((max, pin) => Math.max(max, pin.id), 0) + 1
              setAttachments((current) => ({ ...current, pins: [...current.pins, { id, point: hit.point, normal: hit.normal, note: '' }] }))
              return id
            }}
            onRemovePin={(id) => setAttachments((current) => ({ ...current, pins: current.pins.filter((pin) => pin.id !== id) }))}
            onQuickAction={quickAction}
            onDescribePin={() => (document.querySelector('.chat-input textarea') as HTMLTextAreaElement | null)?.focus()}
            onSnapshot={async (dataUrl, annotated) => {
              const image = await prepareImage(annotated ? 'Annotated view from the user (red marks and numbered pins show what they mean)' : 'View from the user', dataUrl)
              setAttachments((current) => ({ ...current, images: [...current.images, image] }))
              toast('View attached to the chat')
            }}
          />
          {simple && errors.length > 0 && !busy && code.trim() !== '' && (
            <div className="viewer-problem">
              The model has a problem: {errors[0].text}
              <button onClick={() => updateSettings({ uiMode: 'expert' })}>Edit the code</button>
              <button onClick={() => sendChat(`The model does not render. Please fix it. Errors: ${errors.map((error) => error.text).join('; ')}`)}>Ask AI to fix it</button>
            </div>
          )}
        </section>
        <section className="right-pane">
          <ChatPanel
            messages={messages}
            busy={busy}
            activity={activity}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            settings={settings}
            onSend={(prompt) => sendChat(prompt)}
            onStop={() => window.studio.ai.stop()}
            onClear={async () => {
              await window.studio.ai.clear()
              setMessages([])
            }}
            onSettings={updateSettings}
            onOpenSettings={() => setShowSettings(true)}
          />
        </section>
      </main>
      {showSettings && <SettingsDialog settings={settings} onSave={updateSettings} onClose={() => setShowSettings(false)} />}
      {slicerApp && (
        <SlicerDialog
          app={slicerApp}
          projectName={project.name}
          parts={parts}
          currentPart={part}
          onClose={() => setSlicerApp(null)}
          onExport={async (choice) => {
            const outputPath = await window.studio.slicer.chooseOutput(project.name)
            if (!outputPath) throw new Error('Export cancelled')
            const summary = await window.studio.slicer.exportProject({
              request: { ...choice, app: slicerApp, outputPath, title: project.name },
              code,
              ops
            })
            toast(summary)
            window.studio.slicer.open(outputPath)
          }}
        />
      )}
      <Toasts toasts={toasts} />
      {dropOverlay}
    </div>
  )
}

function partLabelsLabel(source: string, index: number): string {
  return sceneObjects(source).find((object) => object.index === index)?.label ?? 'part'
}

function boundsCenter(bounds: { min: Vector3; max: Vector3 } | null, anchor: 'center' | 'base' | 'min'): Vector3 | null {
  if (!bounds) return null
  const mid = (axis: number): number => (bounds.min[axis] + bounds.max[axis]) / 2
  if (anchor === 'min') return [bounds.min[0], bounds.min[1], bounds.min[2]]
  if (anchor === 'base') return [mid(0), mid(1), bounds.min[2]]
  return [mid(0), mid(1), mid(2)]
}

function shapeCode(shape: ShapeKind, at: Vector3): string {
  const x = formatNumber(at[0])
  const y = formatNumber(at[1])
  switch (shape) {
    case 'box':
      return `translate([${x} - 10, ${y} - 10, 0]) cube([20, 20, 20]);`
    case 'cylinder':
      return `translate([${x}, ${y}, 0]) cylinder(d = 20, h = 20, $fn = 96);`
    case 'sphere':
      return `translate([${x}, ${y}, 10]) sphere(d = 20, $fn = 96);`
    case 'cone':
      return `translate([${x}, ${y}, 0]) cylinder(d1 = 20, d2 = 0, h = 20, $fn = 96);`
    case 'tube':
      return `translate([${x}, ${y}, 0]) difference() { cylinder(d = 20, h = 10, $fn = 96); translate([0, 0, -1]) cylinder(d = 14, h = 12, $fn = 96); }`
    case 'text':
      return `translate([${x}, ${y}, 0]) linear_extrude(3) text("Text", size = 10, halign = "center", valign = "center");`
  }
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          {item.text}
        </div>
      ))}
    </div>
  )
}
