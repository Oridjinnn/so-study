// SSR-safe draft persistence for essay answers.
//
// Prefers IndexedDB (database `so-study-drafts`, key `draft:<id>`) in browsers
// that support it, and automatically falls back to `window.localStorage` with
// the same key when IndexedDB is unavailable (e.g. jsdom in tests) or throws.
// This guarantees drafts never silently disappear ("never lose work").

const DB_NAME = "so-study-drafts";
const STORE_NAME = "drafts";

function key(id: string): string {
  return `draft:${id}`;
}

function hasIndexedDB(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof window !== "undefined" &&
    // jsdom may define indexedDB as undefined; guard the contract too.
    indexedDB !== undefined
  );
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then((db) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
}

export async function loadDraft(id: string): Promise<string> {
  if (hasIndexedDB()) {
    try {
      const store = await withStore("readonly");
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const req = store.get(key(id));
        req.onsuccess = () => resolve(req.result as string | undefined);
        req.onerror = () => reject(req.error);
      });
      if (value !== undefined) return value;
    } catch {
      // fall through to localStorage
    }
  }
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem(key(id)) ?? "";
  }
  return "";
}

export async function saveDraft(id: string, text: string): Promise<void> {
  if (hasIndexedDB()) {
    try {
      const store = await withStore("readwrite");
      await new Promise<void>((resolve, reject) => {
        const req = store.put(text, key(id));
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      return;
    } catch {
      // fall through to localStorage
    }
  }
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(key(id), text);
  }
}

export async function clearDraft(id: string): Promise<void> {
  if (hasIndexedDB()) {
    try {
      const store = await withStore("readwrite");
      await new Promise<void>((resolve, reject) => {
        const req = store.delete(key(id));
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      return;
    } catch {
      // fall through to localStorage
    }
  }
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(key(id));
  }
}
