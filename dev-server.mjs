/**
 * Локальный запуск без Netlify:  node dev-server.mjs  →  http://127.0.0.1:8000
 *
 * Повторяет то, что делает Netlify: сборку (scripts/build.mjs), «охранник» входа (как Edge Function),
 * /api/llm потоком (как Edge Function), функции /api/login, /api/logout, /api/info и раздачу файлов из public/.
 * Настройки — из файла .env рядом (уже заданные переменные окружения не перетираются).
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = resolve(ROOT, "public");

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (let line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
process.env.FINANCEAI_MEMORY_STORE = "1";   // счётчики входа — в памяти, без Netlify Blobs

const { build } = await import("./scripts/build.mjs");
build();
const handlers = await import("./lib/handlers.mjs");
const { gate, readCookie, SESSION_COOKIE } = await import("./lib/auth.mjs");
const { handleLlm } = await import("./lib/llm.mjs");
const { PROMPTS, LLM_CONFIG } = await import("./lib/generated.mjs");

const env = (name) => process.env[name] || "";
const ROUTES = {
  "/api/login": handlers.login,
  "/api/logout": handlers.logout,
  "/api/info": handlers.info,
  "/api/llm": (req) => handleLlm(req, { env, llmCfg: LLM_CONFIG, prompts: PROMPTS }),
};
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".toml": "text/plain; charset=utf-8",
};
// Те же заголовки безопасности, что в netlify.toml
const SECURITY = {
  "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 400_000) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function send(res, response) {
  const headers = { ...SECURITY, "Cache-Control": "no-store" };
  response.headers.forEach((value, key) => { if (key !== "set-cookie") headers[key] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body) return res.end();
  const reader = response.body.getReader();   // поток (ответ LLM) — передаём по мере поступления
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

function staticFile(pathname) {
  const candidates = pathname === "/" ? ["index.html"] : [pathname.slice(1), `${pathname.slice(1)}.html`];
  for (const rel of candidates) {
    const file = resolve(PUBLIC, decodeURIComponent(rel));
    if (!file.startsWith(PUBLIC + sep)) continue;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const decision = await gate(url.pathname, readCookie(req.headers.cookie, SESSION_COOKIE), env("APP_PASSWORD"), env("SESSION_SECRET"));
    if (decision.action === "deny") return send(res, Response.json({ error: "Требуется вход", login: "/login" }, { status: 401 }));
    if (decision.action === "redirect") return send(res, new Response(null, { status: 302, headers: { Location: decision.location } }));
    const handler = ROUTES[url.pathname];
    if (handler) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      return send(res, await handler(request, { ip: req.socket.remoteAddress || "" }));
    }
    const file = staticFile(url.pathname);
    if (!file) return send(res, new Response("Не найдено", { status: 404 }));
    return send(res, new Response(readFileSync(file), { headers: { "Content-Type": TYPES[extname(file)] || "application/octet-stream" } }));
  } catch (exc) {
    console.error(exc);
    if (!res.headersSent) send(res, new Response("Внутренняя ошибка", { status: 500 }));
  }
});

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);
server.listen(PORT, HOST, () => {
  console.log(`FinanceAiPro (JS): http://${HOST}:${PORT}`);
  console.log(env("APP_PASSWORD") ? "Вход по коду доступа включён (APP_PASSWORD)" : "APP_PASSWORD не задан — вход без кода");
  console.log("Данные CSV обрабатываются в браузере и на сервер не отправляются. Остановить: Ctrl+C");
});
