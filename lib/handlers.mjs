/**
 * Обработчики API (Node): одни и те же для функций Netlify (netlify/functions/*) и локального dev-server.mjs.
 *   POST /api/login   — форма входа (code)
 *   GET  /api/logout  — выход
 *   GET  /api/info    — какая LLM подключена (без ключей)
 * Вызов LLM (/api/llm) — в Edge Function (netlify/edge-functions/llm.mjs), потому что ответ идёт потоком дольше минуты.
 */
import * as auth from "./auth.mjs";
import { LoginGuard } from "./guards.mjs";
import { info as llmInfo } from "./llm.mjs";
import { LLM_CONFIG } from "./generated.mjs";

const env = (name) => process.env[name] || "";
const password = () => env("APP_PASSWORD");
const secret = () => auth.sessionSecret(password(), env("SESSION_SECRET"));

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const redirect = (location, cookie) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
};

const isHttps = (req) => new URL(req.url).protocol === "https:";

async function signedIn(req) {
  if (!password()) return true;
  return !!(await auth.verifySession(auth.readCookie(req.headers.get("cookie"), auth.SESSION_COOKIE), secret()));
}

export async function info(req) {
  if (!(await signedIn(req))) return json(401, { error: "Требуется вход", login: "/login" });
  return json(200, { ...llmInfo(LLM_CONFIG, env), auth: !!password() });
}

let loginGuard;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockedRedirect = (until) => redirect(`/login?error=locked&until=${Math.ceil(until * 1000)}`);

export async function login(req, { ip = "" } = {}) {
  if (req.method !== "POST") return redirect("/login");
  if (!password()) return redirect("/");
  loginGuard ??= new LoginGuard();
  const form = new URLSearchParams((await req.text()).slice(0, 4000));
  const until = await loginGuard.lockedUntil(ip);
  if (until) return lockedRedirect(until);
  if (await auth.checkPassword(form.get("code") || "", password())) {
    await loginGuard.reset(ip);
    return redirect("/", auth.sessionCookie(await auth.createSession(secret()), isHttps(req)));
  }
  console.warn("Неверный код доступа:", ip);
  await loginGuard.fail(ip);
  await sleep(1000);   // замедляем перебор
  const lockedNow = await loginGuard.lockedUntil(ip);
  return lockedNow ? lockedRedirect(lockedNow) : redirect("/login?error=wrong");
}

export async function logout(req) {
  return redirect("/login", auth.clearCookie(isHttps(req)));
}
