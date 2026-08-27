import { app, ipcMain, shell } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SOLLIN_HOME = path.join(os.homedir(), '.sollin')
const STORE_DIR_NAME = 'store'
const FONTS_DIR_NAME = 'fonts'
const META_FILE = 'meta.json'
const DOC_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

type AppDataMeta = {
  version: number
  dataRoot: string
  migratedFromUserDataAt?: string
  rendererMigratedV1?: boolean
}

type PendingWrite = {
  value: unknown
  timer: ReturnType<typeof setTimeout> | null
}

const WRITE_DEBOUNCE_MS = 200

let initialized = false
let oldUserDataPath: string | null = null
const memoryCache = new Map<string, unknown>()
const pendingWrites = new Map<string, PendingWrite>()
const stores = new Map<string, Store<{ data?: unknown }>>()

const isValidDocName = (name: unknown): name is string => (
  typeof name === 'string' && DOC_NAME_PATTERN.test(name)
)

export function getSollinHome(): string {
  return SOLLIN_HOME
}

export function getStoreDir(): string {
  return path.join(SOLLIN_HOME, STORE_DIR_NAME)
}

export function getFontsDir(): string {
  return path.join(SOLLIN_HOME, FONTS_DIR_NAME)
}

function getMetaPath(): string {
  return path.join(SOLLIN_HOME, META_FILE)
}

function getDocPath(name: string): string {
  return path.join(getStoreDir(), `${name}.json`)
}

/**
 * Every logical document is backed by electron-store.  Keeping one store per
 * document preserves the existing file layout (`store/<name>.json`) while
 * giving us electron-store's atomic writes, corruption recovery and typed API.
 */
function getElectronStore(name: string): Store<{ data?: unknown }> {
  let store = stores.get(name)
  if (!store) {
    store = new Store<{ data?: unknown }>({
      name,
      cwd: getStoreDir(),
      fileExtension: 'json',
      clearInvalidConfig: false,
    })
    stores.set(name, store)
  }
  return store
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8').trim()
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch (error) {
    console.error('[appDataStore] read failed:', filePath, error)
    return null
  }
}

function atomicWriteJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath))
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const payload = `${JSON.stringify(value, null, 2)}\n`
  try {
    fs.writeFileSync(tmpPath, payload, 'utf8')
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore cleanup failure
    }
    console.error('[appDataStore] atomic write failed:', filePath, error)
    throw error
  }
}

function copyPathRecursive(source: string, target: string) {
  const stat = fs.statSync(source)
  if (stat.isDirectory()) {
    ensureDir(target)
    for (const entry of fs.readdirSync(source)) {
      // Skip Chromium cache-like dirs that are regenerated; still copy Local Storage
      // so one-time renderer migration can read old keys if needed.
      if (entry === 'Cache' || entry === 'Code Cache' || entry === 'GPUCache') continue
      copyPathRecursive(path.join(source, entry), path.join(target, entry))
    }
    return
  }
  ensureDir(path.dirname(target))
  if (!fs.existsSync(target)) {
    fs.copyFileSync(source, target)
  }
}

function readMeta(): AppDataMeta {
  const fallback: AppDataMeta = {
    version: 1,
    dataRoot: SOLLIN_HOME,
  }
  const raw = readJsonFile<Partial<AppDataMeta>>(getMetaPath())
  if (!raw || typeof raw !== 'object') return fallback
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    dataRoot: typeof raw.dataRoot === 'string' ? raw.dataRoot : SOLLIN_HOME,
    migratedFromUserDataAt: typeof raw.migratedFromUserDataAt === 'string' ? raw.migratedFromUserDataAt : undefined,
    rendererMigratedV1: raw.rendererMigratedV1 === true,
  }
}

function writeMeta(meta: AppDataMeta) {
  atomicWriteJson(getMetaPath(), meta)
}

/**
 * Must run before any app.getPath('userData') consumers.
 * Redirects Electron's userData (and Chromium profile) to ~/.sollin.
 */
export function initializeSollinDataRoot(): string {
  if (initialized) return SOLLIN_HOME

  try {
    oldUserDataPath = app.getPath('userData')
  } catch {
    oldUserDataPath = null
  }

  try {
    app.setPath('userData', SOLLIN_HOME)
  } catch (error) {
    console.error('[appDataStore] app.setPath(userData) failed:', error)
  }

  ensureDir(SOLLIN_HOME)
  ensureDir(getStoreDir())
  ensureDir(getFontsDir())

  migrateLegacyUserDataIfNeeded()
  initialized = true
  console.log('[appDataStore] data root:', SOLLIN_HOME)
  return SOLLIN_HOME
}

function migrateLegacyUserDataIfNeeded() {
  const meta = readMeta()
  if (meta.migratedFromUserDataAt) return

  const candidates = [
    oldUserDataPath,
    path.join(app.getPath('appData'), 'Sollin'),
    path.join(app.getPath('appData'), 'sollin'),
  ].filter((value, index, list): value is string => {
    if (!value) return false
    if (path.resolve(value) === path.resolve(SOLLIN_HOME)) return false
    return list.indexOf(value) === index
  })

  let migratedFrom: string | null = null
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const entries = fs.readdirSync(candidate)
      if (!entries.length) continue
      console.log('[appDataStore] migrating legacy userData from:', candidate)
      copyPathRecursive(candidate, SOLLIN_HOME)
      migratedFrom = candidate
      break
    } catch (error) {
      console.error('[appDataStore] legacy migration failed for', candidate, error)
    }
  }

  ensureDir(getStoreDir())
  ensureDir(getFontsDir())

  writeMeta({
    ...meta,
    version: 1,
    dataRoot: SOLLIN_HOME,
    migratedFromUserDataAt: new Date().toISOString(),
  })

  if (migratedFrom) {
    console.log('[appDataStore] legacy userData migration complete from', migratedFrom)
  }
}

export function readDoc(name: string): unknown | null {
  if (!isValidDocName(name)) {
    console.error('[appDataStore] invalid doc name on read:', name)
    return null
  }

  if (memoryCache.has(name)) {
    return memoryCache.get(name) ?? null
  }

  const pending = pendingWrites.get(name)
  if (pending) {
    return pending.value
  }

  let value: unknown = null
  try {
    const rawStore = getElectronStore(name).store
    value = Object.prototype.hasOwnProperty.call(rawStore, 'data') ? rawStore.data : rawStore
  } catch (error) {
    console.error('[appDataStore] electron-store read failed:', name, error)
    // Keep compatibility with a partially written/legacy document.
    value = readJsonFile<unknown>(getDocPath(name))
  }
  if (value !== null) {
    memoryCache.set(name, value)
  }
  return value
}

function writeDocImmediate(name: string, value: unknown) {
  memoryCache.set(name, value)
  getElectronStore(name).set('data', value)
}

export function writeDoc(name: string, value: unknown, options?: { immediate?: boolean }) {
  if (!isValidDocName(name)) {
    console.error('[appDataStore] invalid doc name on write:', name)
    throw new Error(`Invalid store document name: ${String(name)}`)
  }

  memoryCache.set(name, value)

  if (options?.immediate) {
    const existing = pendingWrites.get(name)
    if (existing?.timer) clearTimeout(existing.timer)
    pendingWrites.delete(name)
    writeDocImmediate(name, value)
    return
  }

  const existing = pendingWrites.get(name)
  if (existing?.timer) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    const pending = pendingWrites.get(name)
    pendingWrites.delete(name)
    if (!pending) return
    try {
      writeDocImmediate(name, pending.value)
    } catch {
      // already logged in atomicWriteJson
    }
  }, WRITE_DEBOUNCE_MS)

  pendingWrites.set(name, { value, timer })
}

export function removeDoc(name: string) {
  if (!isValidDocName(name)) return
  const existing = pendingWrites.get(name)
  if (existing?.timer) clearTimeout(existing.timer)
  pendingWrites.delete(name)
  memoryCache.delete(name)
  const filePath = getDocPath(name)
  try {
    stores.get(name)?.clear()
    stores.delete(name)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (error) {
    console.error('[appDataStore] remove failed:', filePath, error)
  }
}

export function readManyDocs(names: string[]): Record<string, unknown | null> {
  const result: Record<string, unknown | null> = {}
  for (const name of names) {
    if (!isValidDocName(name)) {
      result[String(name)] = null
      continue
    }
    result[name] = readDoc(name)
  }
  return result
}

export function flushPendingWrites() {
  const entries = Array.from(pendingWrites.entries())
  for (const [name, pending] of entries) {
    if (pending.timer) clearTimeout(pending.timer)
    pendingWrites.delete(name)
    try {
      writeDocImmediate(name, pending.value)
    } catch {
      // already logged
    }
  }
}

export function openDataDirectory(): string {
  ensureDir(SOLLIN_HOME)
  void shell.openPath(SOLLIN_HOME)
  return SOLLIN_HOME
}

export function setupAppDataStoreIpc() {
  initializeSollinDataRoot()

  ipcMain.handle('store:get', (_event, name: unknown) => {
    if (!isValidDocName(name)) return null
    return readDoc(name)
  })
  ipcMain.on('store:get-sync', (event, name: unknown) => {
    event.returnValue = isValidDocName(name) ? readDoc(name) : null
  })

  ipcMain.handle('store:set', (_event, name: unknown, value: unknown) => {
    if (!isValidDocName(name)) {
      return { ok: false, error: 'invalid name' }
    }
    try {
      writeDoc(name, value)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  ipcMain.on('store:set-sync', (event, name: unknown, value: unknown) => {
    if (!isValidDocName(name)) { event.returnValue = { ok: false, error: 'invalid name' }; return }
    try { writeDoc(name, value, { immediate: true }); event.returnValue = { ok: true } }
    catch (error) { event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) } }
  })

  ipcMain.handle('store:remove', (_event, name: unknown) => {
    if (!isValidDocName(name)) {
      return { ok: false, error: 'invalid name' }
    }
    removeDoc(name)
    return { ok: true }
  })
  ipcMain.on('store:remove-sync', (event, name: unknown) => {
    if (!isValidDocName(name)) { event.returnValue = { ok: false, error: 'invalid name' }; return }
    removeDoc(name); event.returnValue = { ok: true }
  })

  ipcMain.handle('store:getMany', (_event, names: unknown) => {
    if (!Array.isArray(names)) return {}
    return readManyDocs(names.filter((item): item is string => typeof item === 'string'))
  })

  ipcMain.handle('store:flush', () => {
    flushPendingWrites()
    return { ok: true }
  })

  ipcMain.handle('store:getRootPath', () => getSollinHome())

  ipcMain.handle('store:openRootPath', () => openDataDirectory())
}
