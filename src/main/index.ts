import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { ChatAttachments, Operation, RenderResult, SlicerExportRequest, ViewName } from '@shared/types'
import { analyseMesh, readStl, write3mf } from './mesh'
import { renderModel } from './openscad'
import { buildSlicerProject, listSlicerPresets } from './orca'
import {
  appendImportedMeshes,
  codeForImportedMeshes,
  createProject,
  historyCode,
  importMeshFile,
  isProject,
  listHistory,
  loadProject,
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
  Menu.setApplicationMenu(null)
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

const send = (channel: string, payload?: unknown): void => {
  window?.webContents.send(channel, payload)
}

function openProject(dir: string) {
  currentDir = dir
  rememberProject(dir)
  watchModel(dir, (code) => send('project:codeChanged', code))
  window?.setTitle(`${basename(dir)} - 3D Studio`)
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
    send('capture:request', { id, view, stl: result?.stl })
  })
}

function defaultImportFolder(filePath: string): string {
  const base = join(dirname(filePath), `${basename(filePath, extname(filePath))} studio`)
  let candidate = base
  let suffix = 2
  while (existsSync(candidate)) candidate = `${base} ${suffix++}`
  return candidate
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_event, update) => saveSettings(update))

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
    const choice = await dialog.showOpenDialog(window!, {
      title: 'Import a model',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '3D models', extensions: ['stl', '3mf', 'scad'] }]
    })
    if (choice.canceled || !choice.filePaths.length) return null
    const files = choice.filePaths
    const scad = files.find((file) => extname(file).toLowerCase() === '.scad')
    if (scad) {
      const dir = defaultImportFolder(scad)
      createProject(dir, readFileSync(scad, 'utf8'))
      return openProject(dir)
    }
    const meshFiles = files.filter((file) => ['.stl', '.3mf'].includes(extname(file).toLowerCase()))
    if (!meshFiles.length) return null
    if (!currentDir) {
      const dir = defaultImportFolder(meshFiles[0])
      createProject(dir, '')
      const meshes = meshFiles.flatMap((file) => importMeshFile(dir, file))
      writeCode(dir, codeForImportedMeshes(meshes))
      snapshot(dir, `Imported ${meshFiles.map((file) => basename(file)).join(', ')}`, 'import')
      return openProject(dir)
    }
    const dir = currentDir
    const meshes = meshFiles.flatMap((file) => importMeshFile(dir, file))
    const code = appendImportedMeshes(currentCode ?? readCode(dir), meshes)
    writeCode(dir, code)
    snapshot(dir, `Imported ${meshFiles.map((file) => basename(file)).join(', ')}`, 'import')
    return loadProject(dir)
  })

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
    const argument = process.argv.slice(1).find((value) => !value.startsWith('-') && existsSync(value) && isProject(value))
    if (!argument) return null
    return openProject(argument)
  })

  ipcMain.handle('project:close', () => {
    currentDir = null
    window?.setTitle('3D Studio')
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
    else writeFileSync(choice.filePath, write3mf([{ name, triangles: readStl(result.stl) }], name))
    return choice.filePath
  })

  ipcMain.handle('slicer:presets', () => listSlicerPresets())

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

  ipcMain.on('capture:response', (_event, payload: { id: string; dataUrl: string | null }) => {
    pendingCaptures.get(payload.id)?.(payload.dataUrl)
    pendingCaptures.delete(payload.id)
  })

  ipcMain.handle('mesh:stats', (_event, stl: Uint8Array) => analyseMesh(readStl(stl)))
}

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
