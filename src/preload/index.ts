import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { StudioApi } from './api'

const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StudioApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (update) => ipcRenderer.invoke('settings:set', update)
  },
  project: {
    create: () => ipcRenderer.invoke('project:new'),
    open: () => ipcRenderer.invoke('project:open'),
    openPath: (dir) => ipcRenderer.invoke('project:openPath', dir),
    startup: () => ipcRenderer.invoke('project:startup'),
    quickCreate: (name) => ipcRenderer.invoke('project:quickCreate', name),
    undo: () => ipcRenderer.invoke('project:undo'),
    importModels: (currentCode) => ipcRenderer.invoke('project:import', currentCode),
    openFile: (currentCode) => ipcRenderer.invoke('project:openFile', currentCode),
    openFiles: (payload) => ipcRenderer.invoke('project:openFiles', payload),
    pathForFile: (file) => webUtils.getPathForFile(file),
    onOpenRequest: (callback) => subscribe('project:openRequest', callback),
    onConvertSvg: (callback) => subscribe('svg:convert', callback),
    convertedSvg: (payload) => ipcRenderer.send('svg:converted', payload),
    close: () => ipcRenderer.invoke('project:close'),
    save: (payload) => ipcRenderer.invoke('project:save', payload),
    saveMeta: (payload) => ipcRenderer.invoke('project:saveMeta', payload),
    history: () => ipcRenderer.invoke('project:history'),
    restore: (id) => ipcRenderer.invoke('project:restore', id),
    reveal: () => ipcRenderer.invoke('project:reveal'),
    onCodeChanged: (callback) => subscribe('project:codeChanged', callback)
  },
  render: (payload) => ipcRenderer.invoke('render', payload),
  renderObjects: (payload) => ipcRenderer.invoke('render:objects', payload),
  exportMesh: (payload) => ipcRenderer.invoke('export:mesh', payload),
  slicer: {
    presets: (app) => ipcRenderer.invoke('slicer:presets', app),
    chooseOutput: (defaultName) => ipcRenderer.invoke('slicer:chooseOutput', defaultName),
    exportProject: (payload) => ipcRenderer.invoke('slicer:export', payload),
    open: (path) => ipcRenderer.invoke('slicer:open', path)
  },
  ai: {
    models: (force) => ipcRenderer.invoke('ai:models', force),
    agentModels: (agent) => ipcRenderer.invoke('ai:agentModels', agent),
    messages: () => ipcRenderer.invoke('ai:messages'),
    clear: () => ipcRenderer.invoke('ai:clear'),
    stop: () => ipcRenderer.invoke('ai:stop'),
    send: (payload) => ipcRenderer.invoke('ai:send', payload),
    onEvent: (callback) => subscribe('ai:event', callback)
  },
  menu: {
    onCommand: (callback) => subscribe('menu:command', callback)
  },
  capture: {
    onRequest: (callback) => subscribe('capture:request', callback),
    respond: (id, dataUrl) => ipcRenderer.send('capture:response', { id, dataUrl })
  }
}

contextBridge.exposeInMainWorld('studio', api)
