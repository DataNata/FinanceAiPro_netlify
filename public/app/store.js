/**
 * Хранение в браузере пользователя (IndexedDB): загруженные CSV, предыдущая загрузка и тексты заключений LLM.
 * На сервер ничего не отправляется; у каждого браузера и пользователя Windows — свои данные.
 * Если IndexedDB недоступна (приватный режим, запрет), данные живут до закрытия вкладки.
 */
const DB = "financeai", STORE = "kv";
const memory = new Map();
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function get(key) {
  try {
    const v = await tx("readonly", (s) => (s ? s.get(key) : null));
    return v === undefined || v === null ? (memory.get(key) ?? null) : v;
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function set(key, value) {
  memory.set(key, value);
  try { await tx("readwrite", (s) => (s ? s.put(value, key) : null)); } catch { /* останется в памяти вкладки */ }
}

export async function del(key) {
  memory.delete(key);
  try { await tx("readwrite", (s) => (s ? s.delete(key) : null)); } catch { /* нет базы — нечего удалять */ }
}

/** Работает ли постоянное хранение (для подсказки пользователю). */
export async function persistent() { return !!(await open()); }
