// Persistence in the browser (IndexedDB): transcript sessions and the user's
// sign dictionary. Nothing leaves the device. If IndexedDB is unavailable
// (some private modes) everything still works for the current visit.

const DB_NAME = "shuwa";
const DB_VERSION = 1;
let dbPromise = null;
const memory = { sessions: new Map(), templates: new Map() };

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sessions"))
          db.createObjectStore("sessions", { keyPath: "id" });
        if (!db.objectStoreNames.contains("templates"))
          db.createObjectStore("templates", { keyPath: "label" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, memory[store]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let result;
    const r = fn(os, null);
    if (r && "onsuccess" in r) r.onsuccess = () => (result = r.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
  });
}

const put = (store, value) =>
  run(store, "readwrite", (os, mem) =>
    os ? os.put(value) : mem.set(value.id ?? value.label, value),
  );
const del = (store, key) =>
  run(store, "readwrite", (os, mem) => (os ? os.delete(key) : mem.delete(key)));
const all = async (store) =>
  (await run(store, "readonly", (os, mem) =>
    os ? os.getAll() : [...mem.values()],
  )) || [];

const clone = (v) => JSON.parse(JSON.stringify(v));

export const sessions = {
  save: (s) => put("sessions", clone({ ...s, updatedAt: Date.now() })),
  remove: (id) => del("sessions", id),
  list: async () =>
    (await all("sessions")).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    ),
};

export const templates = {
  save: (t) => put("templates", clone(t)),
  remove: (label) => del("templates", label),
  list: async () =>
    (await all("templates")).sort((a, b) =>
      a.label.localeCompare(b.label, "ja"),
    ),
};

/** Dictionary file format for export/import. */
export function exportDictionary(list) {
  return JSON.stringify(
    { format: "shuwa-dictionary", version: 1, signs: list },
    null,
    1,
  );
}

export function parseDictionary(text) {
  const data = JSON.parse(text);
  if (data?.format !== "shuwa-dictionary" || !Array.isArray(data.signs))
    throw new Error("手話翻訳の辞書ファイルではありません");
  return data.signs.filter(
    (s) =>
      typeof s.label === "string" &&
      s.label.trim() &&
      (s.kind === "static" || s.kind === "motion") &&
      Array.isArray(s.samples) &&
      s.samples.length,
  );
}
