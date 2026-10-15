import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Settings } from '@shared/types'

const OPENSCAD_CANDIDATES = [
  'C:\\Program Files\\OpenSCAD (Nightly)\\openscad.com',
  'C:\\Program Files\\OpenSCAD\\openscad.com',
  'C:\\Program Files (x86)\\OpenSCAD\\openscad.com',
  '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',
  '/usr/bin/openscad',
  '/usr/local/bin/openscad',
  '/snap/bin/openscad'
]

export function detectOpenscad(): string {
  return OPENSCAD_CANDIDATES.find((candidate) => existsSync(candidate)) ?? 'openscad'
}

export function detectClaude(): string {
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude.exe'),
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude'
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? 'claude'
}

const DEFAULTS: Settings = {
  openscadPath: '',
  claudePath: '',
  claudeModel: '',
  claudeAllowBash: false,
  openrouterApiKey: '',
  openrouterModel: 'anthropic/claude-sonnet-5.5',
  aiProvider: 'auto' as Settings['aiProvider'],
  autoRender: true,
  autoFixRenderErrors: true,
  attachViewToAi: true,
  aiInstructions: '',
  uiMode: 'simple',
  bedX: 270,
  bedY: 270,
  recentProjects: []
}

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

let cached: Settings | null = null

export function loadSettings(): Settings {
  if (cached) return cached
  let stored: Partial<Settings> & { openrouterApiKeyEncrypted?: string } = {}
  try {
    stored = JSON.parse(readFileSync(settingsFile(), 'utf8'))
  } catch {
    stored = {}
  }
  const settings: Settings = { ...DEFAULTS, ...stored }
  if (stored.openrouterApiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      settings.openrouterApiKey = safeStorage.decryptString(Buffer.from(stored.openrouterApiKeyEncrypted, 'base64'))
    } catch {
      settings.openrouterApiKey = ''
    }
  }
  if (!settings.openscadPath) settings.openscadPath = detectOpenscad()
  if (!settings.claudePath) settings.claudePath = detectClaude()
  if ((settings.aiProvider as string) === 'auto') {
    settings.aiProvider = !settings.openrouterApiKey && existsSync(settings.claudePath) ? 'claude-code' : 'openrouter'
  }
  delete (settings as Partial<typeof stored>).openrouterApiKeyEncrypted
  cached = settings
  return settings
}

export function saveSettings(update: Partial<Settings>): Settings {
  const settings: Settings = { ...loadSettings(), ...update }
  cached = settings
  const { openrouterApiKey, ...rest } = settings
  const toStore: Record<string, unknown> = { ...rest }
  if (openrouterApiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      toStore.openrouterApiKeyEncrypted = safeStorage.encryptString(openrouterApiKey).toString('base64')
    } else {
      toStore.openrouterApiKey = openrouterApiKey
    }
  }
  writeFileSync(settingsFile(), JSON.stringify(toStore, null, 2))
  return settings
}

export function rememberProject(dir: string): void {
  const recent = [dir, ...loadSettings().recentProjects.filter((item) => item !== dir)].slice(0, 10)
  saveSettings({ recentProjects: recent })
}
