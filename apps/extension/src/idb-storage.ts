import type { SessionStorage } from './sessions';

const DEFAULT_DB_NAME = 'capture-kit-sessions';
const DEFAULT_STORE_NAME = 'kv';

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Create a SessionStorage adapter backed by IndexedDB, with optional read-through
 * fallback to legacy chrome.storage.local so previously persisted captures still load.
 */
export function createIndexedDbStorage(
  dbName = DEFAULT_DB_NAME,
  storeName = DEFAULT_STORE_NAME,
  legacyStorage?: SessionStorage,
  idbFactory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined
): SessionStorage {
  if (!idbFactory) {
    if (legacyStorage) return legacyStorage;
    const mem = new Map<string, unknown>();
    return {
      async get(keys) {
        if (keys === null) return Object.fromEntries(mem.entries());
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (mem.has(k)) out[k] = mem.get(k);
        return out;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) mem.set(k, v);
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) mem.delete(k);
      },
    };
  }

  let dbPromise: Promise<IDBDatabase> | null = null;
  const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idbFactory.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('Failed to open IndexedDB'));
      };
    });
    return dbPromise;
  };

  return {
    async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const out: Record<string, unknown> = {};

      if (keys === null) {
        const allKeys = await reqToPromise(store.getAllKeys());
        const allVals = await reqToPromise(store.getAll());
        for (let i = 0; i < allKeys.length; i++) {
          out[String(allKeys[i])] = allVals[i];
        }
        await txDone(tx);
        return out;
      }

      const keyList = Array.isArray(keys) ? keys : [keys];
      const missing: string[] = [];
      const values = await Promise.all(keyList.map((k) => reqToPromise(store.get(k))));
      await txDone(tx);

      for (let i = 0; i < keyList.length; i++) {
        if (values[i] !== undefined) out[keyList[i]] = values[i];
        else missing.push(keyList[i]);
      }

      if (missing.length > 0 && legacyStorage) {
        const legacyData = await legacyStorage.get(missing);
        for (const [k, v] of Object.entries(legacyData)) {
          if (v !== undefined) out[k] = v;
        }
      }
      return out;
    },

    async set(items: Record<string, unknown>): Promise<void> {
      const entries = Object.entries(items);
      if (!entries.length) return;
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const [k, v] of entries) {
        store.put(v, k);
      }
      await txDone(tx);
    },

    async remove(keys: string | string[]): Promise<void> {
      const keyList = Array.isArray(keys) ? keys : [keys];
      if (!keyList.length) return;
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const k of keyList) {
        store.delete(k);
      }
      await txDone(tx);
      if (legacyStorage) {
        await legacyStorage.remove(keyList).catch(() => undefined);
      }
    },
  };
}

export function createExtensionSessionStorage(): SessionStorage {
  const legacy = typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : undefined;
  return createIndexedDbStorage(DEFAULT_DB_NAME, DEFAULT_STORE_NAME, legacy);
}
