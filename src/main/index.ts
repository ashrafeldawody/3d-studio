import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { ChatAttachments, CliAgent, Operation, ProjectState, RenderResult, SlicerApp, SlicerExportRequest, VectorArtwork, ViewName } from '@shared/types'
import { analyseMesh, readStl, safeName, write3mf } from './mesh'
import { buildAppMenu } from './menu'
import { renderModel, renderObjects } from './openscad'
import { buildSlicerProject, listSlicerPresets } from './orca'
import {
  appendImportedMeshes,
  codeForImportedMeshes,
  createProject,
  historyCode,
  importArtwork,
  importMeshFile,
  isProject,
  listHistory,
  loadProject,
  MODEL_FILE,
  readCode,
  saveMeta,
  snapshot,
  undoTarget,
  uniqueProjectFolder,
  watchModel,
  writeCode
} from './project'
import { loadSettings, rememberProject, saveSettings } from './settings'
import { chatMessages, clearChat, sendChat, stopChat } from './ai/session'
import { listOpenRouterModels } from './ai/openrouter'
import { listAgentModels } from './ai/cliAgents'

let window: BrowserWindow | null = null
let currentDir: string | null = null
const pendingCaptures = new Map<string, (dataUrl: string | null) => void>()

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#15171a',
    title: '3D Studio',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  refreshMenu()
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') window?.webContents.toggleDevTools()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}

function refreshMenu(): void {
  if (window) buildAppMenu(window, currentDir)
}

const send = (channel: string, payload?: unknown): void => {
  window?.webContents.send(channel, payload)
}

function openProject(dir: string) {
  currentDir = dir
  rememberProject(dir)
  watchModel(dir, (code) => send('project:codeChanged', code))
  window?.setTitle(`${basename(dir)} - 3D Studio`)
  refreshMenu()
  return loadProject(dir)
}

function requireProject(): string {
  if (!currentDir) throw new Error('Open or create a project first.')
  return currentDir
}

function captureView(view: ViewName, result?: RenderResult): Promise<string | null> {
  if (!window) return Promise.resolve(null)
  const id = `${Date.now()}-${Math.random()}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCaptures.delete(id)
      resolve(null)
    }, 15000)
    pendingCaptures.set(id, (dataUrl) => {
      clearTimeout(timer)
      resolve(dataUrl)
    })
    send('capture:request', { id, view, parts: result?.parts })
  })
}

function defaultImportFolder(filePath: string): string {
  const base = join(dirname(filePath), `${basename(filePath, extname(filePath))} studio`)
  let candidate = base
  let suffix = 2
  while (existsSync(candidate)) candidate = `${base} ${suffix++}`
  return candidate
}

const MESH_EXTENSIONS = ['.stl', '.3mf']
const OPENABLE_EXTENSIONS = [...MESH_EXTENSIONS, '.svg', '.scad']
const extensionOf = (file: string): string => extname(file).toLowerCase()
const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

type OpenIntent = 'ask' | 'add' | 'new'

async function chooseModelFiles(title: string): Promise<string[] | null> {
  const choice = await dialog.showOpenDialog(window!, {
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '3D models and artwork (STL, 3MF, SVG, OpenSCAD)', extensions: ['stl', '3mf', 'svg', 'scad'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  return choice.canceled || !choice.filePaths.length ? null : choice.filePaths
}

function launchPaths(argv: string[]): string[] {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((value) => !value.startsWith('-') && existsSync(value))
    .filter((value) => (isFolder(value) ? isProject(value) : OPENABLE_EXTENSIONS.includes(extensionOf(value))))
}

async function confirmLeave(currentCode: string | null): Promise<boolean> {
  if (!currentDir || currentCode === null || currentCode === readCode(currentDir)) return true
  const answer = await dialog.showMessageBox(window!, {
    type: 'warning',
    buttons: ['Save and continue', 'Discard changes', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save your changes to ${basename(currentDir)} first?`
  })
  if (answer.response === 2) return false
  if (answer.response === 0) {
    writeCode(currentDir, currentCode)
    snapshot(currentDir, 'Saved before opening another file', 'save')
  }
  return true
}

function projectFromScad(file: string): ProjectState {
  const parent = dirname(file)
  if (basename(file).toLowerCase() === MODEL_FILE && isProject(parent)) return openProject(parent)
  const dir = defaultImportFolder(file)
  createProject(dir, readFileSync(file, 'utf8'))
  return openProject(dir)
}

const importLabel = (files: string[]): string => `Imported ${files.map((file) => basename(file)).join(', ')}`

const pendingConversions = new Map<string, (result: { artwork?: VectorArtwork; error?: string }) => void>()

function convertSvgFile(file: string): Promise<VectorArtwork> {
  if (!window) return Promise.reject(new Error('The window is not ready yet.'))
  const id = `${Date.now()}-${Math.random()}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingConversions.delete(id)
      reject(new Error(`Converting ${basename(file)} took too long.`))
    }, 60000)
    pendingConversions.set(id, (result) => {
      clearTimeout(timer)
      if (result.artwork) resolve(result.artwork)
      else reject(new Error(result.error ?? `Could not convert ${basename(file)}.`))
    })
    send('svg:convert', { id, text: readFileSync(file, 'utf8'), fileName: basename(file) })
  })
}

async function prepareFiles(files: string[], adding: boolean): Promise<(dir: string) => string> {
  const artworks = await Promise.all(files.filter((file) => extensionOf(file) === '.svg').map(convertSvgFile))
  const meshFiles = files.filter((file) => MESH_EXTENSIONS.includes(extensionOf(file)))
  return (dir) => {
    const meshes = meshFiles.flatMap((file) => importMeshFile(dir, file))
    const meshCode = !meshes.length ? '' : adding ? appendImportedMeshes('', meshes).trim() : codeForImportedMeshes(meshes)
    return [meshCode, ...artworks.map((artwork) => importArtwork(dir, artwork).code)].filter(Boolean).join('\n')
  }
}

async function projectFromFiles(files: string[]): Promise<ProjectState> {
  const build = await prepareFiles(files, false)
  const dir = defaultImportFolder(files[0])
  createProject(dir, '')
  try {
    writeCode(dir, build(dir))
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  snapshot(dir, importLabel(files), 'import')
  return openProject(dir)
}

async function addFilesToProject(dir: string, files: string[], currentCode: string | null): Promise<ProjectState> {
  const build = await prepareFiles(files, true)
  const existing = (currentCode ?? readCode(dir)).trimEnd()
  const added = build(dir)
  writeCode(dir, existing ? `${existing}\n\n${added}` : added)
  snapshot(dir, importLabel(files), 'import')
  return loadProject(dir)
}

async function openPaths(paths: string[], currentCode: string | null, intent: OpenIntent): Promise<ProjectState | null> {
  const folder = paths.find(isFolder)
  if (folder) {
    if (!isProject(folder)) throw new Error(`"${basename(folder)}" is not a 3D Studio project folder (it has no model.scad). Drop the model files themselves instead.`)
    if (folder === currentDir) return null
    return (await confirmLeave(currentCode)) ? openProject(folder) : null
  }
  const files = paths.filter((path) => OPENABLE_EXTENSIONS.includes(extensionOf(path)))
  if (!files.length) {
    const names = paths.map((path) => basename(path)).join(', ')
    throw new Error(`Can't open ${names}. 3D Studio opens STL, 3MF, SVG and OpenSCAD (.scad) files and project folders.`)
  }
  const scad = files.find((file) => extensionOf(file) === '.scad')
  if (scad) {
    if (currentDir && dirname(scad) === currentDir && basename(scad).toLowerCase() === MODEL_FILE) return null
    return (await confirmLeave(currentCode)) ? projectFromScad(scad) : null
  }
  if (!currentDir || intent === 'new') return projectFromFiles(files)
  if (intent === 'add') return addFilesToProject(currentDir, files, currentCode)
  const names = files.map((file) => basename(file)).join(', ')
  const answer = await dialog.showMessageBox(window!, {
    type: 'question',
    buttons: ['Open as a new project', `Add to "${basename(currentDir)}"`, 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: `Open ${names}`,
    detail: 'Open it on its own as a new project, or add it to the project that is open now.'
  })
  if (answer.response === 2) return null
  if (answer.response === 1) return addFilesToProject(currentDir, files, currentCode)
  return (await confirmLeave(currentCode)) ? projectFromFiles(files) : null
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_event, update) => {
    const saved = saveSettings(update)
    refreshMenu()
    return saved
  })

  ipcMain.handle('project:new', async () => {
    const choice = await dialog.showOpenDialog(window!, {
      title: 'Choose an empty folder for the new project',
      properties: ['openDirectory', 'createDirectory']
    })
    if (choice.canceled || !choice.filePaths[0]) return null
    const dir = choice.filePaths[0]
    if (!isProject(dir)) createProject(dir)
    return openProject(dir)
  })

  ipcMain.handle('project:open', async () => {
    const choice = await dialog.showOpenDialog(window!, {
      title: 'Open a project folder',
      properties: ['openDirectory']
    })
    if (choice.canceled || !choice.filePaths[0]) return null
    const dir = choice.filePaths[0]
    if (!isProject(dir)) {
      const answer = await dialog.showMessageBox(window!, {
        type: 'question',
        buttons: ['Create project here', 'Cancel'],
        message: 'This folder has no model.scad. Create a new project in it?'
      })
      if (answer.response !== 0) return null
      createProject(dir)
    }
    return openProject(dir)
  })

  ipcMain.handle('project:openPath', (_event, dir: string) => {
    if (!isProject(dir)) throw new Error(`No project found at ${dir}`)
    return openProject(dir)
  })

  ipcMain.handle('project:import', async (_event, currentCode: string | null) => {
    const files = await chooseModelFiles('Import a model')
    return files ? openPaths(files, currentCode, 'add') : null
  })

  ipcMain.handle('project:openFile', async (_event, currentCode: string | null) => {
    const files = await chooseModelFiles('Open a file')
    return files ? openPaths(files, currentCode, 'ask') : null
  })

  ipcMain.handle('project:openFiles', (_event, payload: { paths: string[]; currentCode: string | null }) =>
    openPaths(payload.paths, payload.currentCode, 'ask')
  )

  ipcMain.handle('project:quickCreate', (_event, name: string) => {
    const dir = uniqueProjectFolder(join(app.getPath('documents'), '3D Studio'), name)
    createProject(dir, '')
    return openProject(dir)
  })

  ipcMain.handle('project:undo', () => {
    const dir = requireProject()
    const target = undoTarget(dir)
    if (!target) return null
    const code = historyCode(dir, target.id)
    writeCode(dir, code)
    return { code, label: target.label, history: snapshot(dir, `Undo to: ${target.label}`, 'restore') }
  })

  ipcMain.handle('project:startup', () => {
    const paths = launchPaths(process.argv)
    return paths.length ? openPaths(paths, null, 'new') : null
  })

  ipcMain.handle('project:close', () => {
    currentDir = null
    window?.setTitle('3D Studio')
    refreshMenu()
  })

  ipcMain.handle('project:save', (_event, payload: { code: string; ops: Operation[]; part: string; label?: string }) => {
    const dir = requireProject()
    writeCode(dir, payload.code)
    saveMeta(dir, { ops: payload.ops, part: payload.part })
    return snapshot(dir, payload.label ?? 'Saved', payload.label?.startsWith('Baked') ? 'bake' : 'save')
  })

  ipcMain.handle('project:saveMeta', (_event, payload: { ops: Operation[]; part: string }) => {
    saveMeta(requireProject(), payload)
  })

  ipcMain.handle('project:history', () => listHistory(requireProject()))

  ipcMain.handle('project:restore', (_event, id: string) => {
    const dir = requireProject()
    const code = historyCode(dir, id)
    writeCode(dir, code)
    return { code, history: snapshot(dir, 'Restored an earlier version', 'restore') }
  })

  ipcMain.handle('project:reveal', () => {
    if (currentDir) shell.openPath(currentDir)
  })

  ipcMain.handle('render', (_event, payload: { code: string; ops: Operation[]; part: string }) =>
    renderModel({ dir: requireProject(), ...payload })
  )
  ipcMain.handle('render:objects', (_event, payload: { code: string; ops: Operation[]; part: string }) =>
    renderObjects({ dir: requireProject(), ...payload })
  )

  ipcMain.handle('export:mesh', async (_event, payload: { code: string; ops: Operation[]; part: string; format: 'stl' | '3mf' }) => {
    const dir = requireProject()
    const name = `${basename(dir)}${payload.part ? `-${payload.part}` : ''}`
    const choice = await dialog.showSaveDialog(window!, {
      title: `Export ${payload.format.toUpperCase()}`,
      defaultPath: join(dir, `${name}.${payload.format}`),
      filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }]
    })
    if (choice.canceled || !choice.filePath) return null
    const result = await renderModel({ dir, code: payload.code, ops: payload.ops, part: payload.part, outputName: 'export-mesh.stl', channel: `${dir}:export` })
    if (!result.ok || !result.stl) throw new Error(result.errors.map((error) => error.text).join('\n') || 'Render failed')
    if (payload.format === 'stl') writeFileSync(choice.filePath, result.stl)
    else {
      const parts = result.parts ?? [{ color: '', stl: result.stl }]
      const meshes = parts.map((part) => ({ name: part.color ? safeName(`${name}-${part.color}`) : name, triangles: readStl(part.stl) }))
      writeFileSync(choice.filePath, write3mf(meshes, name))
    }
    return choice.filePath
  })

  ipcMain.handle('slicer:presets', (_event, target: SlicerApp) => listSlicerPresets(target))

  ipcMain.handle('slicer:chooseOutput', async (_event, defaultName: string) => {
    const dir = requireProject()
    const choice = await dialog.showSaveDialog(window!, {
      title: 'Save slicer project',
      defaultPath: join(dir, `${defaultName}.3mf`),
      filters: [{ name: '3MF project', extensions: ['3mf'] }]
    })
    return choice.canceled ? null : choice.filePath
  })

  ipcMain.handle('slicer:export', async (_event, payload: { request: SlicerExportRequest; code: string; ops: Operation[] }) => {
    const dir = requireProject()
    const meshes = []
    for (const [index, object] of payload.request.objects.entries()) {
      const result = await renderModel({
        dir,
        code: payload.code,
        ops: payload.ops,
        part: object.part,
        outputName: `export-${index}.stl`,
        channel: `${dir}:export`
      })
      if (!result.ok || !result.stl) {
        throw new Error(`"${object.name}" did not render: ${result.errors.map((error) => error.text).join('; ')}`)
      }
      meshes.push({ name: object.name, filament: object.filament, copies: object.copies, triangles: readStl(result.stl) })
    }
    const summary = buildSlicerProject(payload.request, meshes)
    return `${payload.request.outputPath}: ${summary}`
  })

  ipcMain.handle('slicer:open', (_event, path: string) => shell.openPath(path))

  ipcMain.handle('ai:models', (_event, force: boolean) => listOpenRouterModels(force))
  ipcMain.handle('ai:agentModels', (_event, agent: CliAgent) => listAgentModels(agent))
  ipcMain.handle('ai:messages', () => (currentDir ? chatMessages(currentDir) : []))
  ipcMain.handle('ai:clear', () => {
    if (currentDir) clearChat(currentDir)
  })
  ipcMain.handle('ai:stop', () => stopChat())
  ipcMain.handle('ai:send', (_event, payload: { prompt: string; ops: Operation[]; part: string; code: string; attachments?: ChatAttachments }) => {
    const dir = requireProject()
    if (payload.code !== readCode(dir)) {
      writeCode(dir, payload.code)
      snapshot(dir, 'Saved before AI change', 'save')
    }
    sendChat(
      {
        emit: (event) => send('ai:event', event),
        codeChanged: (code) => send('project:codeChanged', code),
        captureView
      },
      { dir, prompt: payload.prompt, ops: payload.ops, part: payload.part, attachments: payload.attachments ?? { images: [], pins: [] } }
    ).catch((error) => send('ai:event', { type: 'message', message: { id: `${Date.now()}`, role: 'error', text: error.message, createdAt: Date.now() } }))
  })

  ipcMain.on('svg:converted', (_event, payload: { id: string; artwork?: VectorArtwork; error?: string }) => {
    pendingConversions.get(payload.id)?.(payload)
    pendingConversions.delete(payload.id)
  })

  ipcMain.on('capture:response', (_event, payload: { id: string; dataUrl: string | null }) => {
    pendingCaptures.get(payload.id)?.(payload.dataUrl)
    pendingCaptures.delete(payload.id)
  })

  ipcMain.handle('mesh:stats', (_event, stl: Uint8Array) => analyseMesh(readStl(stl)))
}

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', (_event, argv) => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
  const paths = launchPaths(argv)
  if (paths.length) send('project:openRequest', paths)
})

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
