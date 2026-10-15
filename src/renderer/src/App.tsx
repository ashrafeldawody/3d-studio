import { useCallback, useEffect, useRef, useState } from 'react'
import { bakeOperations, findParameters, findParts } from '@shared/scad'
import type { ChatAttachments, ChatMessage, HistoryEntry, MeshStats, Operation, ProjectState, RenderMessage, Settings } from '@shared/types'
import { ChatPanel } from './components/ChatPanel'
import { CodeEditor } from './components/CodeEditor'
import { HistoryPanel } from './components/HistoryPanel'
import { OpsPanel } from './components/OpsPanel'
import { ParamsPanel } from './components/ParamsPanel'
import { prepareImage } from './lib/images'
import { SettingsDialog } from './components/SettingsDialog'
import { SlicerDialog } from './components/SlicerDialog'
import { Viewer } from './components/Viewer'
import { Welcome } from './components/Welcome'
import type { ModelViewer } from './lib/viewer'

type LeftTab = 'params' | 'code' | 'ops' | 'history'

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
  const [stl, setStl] = useState<Uint8Array | null>(null)
  const [stats, setStats] = useState<MeshStats | null>(null)
  const [errors, setErrors] = useState<RenderMessage[]>([])
  const [warnings, setWarnings] = useState<RenderMessage[]>([])
  const [renderInfo, setRenderInfo] = useState('')
  const [rendering, setRendering] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<LeftTab>('code')
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachments>(EMPTY_ATTACHMENTS)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSlicer, setShowSlicer] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
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
      setStl(result.stl)
      setStats(result.stats ?? null)
      setRenderInfo(`Rendered in ${(result.durationMs / 1000).toFixed(1)} s`)
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
      setStl(null)
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
      if (request.stl) {
        setStl(request.stl)
        instance.showStl(request.stl, true)
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

  const importModels = async (): Promise<void> => {
    try {
      const imported = await window.studio.project.importModels(project ? code : null)
      if (!imported) return
      if (project && imported.dir === project.dir) {
        setCode(imported.code)
        setSavedCode(imported.code)
        setHistory(imported.history)
        setProject(imported)
        toast('Model imported')
      } else {
        await openProject(imported)
      }
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

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

  if (!settings) return <div className="loading">Loading...</div>

  if (!project) {
    return (
      <>
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
  const showLeft = !simple || (hasParameters && adjustOpen)

  const exportMenuElement = (
    <div className="menu">
      <button className={simple ? 'primary' : ''} onClick={() => setExportMenu(!exportMenu)}>
        {simple ? 'Save for printing ▾' : 'Export ▾'}
      </button>
      {exportMenu && (
        <div className="menu-items" onMouseLeave={() => setExportMenu(false)}>
          <button
            onClick={() => {
              setExportMenu(false)
              setShowSlicer(true)
            }}
          >
            Slicer project (Snapmaker Orca / OrcaSlicer)
          </button>
          <button onClick={() => exportMesh('stl')}>STL file</button>
          <button onClick={() => exportMesh('3mf')}>3MF file</button>
        </div>
      )}
    </div>
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
          onClick={async () => {
            await window.studio.project.close()
            setProject(null)
            setSettings(await window.studio.settings.get())
          }}
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
        {simple && hasParameters && (
          <button className={adjustOpen ? 'active' : ''} onClick={() => setAdjustOpen(!adjustOpen)}>
            Adjust sizes
          </button>
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
                <div className="pane-title">Adjust sizes</div>
                <div className="tab-body scroll">
                  <ParamsPanel code={code} onChange={setCode} />
                </div>
              </>
            ) : (
              <>
                <div className="tabs">
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
            stl={stl}
            ops={ops}
            selectedOpId={!simple && tab === 'ops' ? selectedOpId : null}
            pins={attachments.pins}
            stats={simple ? null : stats}
            rendering={rendering}
            bed={[settings.bedX, settings.bedY]}
            simple={simple}
            busy={busy}
            onViewer={(instance) => (viewer.current = instance)}
            onEditOperation={(operation) => setOps((current) => current.map((op) => (op.id === operation.id ? operation : op)))}
            onDeselect={() => setSelectedOpId(null)}
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
              The model has a problem.
              <button onClick={() => sendChat(`The model does not render. Please fix it. Errors: ${errors.map((error) => error.text).join('; ')}`)}>Ask AI to fix it</button>
            </div>
          )}
        </section>
        <section className="right-pane">
          <ChatPanel
            messages={messages}
            busy={busy}
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
      {showSlicer && (
        <SlicerDialog
          projectName={project.name}
          parts={parts}
          currentPart={part}
          onClose={() => setShowSlicer(false)}
          onExport={async (choice) => {
            const outputPath = await window.studio.slicer.chooseOutput(project.name)
            if (!outputPath) throw new Error('Export cancelled')
            const summary = await window.studio.slicer.exportProject({
              request: { ...choice, outputPath, title: project.name },
              code,
              ops
            })
            toast(summary)
            window.studio.slicer.open(outputPath)
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  )
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
