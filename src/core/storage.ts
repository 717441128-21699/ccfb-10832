// 本地持久化：IndexedDB。地址库、导入版本、规则全部只存在浏览器本机，无任何网络请求
import type { AddressLibrary } from './types'
import type { SlotRule } from './rules'

const DB_NAME = 'address-sorter-db'
const DB_VERSION = 1
const STORE_LIB = 'libraries'
const STORE_RULES = 'rules'
const KEY_LATEST = 'latest'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_LIB)) db.createObjectStore(STORE_LIB)
      if (!db.objectStoreNames.contains(STORE_RULES)) db.createObjectStore(STORE_RULES)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function saveLibrary(lib: AddressLibrary): Promise<void> {
  await tx(STORE_LIB, 'readwrite', (s) => s.put(lib, KEY_LATEST))
}

export async function loadLibrary(): Promise<AddressLibrary | null> {
  const v = await tx<AddressLibrary | undefined>(STORE_LIB, 'readonly', (s) => s.get(KEY_LATEST))
  return v ?? null
}

export async function saveRules(rules: SlotRule[]): Promise<void> {
  await tx(STORE_RULES, 'readwrite', (s) => s.put(rules, KEY_LATEST))
}

export async function loadRules(): Promise<SlotRule[] | null> {
  const v = await tx<SlotRule[] | undefined>(STORE_RULES, 'readonly', (s) => s.get(KEY_LATEST))
  return v ?? null
}
