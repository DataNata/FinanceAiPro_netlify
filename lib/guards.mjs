/**
 * Защита входа от перебора кода: 5 неверных попыток с одного адреса → блокировка на 15 минут.
 * Счётчики — на Netlify в Netlify Blobs (функции не помнят ничего между вызовами), локально — в памяти процесса
 * (FINANCEAI_MEMORY_STORE=1). Хранятся только время неудачных попыток по IP, никаких данных компаний.
 */

export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCK_SEC = 15 * 60;

const nowSec = () => Date.now() / 1000;
const safeKey = (s) => encodeURIComponent(String(s)).slice(0, 200);

export function memoryStore() {
  const data = new Map();
  return {
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async set(key, value) { data.set(key, structuredClone(value)); },
    async delete(key) { data.delete(key); },
  };
}

function blobStore() {
  let storePromise;
  const store = () => (storePromise ??= import("@netlify/blobs").then(({ getStore }) =>
    getStore({ name: "financeai-login", consistency: "strong" })));
  return {
    async get(key) { return (await store()).get(key, { type: "json" }); },
    async set(key, value) { await (await store()).setJSON(key, value); },
    async delete(key) { await (await store()).delete(key); },
  };
}

let shared;
export function getSharedStore() {
  shared ??= process.env.FINANCEAI_MEMORY_STORE === "1" ? memoryStore() : blobStore();
  return shared;
}

export class LoginGuard {
  constructor({ store = getSharedStore(), maxFails = LOGIN_MAX_FAILS, lockSec = LOGIN_LOCK_SEC, now = nowSec } = {}) {
    Object.assign(this, { store, maxFails, lockSec, now });
  }

  /** Время окончания блокировки (секунды epoch) или null, если вход разрешён. */
  async lockedUntil(ip) {
    const now = this.now();
    const fails = ((await this.store.get(`login/${safeKey(ip)}`)) || []).filter((t) => t > now - this.lockSec);
    return fails.length >= this.maxFails ? fails[fails.length - 1] + this.lockSec : null;
  }

  async fail(ip) {
    const k = `login/${safeKey(ip)}`;
    const now = this.now();
    const fails = ((await this.store.get(k)) || []).filter((t) => t > now - this.lockSec);
    fails.push(now);
    await this.store.set(k, fails);
  }

  async reset(ip) {
    await this.store.delete(`login/${safeKey(ip)}`);
  }
}
