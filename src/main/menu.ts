import { BrowserWindow, Menu, MenuItemConstructorOptions, app, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { basename } from 'path'
import type { MenuCommand, SlicerApp, ViewName } from '@shared/types'
import { SLICER_APP_LABEL } from '@shared/types'
import { loadSettings } from './settings'

const VIEWS: { view: ViewName; label: string; accelerator: string }[] = [
  { view: 'iso', label: '3D View', accelerator: 'Alt+0' },
  { view: 'top', label: 'Top', accelerator: 'Alt+1' },
  { view: 'front', label: 'Front', accelerator: 'Alt+2' },
  { view: 'right', label: 'Right', accelerator: 'Alt+3' },
  { view: 'back', label: 'Back', accelerator: 'Alt+4' },
  { view: 'left', label: 'Left', accelerator: 'Alt+5' },
  { view: 'bottom', label: 'Bottom', accelerator: 'Alt+6' }
]

export function buildAppMenu(window: BrowserWindow, projectDir: string | null): void {
  const send = (command: MenuCommand): void => window.webContents.send('menu:command', command)
  const settings = loadSettings()
  const projectOpen = Boolean(projectDir)
  const recent = settings.recentProjects.filter((dir) => existsSync(dir))
  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? [
        ...recent.map((dir, index) => ({
          label: `${index < 9 ? `&${index + 1} ` : ''}${basename(dir).replace(/&/g, '&&')}`,
          sublabel: dir,
          toolTip: dir,
          enabled: dir !== projectDir,
          click: () => send({ type: 'openRecent', dir })
        })),
        { type: 'separator' },
        { label: 'Clear Recent Projects', click: () => send({ type: 'clearRecent' }) }
      ]
    : [{ label: 'No recent projects', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: '&New Project...', accelerator: 'CmdOrCtrl+N', click: () => send({ type: 'newProject' }) },
        { label: '&Open File (STL / 3MF / SVG / SCAD)...', accelerator: 'CmdOrCtrl+O', click: () => send({ type: 'openFile' }) },
        { label: 'Open &Project Folder...', accelerator: 'CmdOrCtrl+Shift+O', click: () => send({ type: 'openProject' }) },
        { label: 'Open &Recent', submenu: recentItems },
        { type: 'separator' },
        { label: '&Import STL / 3MF / SVG / SCAD...', accelerator: 'CmdOrCtrl+I', click: () => send({ type: 'importModels' }) },
        { type: 'separator' },
        { label: '&Save', accelerator: 'CmdOrCtrl+S', enabled: projectOpen, click: () => send({ type: 'save' }) },
        {
          label: '&Export',
          enabled: projectOpen,
          submenu: [
            ...(['bambu', 'snapmaker', 'orca'] as SlicerApp[]).map((app) => ({
              label: `${SLICER_APP_LABEL[app]} Project...`,
              click: () => send({ type: 'slicer', app })
            })),
            { label: 'STL File (any printer)...', accelerator: 'CmdOrCtrl+E', click: () => send({ type: 'export', format: 'stl' }) },
            { label: '3MF File (any printer, keeps colours)...', accelerator: 'CmdOrCtrl+Shift+E', click: () => send({ type: 'export', format: '3mf' }) }
          ]
        },
        { type: 'separator' },
        { label: 'Show Project &Folder', enabled: projectOpen, click: () => projectDir && shell.openPath(projectDir) },
        { label: '&Close Project', accelerator: 'CmdOrCtrl+W', enabled: projectOpen, click: () => send({ type: 'closeProject' }) },
        { type: 'separator' },
        { label: 'Printer and &Build Plate...', click: () => send({ type: 'settings' }) },
        { label: 'Se&ttings...', accelerator: 'CmdOrCtrl+,', click: () => send({ type: 'settings' }) },
        { type: 'separator' },
        { label: 'E&xit', role: 'quit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { label: '&Undo Last Change', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, enabled: projectOpen, click: () => send({ type: 'undo' }) },
        { type: 'separator' },
        { role: 'cut', registerAccelerator: false },
        { role: 'copy', registerAccelerator: false },
        { role: 'paste', registerAccelerator: false },
        { role: 'selectAll', registerAccelerator: false }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: '&Render', accelerator: 'F5', enabled: projectOpen, click: () => send({ type: 'render' }) },
        { type: 'separator' },
        ...VIEWS.map(({ view, label, accelerator }) => ({ label, accelerator, enabled: projectOpen, click: () => send({ type: 'view', view }) })),
        { type: 'separator' },
        { label: '&Simple Mode', type: 'radio', checked: settings.uiMode === 'simple', click: () => send({ type: 'uiMode', mode: 'simple' }) },
        { label: '&Expert Mode', type: 'radio', checked: settings.uiMode === 'expert', click: () => send({ type: 'uiMode', mode: 'expert' }) },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'OpenSCAD Cheat Sheet', click: () => shell.openExternal('https://openscad.org/cheatsheet/') },
        { label: 'OpenSCAD Manual', click: () => shell.openExternal('https://en.wikibooks.org/wiki/OpenSCAD_User_Manual') },
        { type: 'separator' },
        {
          label: 'About 3D Studio',
          click: () =>
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'About 3D Studio',
              message: `3D Studio ${app.getVersion()}`,
              detail: 'Create and edit 3D-printable models by hand or through AI chat, with live preview.'
            })
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
