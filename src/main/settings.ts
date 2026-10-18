import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { CliAgent, Settings } from '@shared/types'

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

const AGENT_CANDIDATES: Record<CliAgent, string[]> = {
  codex: [
    join(homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    join(homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd'),
    join(homedir(), '.local', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex'
  ],
  grok: [join(homedir(), '.grok', 'bin', 'grok.exe'), join(homedir(), '.grok', 'bin', 'grok'), '/usr/local/bin/grok', '/opt/homebrew/bin/grok'],
  agy: [join(homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'), join(homedir(), '.local', 'bin', 'agy'), '/usr/local/bin/agy', '/opt/homebrew/bin/agy']
}

export function detectAgent(agent: CliAgent): string {
  return AGENT_CANDIDATES[agent].find((candidate) => existsSync(candidate)) ?? agent
}

const DEFAULTS: Settings = {
  openscadPath: '',
  claudePath: '',
  claudeModel: '',
  claudeEffort: '',
  claudeAllowBash: false,
  codexPath: '',
  codexModel: '',
  grokPath: '',
  grokModel: '',
  agyPath: '',
  agyModel: '',
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
  bedZ: 270,
  printerName: '',
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
  if (!settings.codexPath) settings.codexPath = detectAgent('codex')
  if (!settings.grokPath) settings.grokPath = detectAgent('grok')
  if (!settings.agyPath) settings.agyPath = detectAgent('agy')
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
