/**
 * Вызов LLM на сервере — как llm.py. Ключи API — только в переменных окружения Netlify (или .env локально),
 * в браузер не попадают. Браузер присылает уже посчитанные показатели (не строки CSV), сервер добавляет промпт
 * из prompts/ и потоком возвращает ответ модели.
 *
 * Работает и в Edge Function (Deno), и в локальном dev-server (Node): только fetch, ReadableStream, Web Crypto.
 * Ответ — поток строк JSON (NDJSON): {"t": "кусок текста"} … {"wait": сек} … {"done": true, "source": "…"} | {"error": "…"}.
 * Поток нужен потому, что заключение пишется до 1–2 минут, а ответ без потока Netlify обрывает раньше.
 *
 * anthropic          — Claude Messages API (raw HTTP; SDK в Edge Function не подключается);
 * openai_compatible  — /chat/completions (OpenAI, xAI Grok, Groq, Gemini, DeepSeek, Ollama);
 * template           — без LLM: браузер собирает текст по шаблону сам.
 */
import { readCookie, SESSION_COOKIE, sessionSecret, verifySession } from "./auth.mjs";

const MAX_BODY = 200_000;
const ANTHROPIC_VERSION = "2026-10-21";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";   // для fallbacks = "default"

export class LLMError extends Error {}

/** Настройки провайдера: тип, модель, ключ. env(name) → значение переменной окружения. */
export function resolve(llmCfg, env, name = null) {
  const chosen = (name || env("LLM_PROVIDER") || llmCfg.default_provider || "none").trim().toLowerCase();
  const providers = llmCfg.providers;
  if (!Object.hasOwn(providers, chosen)) {
    throw new LLMError(`Провайдер «${chosen}» не описан в config/llm.toml. Доступны: ${Object.keys(providers).join(", ")}`);
  }
  const p = { ...providers[chosen], name: chosen };
  const generic = chosen === (env("LLM_PROVIDER") || "").trim().toLowerCase() ? env("LLM_MODEL") || "" : "";
  p.model = (p.model_env ? env(p.model_env) : "") || generic || p.model || "";
  const keyEnv = p.api_key_env || "";
  p.api_key = keyEnv ? env(keyEnv) || "" : "";
  p.key_ok = !!p.api_key || !keyEnv;
  return p;
}

export const label = (p) => (p.type === "template" ? "шаблон (без LLM)" : `${p.name} / ${p.model}`);

/** Для кнопки на панели: какая LLM подключена и готова ли. */
export function info(llmCfg, env) {
  try {
    const p = resolve(llmCfg, env);
    return { llm: label(p), template: p.type === "template",
      ok: p.type === "template" || (p.key_ok && !!p.model) };
  } catch (exc) {
    return { llm: "не настроена", template: false, ok: false, error: exc.message };
  }
}

function humanWait(sec) {
  if (!sec) return "—";
  const s = Math.ceil(sec);
  return s < 60 ? `${s} сек.` : s < 3600 ? `${Math.floor(s / 60)} мин.` : `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин.`;
}

/** Сколько ждать после 429: заголовок retry-after или «try again in 1m2.5s» в тексте ошибки. */
function retryAfter(res, text) {
  const h = Number(res.headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return h;
  const m = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/.exec(text || "");
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return null;
}

/** Строки SSE «data: …» из потока ответа. */
async function* sseData(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith("data:")) yield buf.slice(5).trim();
}

async function errorText(res) {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t);
    return j.error?.message || j.message || t.slice(0, 300);
  } catch {
    return t.slice(0, 300);
  }
}

/** Claude: Messages API, потоком. */
async function anthropic(p, system, user, emit) {
  const body = { model: p.model, max_tokens: Number(p.max_tokens || 16000), system,
    messages: [{ role: "user", content: user }], stream: true };
  if (p.effort) body.output_config = { effort: p.effort };
  const headers = { "content-type": "application/json", "x-api-key": p.api_key, "anthropic-version": ANTHROPIC_VERSION };
  if (p.fallbacks) {
    // Серверный фолбэк: при отказе модели запрос повторяется на рекомендованной модели.
    body.fallbacks = p.fallbacks;
    headers["anthropic-beta"] = FALLBACK_BETA;
  }
  const res = await fetch((p.base_url || "https://api.anthropic.com") + "/v1/messages",
    { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const msg = await errorText(res);
    if (res.status === 401) throw new LLMError(`Anthropic: неверный ключ API (${res.status})`);
    if (res.status === 429) throw new LLMError("Anthropic: превышен лимит запросов, повторите позже");
    throw new LLMError(`Anthropic: ошибка API ${res.status}: ${msg}`);
  }
  let stop = null;
  for await (const data of sseData(res.body)) {
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") emit({ t: ev.delta.text });
    else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
    else if (ev.type === "error") throw new LLMError(`Anthropic: ${ev.error?.message || "ошибка в потоке"}`);
  }
  if (stop === "refusal") throw new LLMError("Anthropic: модель отказалась отвечать (stop_reason = refusal)");
  if (stop === "max_tokens") throw new LLMError("Anthropic: ответ обрезан по max_tokens — увеличьте max_tokens в config/llm.toml");
}

/** OpenAI-совместимые (Groq, OpenAI, Grok, Gemini, DeepSeek, Ollama): /chat/completions, потоком. */
async function openaiCompatible(p, system, user, emit) {
  const body = { model: p.model, stream: true,
    messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (p.max_tokens) body.max_tokens = Number(p.max_tokens);
  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      res = await fetch(p.base_url.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key || "not-needed"}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new LLMError(`${p.name}: нет соединения с ${p.base_url}`);
    }
    if (res.status !== 429) break;
    // Минутный лимит (Groq) — ждём, сколько назвал провайдер; дневной (ждать долго) — сразу ошибка со сроком.
    const msg = await errorText(res);
    const wait = retryAfter(res, msg);
    if (wait === null || wait > 120 || attempt === 4) {
      throw new LLMError(`${p.name}: превышен лимит запросов${wait ? `, повторите через ${humanWait(wait)}` : ", повторите позже"}`);
    }
    emit({ wait: Math.ceil(wait), msg: `лимит запросов ${p.name}, жду ${humanWait(wait)}` });
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
  }
  if (!res.ok) {
    const msg = await errorText(res);
    if (res.status === 401) throw new LLMError(`${p.name}: неверный ключ API`);
    throw new LLMError(`${p.name}: ошибка API ${res.status}: ${msg}`);
  }
  let finish = null;
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.error) throw new LLMError(`${p.name}: ${ev.error.message || "ошибка в потоке"}`);
    const ch = ev.choices?.[0];
    if (ch?.delta?.content) emit({ t: ch.delta.content });
    if (ch?.finish_reason) finish = ch.finish_reason;
  }
  if (finish === "length") throw new LLMError(`${p.name}: ответ обрезан по длине — задайте max_tokens в config/llm.toml`);
}

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * POST /api/llm  {kind: "conclusion" | "group", data: {…посчитанные показатели…}} → поток NDJSON.
 * ctx: {env, llmCfg, prompts: {system, conclusion, group}}.
 */
export async function handleLlm(request, { env, llmCfg, prompts }) {
  const password = env("APP_PASSWORD");
  if (password) {
    const ok = await verifySession(readCookie(request.headers.get("cookie"), SESSION_COOKIE),
      sessionSecret(password, env("SESSION_SECRET")));
    if (!ok) return json(401, { error: "Требуется вход", login: "/login" });
  }
  if (request.method !== "POST") return json(405, { error: "Только POST" });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "Слишком большой запрос" });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "Неверный запрос: не JSON" }); }
  const kind = body.kind;
  if (kind !== "conclusion" && kind !== "group") return json(400, { error: "kind должен быть conclusion или group" });
  if (!body.data || typeof body.data !== "object") return json(400, { error: "Нет данных для заключения" });

  let p;
  try { p = resolve(llmCfg, env); } catch (exc) { return json(500, { error: exc.message }); }
  if (p.type === "template") return json(409, { error: "LLM не подключена (LLM_PROVIDER=none) — текст собирается по шаблону" });
  if (!p.key_ok) return json(503, { error: `Не задан ключ ${p.api_key_env} в переменных окружения` });
  if (!p.model) return json(503, { error: `Не задана модель для ${p.name}: ${p.model_env} или LLM_MODEL` });

  const user = prompts[kind] + "\n```json\n" + JSON.stringify(body.data) + "\n```";
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      emit({ start: true, source: label(p) });   // ответ начинается сразу — Netlify не оборвёт по таймауту
      try {
        if (p.type === "anthropic") await anthropic(p, prompts.system, user, emit);
        else if (p.type === "openai_compatible") await openaiCompatible(p, prompts.system, user, emit);
        else throw new LLMError(`Неизвестный тип провайдера: ${p.type}`);
        emit({ done: true, source: label(p) });
      } catch (exc) {
        emit({ error: exc instanceof LLMError ? exc.message : `Ошибка LLM: ${exc.message}` });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff" } });
}
