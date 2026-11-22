// Серверная часть: вход по коду, «охранник», /api/llm (поток Claude и OpenAI-совместимый) — на подставных ответах.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, createSession, sessionSecret, SESSION_COOKIE, checkPassword } from "../lib/auth.mjs";
import { handleLlm, resolve, info } from "../lib/llm.mjs";
import { parseToml } from "../public/app/toml.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";

const LLM_CFG = parseToml(readFileSync(join(ROOT, "config", "llm.toml"), "utf8"));
const PROMPTS = { system: "SYS", conclusion: "CONC", group: "GRP" };

test("охранник: без входа — на /login, API — 401, вход — пропуск", async () => {
  const pw = "01061979", secret = sessionSecret(pw, "s");
  assert.deepEqual(await gate("/", null, pw, "s"), { action: "redirect", location: "/login" });
  assert.deepEqual(await gate("/api/llm", null, pw, "s"), { action: "deny" });
  assert.deepEqual(await gate("/login.js", null, pw, "s"), { action: "next" });
  assert.deepEqual(await gate("/config/settings.toml", null, pw, "s"), { action: "redirect", location: "/login" });
  const token = await createSession(secret);
  assert.deepEqual(await gate("/", token, pw, "s"), { action: "next" });
  assert.deepEqual(await gate("/", token + "x", pw, "s"), { action: "redirect", location: "/login" });
  assert.deepEqual(await gate("/", null, "", ""), { action: "next" });   // без кода — сайт открыт
  assert.ok(await checkPassword("01061979", pw));
  assert.ok(!(await checkPassword("0106197", pw)));
});

test("выбор провайдера и модели — как в Python (LLM_PROVIDER, *_MODEL, LLM_MODEL)", () => {
  const env = (vars) => (k) => vars[k] || "";
  const p = resolve(LLM_CFG, env({ LLM_PROVIDER: "groq", GROQ_API_KEY: "k", LLM_MODEL: "m1" }));
  assert.equal(p.name, "groq"); assert.equal(p.model, "m1"); assert.ok(p.key_ok);
  assert.equal(resolve(LLM_CFG, env({ LLM_PROVIDER: "groq", GROQ_MODEL: "m2", LLM_MODEL: "m1" })).model, "m2");
  assert.equal(resolve(LLM_CFG, env({ LLM_PROVIDER: "anthropic" })).model, "claude-opus-5-5");
  assert.deepEqual(info(LLM_CFG, env({ LLM_PROVIDER: "none" })), { llm: "шаблон (без LLM)", template: true, ok: true });
  assert.equal(info(LLM_CFG, env({ LLM_PROVIDER: "groq", GROQ_MODEL: "m" })).ok, false);   // нет ключа
});

const sse = (events) => new Response(new ReadableStream({ start(c) {
  for (const e of events) c.enqueue(new TextEncoder().encode(e));
  c.close();
} }), { status: 200, headers: { "content-type": "text/event-stream" } });

async function callLlm(envVars, fakeFetch, body = { kind: "conclusion", data: { "компания": "T" } }, cookie = "") {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return fakeFetch(url, init); };
  try {
    const req = new Request("http://x/api/llm", { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
    const res = await handleLlm(req, { env: (k) => envVars[k] || "", llmCfg: LLM_CFG, prompts: PROMPTS });
    const text = await res.text();
    return { status: res.status, lines: text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)), calls };
  } finally { globalThis.fetch = realFetch; }
}

test("/api/llm: Claude — поток text_delta, effort, серверный фолбэк", async () => {
  const { status, lines, calls } = await callLlm({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk" }, () => sse([
    'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"summary\\":"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" \\"ок\\"}"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  ]));
  assert.equal(status, 200);
  assert.equal(lines.filter((l) => l.t).map((l) => l.t).join(""), '{"summary": "ок"}');
  assert.ok(lines.at(-1).done);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["anthropic-version"], "2026-10-21");
  assert.equal(calls[0].init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(sent.fallbacks, "default");
  assert.deepEqual(sent.output_config, { effort: "medium" });
  assert.equal(sent.stream, true);
  assert.equal(sent.system, "SYS");
  assert.ok(sent.messages[0].content.startsWith("CONC\n```json\n"));
});

test("/api/llm: отказ модели и обрыв по длине — ошибка, а не пустой текст", async () => {
  const refusal = await callLlm({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk" }, () => sse([
    'data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n']));
  assert.match(refusal.lines.at(-1).error, /отказалась/);
  const bad = await callLlm({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk" }, () => new Response("{}", { status: 401 }));
  assert.match(bad.lines.at(-1).error, /неверный ключ/);
});

test("/api/llm: Groq — поток, ожидание при минутном лимите, [DONE]", async () => {
  let n = 0;
  const { lines, calls } = await callLlm({ LLM_PROVIDER: "groq", GROQ_API_KEY: "g", GROQ_MODEL: "m" }, () => {
    if (n++ === 0) return new Response('{"error":{"message":"Rate limit. Please try again in 0.01s"}}', { status: 429 });
    return sse(['data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"1}"},"finish_reason":"stop"}]}\n\n', "data: [DONE]\n\n"]);
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.ok(lines.some((l) => l.wait));
  assert.equal(lines.filter((l) => l.t).map((l) => l.t).join(""), '{"a":1}');
  assert.ok(lines.at(-1).done);
});

test("/api/llm: без входа — 401, неверный запрос — 400, без LLM — 409", async () => {
  assert.equal((await callLlm({ APP_PASSWORD: "1", LLM_PROVIDER: "groq" }, () => sse([]))).status, 401);
  const secret = sessionSecret("1", "s"), token = await createSession(secret);
  const ok = await callLlm({ APP_PASSWORD: "1", SESSION_SECRET: "s", LLM_PROVIDER: "none" }, () => sse([]), undefined, `${SESSION_COOKIE}=${token}`);
  assert.equal(ok.status, 409);
  assert.equal((await callLlm({ LLM_PROVIDER: "groq", GROQ_API_KEY: "g", GROQ_MODEL: "m" }, () => sse([]), { kind: "x", data: {} })).status, 400);
});
