/**
 * Сборка перед публикацией (Netlify запускает её сам — см. netlify.toml) и перед локальным запуском:
 *   1. config/*.toml (кроме llm.toml) → public/config/  — настройки расчёта для браузера;
 *   2. prompts/*.md + config/llm.toml → lib/generated.mjs — промпты и провайдеры LLM для серверной функции.
 * Источник правды — config/ и prompts/ в корне; public/config/ и lib/generated.mjs не править руками.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseToml } from "../public/app/toml.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function build({ quiet = false } = {}) {
  const out = join(ROOT, "public", "config");
  mkdirSync(out, { recursive: true });
  const copied = [];
  for (const f of readdirSync(join(ROOT, "config"))) {
    if (!f.endsWith(".toml") || f === "llm.toml") continue;
    parseToml(readFileSync(join(ROOT, "config", f), "utf8"));   // ошибка в настройках — сборка падает сразу
    copyFileSync(join(ROOT, "config", f), join(out, f));
    copied.push(f);
  }
  const prompts = Object.fromEntries(["system", "conclusion", "group"]
    .map((n) => [n, readFileSync(join(ROOT, "prompts", `${n}.md`), "utf8")]));
  const llm = parseToml(readFileSync(join(ROOT, "config", "llm.toml"), "utf8"));
  writeFileSync(join(ROOT, "lib", "generated.mjs"),
    "// Создан scripts/build.mjs из prompts/*.md и config/llm.toml — не править руками.\n" +
    `export const PROMPTS = ${JSON.stringify(prompts, null, 1)};\n` +
    `export const LLM_CONFIG = ${JSON.stringify(llm, null, 1)};\n`, "utf8");
  if (!quiet) console.log(`Сборка: настройки → public/config (${copied.join(", ")}); промпты и LLM → lib/generated.mjs`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
