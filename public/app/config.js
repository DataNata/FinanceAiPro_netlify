/** Настройки из config/*.toml: в браузере — загрузка с сайта (/config/…), в тестах — из текстов файлов. */
import { parseToml } from "./toml.js";

export const CONFIG_FILES = ["settings", "measures", "indicators", "scoring", "signals"];

/** texts: {settings: "...toml...", measures: "...", …} → cfg */
export function makeConfig(texts) {
  const cfg = {};
  for (const name of CONFIG_FILES) cfg[name] = parseToml(texts[name]);
  return cfg;
}

export async function loadConfig(base = "config/") {
  const texts = {};
  await Promise.all(CONFIG_FILES.map(async (name) => {
    const res = await fetch(`${base}${name}.toml`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Не загружены настройки ${name}.toml (${res.status})`);
    texts[name] = await res.text();
  }));
  return makeConfig(texts);
}
