/**
 * Панель FinanceAiPro (JavaScript-версия для Netlify).
 * Загрузка и проверка CSV, расчёт по Методике, шаблоны, Word и Excel — в браузере; данные хранятся в IndexedDB
 * этого браузера. На сервер уходят только посчитанные показатели — по кнопке «Сформировать заключение» (/api/llm).
 * Отрисовка панели — та же, что в Python-версии (templates/dashboard.html).
 */
import { loadConfig } from "./config.js";
import * as csv from "./csv.js";
import { buildMeasures } from "./measures.js";
import { dataset, fingerprint, record } from "./dataset.js";
import { analyze } from "./analysis.js";
import { parsePeriod, parseYm, monthRange, ym } from "./periods.js";
import * as narrative from "./narrative.js";
import * as reports from "./reports.js";
import * as store from "./store.js";

const ZL = { G: "З", Y: "Ж", R: "К" };
const ZN = { G: "норма", Y: "внимание", R: "требуются действия" };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (x, d = 1) => x == null ? "н/д" : x.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", "−");
const entity = e => D.entities.find(x => x.e === e);
const prefs = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

let CFG;
try {
  CFG = await loadConfig();
} catch (exc) {
  document.body.insertAdjacentHTML("afterbegin", `<div class="genstatus err" style="margin:16px">Не загружены настройки расчёта: ${esc(exc.message)}</div>`);
  throw exc;
}
let DATA = null, META = {}, loadErrors = [];
let TEXTS = (await store.get("texts")) || {};   // заключения LLM: {"2026-Q2|589": {...текст, data_fp}}
const savedData = await store.get("data");
if (savedData) {
  try { applyData(savedData); } catch (exc) { DATA = null; loadErrors = exc.errors || [exc.message]; }
}
const SRC = "csv";
let D = dataset(CFG, DATA, TEXTS, META);
let kinds = [];
const state = { block: "all", zone: "all", q: "" };
const periodsOf = k => D.periods.filter(p => p.k === k).map(p => p.p).sort();
function resetState() {
  kinds = ["M", "Q", "Y"].filter(k => D.periods.some(p => p.k === k));
  const kind = kinds.includes(state.kind) ? state.kind : (kinds.includes("Q") ? "Q" : kinds[0]);
  const ps = periodsOf(kind);
  Object.assign(state, {
    kind,
    period: ps.includes(state.period) ? state.period : ps.slice(-1)[0],   // тот же период, если он есть в источнике
    countries: new Set(D.entities.map(e => e.country)),
    entity: D.entities.some(e => e.e === state.entity) ? state.entity : (D.entities[0] || {}).e,
  });
}
resetState();
const edits = {};   // правки текста заключения: ключ источник|entity|period

function rec(e, p) { return D.records.find(r => r.e === e && r.p === p); }
function visible() {
  return D.entities.filter(x => state.countries.has(x.country)).map(x => rec(x.e, state.period)).filter(Boolean);
}
function periodTitle(p) { return (D.periods.find(x => x.p === p) || {}).t || p; }

/* ---------- Подсказка ---------- */
const tip = $("#tip");
function showTip(html, ev) {
  tip.innerHTML = html; tip.style.display = "block";
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.style.display = "none"; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 1800); }

/* ---------- Фильтры ---------- */
function renderSource() {
  $("#gen").textContent = DATA ? "источник: " + D.sourceLabel : "данные не загружены";
}
function renderFilters() {
  document.querySelectorAll("#kindSeg button").forEach(b => {
    b.style.display = kinds.includes(b.dataset.k) ? "" : "none";
    b.setAttribute("aria-pressed", b.dataset.k === state.kind);
  });
  $("#periodSel").innerHTML = periodsOf(state.kind).slice().reverse()
    .map(p => `<option value="${p}" ${p === state.period ? "selected" : ""}>${esc(periodTitle(p))}</option>`).join("");
  const countries = [...new Set(D.entities.map(e => e.country))];
  const all = countries.every(c => state.countries.has(c));
  $("#countryChips").innerHTML = `<span class="chip" tabindex="0" role="button" data-c="*" aria-pressed="${all}">Все</span>` +
    countries.map(c => `<span class="chip" tabindex="0" role="button" data-c="${esc(c)}" aria-pressed="${!all && state.countries.has(c)}">${esc(c)}</span>`).join("");
}
$("#kindSeg").addEventListener("click", ev => {
  const k = ev.target.dataset.k; if (!k) return;
  state.kind = k; state.period = periodsOf(k).slice(-1)[0]; renderAll();
});
$("#periodSel").addEventListener("change", ev => { state.period = ev.target.value; renderAll(); });
function toggleCountry(c) {
  const countries = [...new Set(D.entities.map(e => e.country))];
  const all = countries.every(x => state.countries.has(x));
  if (c === "*") state.countries = new Set(countries);
  else if (all) state.countries = new Set([c]);
  else { state.countries.has(c) ? state.countries.delete(c) : state.countries.add(c);
         if (!state.countries.size) state.countries = new Set(countries); }
  renderAll();
}
$("#countryChips").addEventListener("click", ev => { const c = ev.target.dataset.c; if (c) toggleCountry(c); });
$("#countryChips").addEventListener("keydown", ev => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.dataset.c) { ev.preventDefault(); toggleCountry(ev.target.dataset.c); } });

/* ---------- KPI ---------- */
function renderKPIs(list) {
  const scores = list.map(r => r.score).filter(x => x != null);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const cnt = { A: 0, B: 0, C: 0, D: 0 }; list.forEach(r => r.cls && cnt[r.cls]++);
  const stops = list.reduce((a, r) => a + r.stops.length, 0);
  const red = list.reduce((a, r) => a + r.signals.filter(s => s.z === "R").length, 0);
  const total = list.length || 1;
  const colors = { A: "var(--good)", B: "var(--warn)", C: "var(--serious)", D: "var(--crit)" };
  $("#kpis").innerHTML = `
    <div class="kpi"><div class="l">Компаний в выборке</div><div class="v">${list.length}</div><div class="l">${esc(periodTitle(state.period))}</div></div>
    <div class="kpi"><div class="l">Средний интегральный балл</div><div class="v">${num(avg, 1)}</div><div class="l">из 100</div></div>
    <div class="kpi"><div class="l">Классы A · B · C · D</div><div class="v">${cnt.A} · ${cnt.B} · ${cnt.C} · ${cnt.D}</div>
      <div class="classbar" aria-hidden="true">${["A","B","C","D"].filter(c => cnt[c]).map(c => `<span style="width:${cnt[c] / total * 100}%;background:${colors[c]}" title="${c}: ${cnt[c]}"></span>`).join("")}</div></div>
    <div class="kpi"><div class="l">Стоп-факторы</div><div class="v" style="color:${stops ? "var(--crit-text)" : "inherit"}">${stops}</div><div class="l">${list.filter(r => r.stops.length).map(r => r.e).join(", ") || "нет"}</div></div>
    <div class="kpi"><div class="l">Сигналы красной зоны</div><div class="v">${red}</div><div class="l">план действий — 5 рабочих дней</div></div>`;
}

/* ---------- Карточки ---------- */
function deltaHtml(r) {
  if (r.score == null || r.prevScore == null) return `<span class="muted">н/д к прошлому периоду</span>`;
  const d = r.score - r.prevScore, up = d >= 0;
  return `<span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${num(Math.abs(d), 1)}</span> <span class="muted">к ${esc(r.prevP || "")}</span>`;
}
function renderCards(list) {
  if (!list.find(r => r.e === state.entity) && list.length) state.entity = list[0].e;
  $("#cards").innerHTML = list.length ? list.map(r => {
    const ent = entity(r.e);
    return `<div class="card" tabindex="0" role="button" data-e="${r.e}" aria-selected="${r.e === state.entity}">
      <div class="row"><div><div class="name">${esc(ent.name)}</div><div class="country">${esc(ent.country)}</div></div>
        <span class="badge ${r.cls}" title="Класс ${r.cls} — ${esc(r.clsName)}">${r.cls || "—"}</span></div>
      <div class="score">${num(r.score, 1)}</div>
      <div class="meter" aria-hidden="true"><span style="width:${r.score || 0}%"></span></div>
      <div class="foot"><span>${deltaHtml(r)}</span></div>
      <div class="foot">${r.stops.length ? `<span style="color:var(--crit-text)">⛔ стоп-факторов: ${r.stops.length}</span>` : `<span>✓ без стоп-факторов</span>`}
        <span>⚑ сигналов: ${r.signals.length}</span></div>
    </div>`; }).join("") : `<div class="empty">Нет данных за выбранный период и страны</div>`;
}
function selectEntity(e) { state.entity = e; renderAll(); document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "start" }); }
$("#cards").addEventListener("click", ev => { const c = ev.target.closest(".card"); if (c) selectEntity(c.dataset.e); });
$("#cards").addEventListener("keydown", ev => { const c = ev.target.closest(".card"); if (c && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); selectEntity(c.dataset.e); } });

/* ---------- Тепловая карта ---------- */
function itemTip(key, it, name) {
  const m = D.meta[key];
  return `<b>${esc(name ? name + " · " : "")}${esc(m.n)}</b><br>Значение: <b>${esc(it[0])}</b>` +
    (it[1] ? ` · зона ${ZL[it[1]]} (${ZN[it[1]]})` : "") +
    (it[2] ? `<br>К прошлому году: ${esc(it[2])}` : "") +
    (m.norm ? `<br>Ориентир З | Ж | К: ${esc(m.norm.join(" | "))}` : "") +
    (it[3] ? `<br><span class="muted">${esc(it[3])}</span>` : "");
}
function renderHeat(list) {
  const keys = D.heatmap;
  const short = k => D.meta[k].n.replace(/\s*\(.*?\)\s*/g, " ").replace("Период оборота ", "").trim();
  const abbr = { dio: "DIO", dso: "DSO", dpo: "DPO", ccc: "Денежный цикл", ebit_margin: "Рентаб. EBIT", roe: "ROE", roa_star: "ROA*",
    current_ratio: "Текущая ликв.", quick_ratio: "Быстрая ликв.", autonomy: "Автономия", leverage: "D/E",
    bank_debt_ebitda: "Долг / EBITDA", z5: "Z-модель" };
  $("#heat").innerHTML = `<thead><tr><th class="rowh">Компания</th><th>Класс</th><th>Балл</th>${keys.map(k => `<th title="${esc(D.meta[k].n)}">${esc(abbr[k] || short(k))}</th>`).join("")}</tr></thead>
    <tbody>${list.map(r => `<tr class="${r.e === state.entity ? "sel" : ""}"><td class="name" data-e="${r.e}">${esc(entity(r.e).name)}</td>
      <td><span class="badge sm ${r.cls}">${r.cls || "—"}</span></td><td><b>${num(r.score, 0)}</b></td>
      ${keys.map(k => { const it = r.items[k]; const z = it[1] || "N";
        return `<td class="cell ${z}" data-e="${r.e}" data-k="${k}">${esc(it[0])}${it[1] ? ` <span class="muted" style="font-size:11px">${ZL[it[1]]}</span>` : ""}</td>`; }).join("")}
    </tr>`).join("")}</tbody>`;
}
$("#heat").addEventListener("mousemove", ev => {
  const td = ev.target.closest("td.cell"); if (!td) return hideTip();
  const r = rec(td.dataset.e, state.period);
  showTip(itemTip(td.dataset.k, r.items[td.dataset.k], entity(r.e).name), ev);
});
$("#heat").addEventListener("mouseleave", hideTip);
$("#heat").addEventListener("click", ev => { const td = ev.target.closest("td.name"); if (td) selectEntity(td.dataset.e); });

/* ---------- Детали компании ---------- */
function renderDetail(r) {
  const el = $("#detail");
  if (!r) { el.innerHTML = `<div class="empty">Выберите компанию</div>`; return; }
  const ent = entity(r.e);
  el.innerHTML = `
    <div class="dhead">
      <span class="badge ${r.cls}" title="Класс ${r.cls}">${r.cls || "—"}</span>
      <div><div style="font-size:18px;font-weight:650">${esc(ent.name)} · ${esc(ent.country)}</div>
        <div class="sub">${esc(periodTitle(r.p))} · ${esc(r.clsName)} состояние${r.capped ? " (класс ограничен стоп-фактором)" : ""} · ${esc(r.reaction)}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="big">${num(r.score, 1)}</div><div class="sub">${deltaHtml(r)}</div></div>
    </div>
    <div class="sums">
      <span>Выручка <b>${esc(r.sums.revenue)}</b></span><span>EBIT <b>${esc(r.sums.ebit)}</b></span>
      <span>EBITDA <b>${esc(r.sums.ebitda)}</b></span><span>Чистая прибыль <b>${esc(r.sums.net)}</b></span>
      <span>Активы <b>${esc(r.sums.assets)}</b></span>
    </div>
    ${r.stops.length ? `<div class="stop"><strong>⛔ Стоп-факторы (класс не выше C):</strong> ${r.stops.map(esc).join("; ")}</div>` : ""}
    <h2 style="margin-top:18px">Сигналы раннего предупреждения</h2>
    <div class="signals">${r.signals.length ? r.signals.map(s => `<div class="sig ${s.z}"><div class="t"><span class="zone ${s.z}">${ZL[s.z]}</span> ${esc(s.s)}</div>
      <div class="m">${esc(s.f)} · ${esc(s.a)} · <b>${esc(s.o)}</b>, срок ${esc(s.d)}</div></div>`).join("") : `<div class="muted">Сигналов нет</div>`}</div>
    ${r.quality.length ? `<div class="hint">Контроль данных: ${r.quality.map(esc).join(" · ")}</div>` : ""}`;
}

/* ---------- Тренд балла ---------- */
function renderTrend(e) {
  const pts = periodsOf(state.kind).map(p => ({ p, r: rec(e, p) })).filter(x => x.r && x.r.score != null);
  const box = $("#trend");
  if (pts.length < 2) { box.innerHTML = `<div class="empty">Недостаточно периодов для тренда</div>`; return; }
  const W = Math.max(box.clientWidth || 600, 320), H = 240, m = { l: 34, r: 16, t: 14, b: 30 };
  const x = i => m.l + (W - m.l - m.r) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
  const y = v => m.t + (H - m.t - m.b) * (1 - v / 100);
  const bands = [[80, "A"], [60, "B"], [40, "C"]];
  const step = Math.ceil(pts.length / 8);
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Интегральный балл по периодам">`;
  [0, 20, 40, 60, 80, 100].forEach(v => {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>
          <text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
  bands.forEach(([v, c]) => { s += `<text x="${W - m.r}" y="${y(v) - 4}" text-anchor="end">≥${v} — ${c}</text>`; });
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>`;
  pts.forEach((pt, i) => { if (i % step === 0 || i === pts.length - 1) {
    const anchor = i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";   // крайние подписи не обрезаются
    s += `<text x="${x(i)}" y="${H - 10}" text-anchor="${anchor}">${esc(pt.p)}</text>`; } });
  s += `<path d="${pts.map((pt, i) => (i ? "L" : "M") + x(i) + " " + y(pt.r.score)).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((pt, i) => {
    const sel = pt.p === state.period;
    s += `<circle cx="${x(i)}" cy="${y(pt.r.score)}" r="${sel ? 6 : 4}" fill="${sel ? "var(--accent)" : "var(--surface)"}" stroke="${sel ? "var(--surface)" : "var(--accent)"}" stroke-width="2"/>`;
  });
  const last = pts[pts.length - 1];
  s += `<line id="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-dasharray="3 3" style="display:none"/>`;
  s += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="hit"/></svg>`;
  box.innerHTML = s;
  const hit = box.querySelector("#hit"), cross = box.querySelector("#cross");
  hit.addEventListener("mousemove", ev => {
    const bx = box.querySelector("svg").getBoundingClientRect();
    const rel = (ev.clientX - bx.left - m.l) / (W - m.l - m.r);
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(rel * (pts.length - 1))));
    const r = pts[i].r;
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
    showTip(`<b>${esc(periodTitle(r.p))}</b><br>Балл <b>${num(r.score, 1)}</b> · класс <b>${r.cls}</b>` +
      (r.stops.length ? `<br>Стоп-факторов: ${r.stops.length}` : ""), ev);
  });
  hit.addEventListener("mouseleave", () => { cross.style.display = "none"; hideTip(); });
  hit.addEventListener("click", ev => {
    const bx = box.querySelector("svg").getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((ev.clientX - bx.left - m.l) / (W - m.l - m.r) * (pts.length - 1))));
    state.period = pts[i].p; renderAll();
  });
}

/* ---------- Блоки ---------- */
function renderBars(r) {
  if (!r) { $("#bars").innerHTML = ""; return; }
  $("#bars").innerHTML = r.blocks.map(b => `<div class="bar" data-b="${b.k}">
      <div>${esc(b.n)} <span class="w">· вес ${Math.round(b.w * 100)}%</span></div>
      <div class="track"><div class="fill" style="width:${b.s ?? 0}%"></div></div>
      <div class="val">${b.s == null ? "н/д" : b.s}</div></div>`).join("") +
    `<div class="hint">Балл блока = сумма баллов показателей (З — 2, Ж — 1, К — 0) / максимум × 100. Нажмите на блок — таблица ниже покажет его показатели.</div>`;
}
$("#bars").addEventListener("click", ev => { const b = ev.target.closest(".bar"); if (!b) return;
  state.block = b.dataset.b; $("#blockSel").value = b.dataset.b; renderTable(rec(state.entity, state.period));
  $("#ind").scrollIntoView({ behavior: "smooth", block: "center" }); });

/* ---------- Таблица показателей ---------- */
function renderTable(r) {
  const t = $("#ind");
  if (!r) { t.innerHTML = ""; return; }
  const q = state.q.trim().toLowerCase();
  let html = `<thead><tr><th>Показатель</th><th>Значение</th><th>К прошлому году</th><th>Зона</th><th>Ориентир З | Ж | К</th><th>Примечание</th></tr></thead><tbody>`;
  D.blocks.filter(b => state.block === "all" || b.k === state.block).forEach(b => {
    const rows = b.report.filter(k => {
      const it = r.items[k], m = D.meta[k];
      if (state.zone === "R" && it[1] !== "R") return false;
      if (state.zone === "YR" && !["Y", "R"].includes(it[1])) return false;
      return !q || m.n.toLowerCase().includes(q) || (m.f || "").toLowerCase().includes(q);
    });
    if (!rows.length) return;
    html += `<tr class="blk"><td colspan="6">${esc(b.n)}</td></tr>`;
    rows.forEach(k => { const it = r.items[k], m = D.meta[k];
      html += `<tr><td title="${esc(m.f)}">${esc(m.n)} ${m.sc ? `<span class="star" title="В скоринге">★</span>` : ""}</td>
        <td class="num">${esc(it[0])}</td><td class="num" style="font-weight:400">${esc(it[2])}</td>
        <td>${it[1] ? `<span class="zone ${it[1]}">${ZL[it[1]]}</span>` : `<span class="zone N">—</span>`}</td>
        <td class="norm">${m.norm ? esc(m.norm.join(" | ")) : ""}</td><td class="norm">${esc(it[3])}</td></tr>`; });
  });
  t.innerHTML = html + `</tbody>`;
}
$("#blockSel").addEventListener("change", ev => { state.block = ev.target.value; renderTable(rec(state.entity, state.period)); });
$("#zoneSel").addEventListener("change", ev => { state.zone = ev.target.value; renderTable(rec(state.entity, state.period)); });
$("#search").addEventListener("input", ev => { state.q = ev.target.value; renderTable(rec(state.entity, state.period)); });

/* ---------- Заключение ---------- */
function conclusionHtml(r) {
  const t = r.text || {}, ent = entity(r.e);
  const sec = (title, body) => body ? `<h4>${esc(title)}</h4><p>${esc(body)}</p>` : "";
  let h = `<h3>Заключение о финансовом состоянии ${esc(ent.name)} (${esc(ent.country)})</h3>
    <p><i>за ${esc(periodTitle(r.p))} — по ОПУ и балансу, без корректировок. Источник данных: ${esc(D.sourceLabel)}</i></p>
    <p><b>Итог:</b> класс ${esc(r.cls)} — ${esc(r.clsName)} состояние, интегральный балл ${num(r.score, 1)}` +
    (r.prevScore != null ? ` (за ${esc(r.prevP)}: ${num(r.prevScore, 1)}, класс ${esc(r.prevCls)})` : "") +
    `. Стоп-факторы: ${r.stops.length ? r.stops.map(esc).join("; ") : "нет"}.</p>`;
  if (t.summary && !String(t.source || "").startsWith("шаблон")) h += `<p>${esc(t.summary)}</p>`;   // у шаблона summary = строка «Итог»
  if (t.findings && t.findings.length) h += `<h4>Главные выводы</h4><ul>${t.findings.map(f => `<li>${esc(f)}</li>`).join("")}</ul>`;
  h += sec("Оборотный капитал", t.working_capital) + sec("Рентабельность", t.profitability) +
       sec("Финансирование", t.financing) + sec("Риски", t.risks);
  const recs = t.recommendations || [];
  if (recs.length) h += `<h4>Рекомендации</h4><table><tr><th>Мероприятие</th><th>Эффект</th><th>Ответственный</th><th>Срок</th></tr>` +
    recs.map(x => `<tr><td>${esc(x.action)}</td><td>${esc(x.effect)}</td><td>${esc(x.owner)}</td><td>${esc(x.deadline)}</td></tr>`).join("") + `</table>`;
  h += `<p style="font-size:12px;margin-top:14px"><i>Ограничения: статьи ОПУ и баланса не корректировались; оценка запасов и дебиторской задолженности — балансовая; ДЗ и КЗ включают НДС.</i></p>`;
  return h;
}
function editKey(r) { return SRC + "|" + r.e + "|" + r.p; }
function renderConclusion(r) {
  const ed = $("#editor");
  if (!r) { ed.innerHTML = ""; return; }
  const t = r.text || {};
  $("#cTitle").textContent = `Финансовое заключение — ${entity(r.e).name}, ${periodTitle(r.p)}`;
  const isTemplate = String(t.source || "").startsWith("шаблон");
  $("#cSrc").innerHTML = `Текст: ${esc(t.source || "")}` +
    (isTemplate ? `<span class="tag">нажмите «Сформировать заключение» для текста LLM</span>` : "") +
    (t.warning ? ` <span class="warnline">· ${esc(t.warning)}</span>` : "");
  ed.innerHTML = edits[editKey(r)] ?? conclusionHtml(r);
}
$("#editor").addEventListener("input", () => { const r = rec(state.entity, state.period); if (r) edits[editKey(r)] = $("#editor").innerHTML; });
$("#resetBtn").addEventListener("click", () => { const r = rec(state.entity, state.period); if (!r) return; delete edits[editKey(r)]; renderConclusion(r); toast("Исходный текст восстановлен"); });

function fileBase(r) { return `Заключение_${r.e}_${r.p}`; }
function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function keyTableHtml(r) {
  const fill = { G: "#c6efce", Y: "#ffeb9c", R: "#ffc7ce" };
  let h = `<h4>Ключевые показатели</h4><table><tr><th>Показатель</th><th>Значение</th><th>К прошлому году</th><th>Зона</th></tr>`;
  D.blocks.forEach(b => { h += `<tr><td colspan="4" style="background:#d9e1f2"><b>${esc(b.n)}</b></td></tr>`;
    b.report.forEach(k => { const it = r.items[k]; if (!it[1] && it[0] === "н/д") return;
      h += `<tr><td>${esc(D.meta[k].n)}</td><td>${esc(it[0])}</td><td>${esc(it[2])}</td>
        <td style="background:${fill[it[1]] || "#fff"}">${it[1] ? ZL[it[1]] : "—"}</td></tr>`; }); });
  return h + `</table>`;
}
$("#wordBtn").addEventListener("click", () => {
  const r = rec(state.entity, state.period); if (!r) return;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(fileBase(r))}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt} h3{font-size:15pt} h4{font-size:12pt;margin-top:12pt}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #999;padding:3pt 5pt;font-size:10pt;vertical-align:top} th{background:#d9e1f2}</style></head>
<body>${$("#editor").innerHTML}${keyTableHtml(r)}
<p style="margin-top:18pt">Подготовил: финансовый аналитик ______________ &nbsp;&nbsp; Согласовал: финансовый директор ______________</p></body></html>`;
  download(fileBase(r) + ".doc", new Blob(["﻿", html], { type: "application/msword" }));
  toast("Файл Word сохранён в «Загрузки»");
});
$("#txtBtn").addEventListener("click", () => { const r = rec(state.entity, state.period); if (!r) return;
  download(fileBase(r) + ".txt", new Blob(["﻿" + $("#editor").innerText], { type: "text/plain;charset=utf-8" })); });
$("#copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#editor").innerText); toast("Текст скопирован"); }
  catch (e) { const rg = document.createRange(); rg.selectNodeContents($("#editor")); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); document.execCommand("copy"); toast("Текст скопирован"); }
});
$("#printBtn").addEventListener("click", () => window.print());

/* ---------- Заключения: LLM через сервер (/api/llm), всё остальное — в браузере ---------- */
let llmInfo = null;
function setStatus(html, kind) { const s = $("#genStatus"); s.className = "genstatus " + (kind || ""); s.innerHTML = html; }
fetch("api/info", { cache: "no-store" }).then((r) => r.json()).then((i) => {
  llmInfo = i;
  $("#genBtn").title = "LLM: " + i.llm;
  if (i.auth) $("#logoutBtn").style.display = "";
  if (!i.ok) setStatus(`LLM не настроена (${esc(i.llm)}): проверьте ключ и модель в переменных окружения Netlify (или в .env при локальном запуске).`, "err");
  else if (i.template) setStatus("LLM не подключена (LLM_PROVIDER=none) — заключения собираются по шаблону из рассчитанных показателей.", "info");
}).catch(() => {});

/** Запрос к LLM: показатели → поток NDJSON → JSON заключения. onWait — сообщение о паузе из-за лимита. */
async function askLlm(kind, data, onWait) {
  const res = await fetch("api/llm", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, data }) });
  if (res.status === 401) throw new Error("сеанс входа истёк — обновите страницу и введите код доступа");
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || ("ошибка сервера " + res.status));
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", source = "", done = false;
  const handle = (line) => {
    if (!line.trim()) return;
    const m = JSON.parse(line);
    if (m.error) throw new Error(m.error);
    if (m.t) text += m.t;
    if (m.wait && onWait) onWait(m.msg || `жду ${m.wait} сек.`);
    if (m.source) source = m.source;
    if (m.done) done = true;
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);
  if (!done) throw new Error("ответ LLM оборвался — повторите");
  return { obj: narrative.parseJson(text), source };
}

function analysisOf(e, p) { return analyze(CFG, DATA, e, parsePeriod(p)); }

async function generate(e, p, onWait) {
  const r = analysisOf(e, p);
  const errors = r.quality.filter((q) => q.level === "error").map((q) => q.text);
  if (errors.length) throw new Error(errors.join("; "));
  let text;
  if (llmInfo && llmInfo.template) text = narrative.templateText(CFG, r);
  else {
    const { obj, source } = await askLlm("conclusion", narrative.payload(CFG, r), onWait);
    text = narrative.companyFromLlm(obj, source);
  }
  TEXTS[`${p}|${e}`] = { ...text, data_fp: fingerprint(r) };
  await store.set("texts", TEXTS);
  const i = D.records.findIndex((x) => x.e === e && x.p === p);
  const fresh = record(CFG, r, text);
  if (i >= 0) D.records[i] = fresh; else D.records.push(fresh);
  delete edits[editKey(fresh)];
  return fresh;
}
function busy(on) { ["#genBtn", "#genAllBtn", "#groupBtn"].forEach((s) => { $(s).disabled = on; }); }
$("#genBtn").addEventListener("click", async () => {
  const e = state.entity, p = state.period;
  busy(true);
  setStatus(`⏳ Формирую заключение ${esc(entity(e).name)} за ${esc(periodTitle(p))} (${esc(llmInfo ? llmInfo.llm : "LLM")})… обычно до 1–2 минут.`, "info");
  try {
    const r = await generate(e, p, (msg) => setStatus(`⏳ ${esc(msg)}…`, "info"));
    renderAll();
    setStatus(`✓ Заключение готово (${esc(r.text.source)}). Документ Word — кнопка «📄 Полное заключение (.docx)».`, "info");
  } catch (err) { setStatus("Не удалось сформировать: " + esc(err.message), "err"); }
  finally { busy(false); }
});
$("#genAllBtn").addEventListener("click", async () => {
  const list = visible(), p = state.period, done = [];
  let stop = null;
  busy(true);
  for (let i = 0; i < list.length; i++) {
    setStatus(`⏳ ${i + 1} из ${list.length}: ${esc(entity(list[i].e).name)} — ${esc(periodTitle(p))}… (бесплатный тариф Groq — около 40 сек. на компанию)`, "info");
    try { await generate(list[i].e, p, (msg) => setStatus(`⏳ ${i + 1} из ${list.length}: ${esc(msg)}…`, "info")); done.push(list[i].e); }
    catch (err) { stop = `${list[i].e}: ${err.message}`; break; }   // лимит LLM исчерпан — дальше не пытаемся
    if (list[i].e === state.entity) renderConclusion(rec(state.entity, p));
  }
  busy(false); renderAll();
  setStatus(stop ? `Остановлено — ${esc(stop)}.<br>Готово: ${done.length ? esc(done.join(", ")) : "нет"}. Остальные заключения не изменены.`
                 : `✓ Заключения по ${list.length} компаниям готовы.`, stop ? "err" : "info");
});
$("#groupBtn").addEventListener("click", async () => {
  const list = visible(), p = state.period;
  if (list.length < 2) return setStatus("Для сводки нужны минимум 2 компании — выберите «Все» или несколько стран.", "err");
  busy(true);
  setStatus(`⏳ Формирую сводку по группе за ${esc(periodTitle(p))} (${list.length} компаний, ${esc(llmInfo ? llmInfo.llm : "LLM")})… обычно до 1–2 минут.`, "info");
  try {
    const results = [], skipped = [];
    for (const x of list) {
      const r = analysisOf(x.e, p);
      if (r.quality.some((q) => q.level === "error")) skipped.push(x.e); else results.push(r);
    }
    if (results.length < 2) throw new Error(`для сводки нужны минимум 2 компании с полными данными за ${p}`);
    let text;
    if (llmInfo && llmInfo.template) text = narrative.groupTemplate(results);
    else {
      const { obj, source } = await askLlm("group", { "период": results[0].period.title, "компании": narrative.groupPayload(results) },
        (msg) => setStatus(`⏳ ${esc(msg)}…`, "info"));
      text = { ...obj, source };
    }
    download(`${p}_сводка_по_группе.docx`, new Blob([reports.groupDocx(CFG, results, text, D.sourceLabel)], { type: DOCX }));
    download(`${p}_расчёт.xlsx`, new Blob([reports.excel(CFG, results)], { type: XLSX }));
    setStatus(`✓ Сводка по ${results.length} компаниям готова (${esc(text.source)}) — в «Загрузках»: ${esc(p)}_сводка_по_группе.docx и ${esc(p)}_расчёт.xlsx.` +
      (skipped.length ? ` Без данных: ${esc(skipped.join(", "))}.` : ""), "info");
  } catch (err) { setStatus("Не удалось сформировать сводку: " + esc(err.message), "err"); }
  finally { busy(false); }
});
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
$("#docxLink").addEventListener("click", () => {
  const x = rec(state.entity, state.period); if (!x) return;
  const r = analysisOf(x.e, x.p);
  download(`${x.p}_${x.e}_заключение.docx`, new Blob([reports.companyDocx(CFG, r, x.text, D.sourceLabel)], { type: DOCX }));
  toast("Заключение Word — в «Загрузках»");
});

/* ---------- CSV показателей ---------- */
$("#csvBtn").addEventListener("click", () => {
  const list = visible();
  const rows = [["Юрлицо", "Компания", "Страна", "Период", "Класс", "Балл", "Блок", "Показатель", "Значение", "К прошлому году", "Зона", "Примечание"]];
  list.forEach((r) => { const ent = entity(r.e);
    D.blocks.forEach((b) => b.report.forEach((k) => { const it = r.items[k];
      rows.push([r.e, ent.name, ent.country, r.p, r.cls, r.score, b.n, D.meta[k].n, it[0], it[2], it[1] ? ZL[it[1]] : "", it[3]]); })); });
  const text = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""').replace(/ /g, " ")}"`).join(";")).join("\r\n");
  download(`Показатели_${state.period}.csv`, new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
});

/* ---------- Тема ---------- */
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
applyTheme(prefs.get("fa-theme"));
$("#themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark"; applyTheme(next); prefs.set("fa-theme", next); renderAll();
});

/* ---------- Отрисовка ---------- */
function renderAll() {
  hideTip();
  renderSource();
  const empty = !D.records.length;   // данных нет (первый вход, ошибка в файлах) — предлагаем загрузить
  $("#main").style.display = empty ? "none" : "";
  $("#emptyState").style.display = empty ? "" : "none";
  $("#csvBtn").style.display = empty ? "none" : "";
  $("#loadErr").innerHTML = loadErrors.length ? "Сохранённые в браузере файлы не прочитаны:<ul>" + loadErrors.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>" : "";
  if (empty) return;
  renderFilters();
  const list = visible();
  renderKPIs(list); renderCards(list); renderHeat(list);
  const r = rec(state.entity, state.period);
  renderDetail(r); renderTrend(state.entity); renderBars(r); renderTable(r); renderConclusion(r);
}
function fillBlocks() { $("#blockSel").innerHTML = `<option value="all">Все блоки</option>` + D.blocks.map((b) => `<option value="${b.k}">${esc(b.n)}</option>`).join(""); }

/* ---------- Загрузка данных: проверка и расчёт в браузере, хранение — в IndexedDB этого браузера ---------- */
const upFiles = { pl: null, bs: null };
function upReset() {
  upFiles.pl = upFiles.bs = null; $("#upErr").innerHTML = "";
  document.querySelectorAll("#upDlg input[type=file]").forEach((i) => { i.value = ""; });
  upShow();
}
function upShow() {
  [["pl", "#dropPl", "обороты за месяц"], ["bs", "#dropBs", "остатки на конец месяца"]].forEach(([f, sel, hint]) => {
    const el = $(sel), file = upFiles[f];
    el.classList.toggle("ok", !!file);
    el.querySelector(".fn").textContent = file ? `✓ ${file.name} · ${(file.size / 1024).toFixed(0)} КБ` : `${hint} · выбрать файл`;
  });
  $("#upGo").disabled = !(upFiles.pl && upFiles.bs);
}
async function upOpen(toTemplate) {
  upReset(); tplDefaults();
  $("#restoreBtn").style.display = (await store.get("prev")) ? "" : "none";
  $("#clearBtn").style.display = (await store.get("data")) ? "" : "none";
  $("#upDlg").showModal();
  if (toTemplate === true) { $("#tplBox").scrollIntoView({ block: "nearest" }); $("#tplE").focus(); }
}
/* Шаблон CSV — собирается в браузере по config/measures.toml */
const MIN_MONTHS = csv.minMonths(CFG);
document.querySelectorAll(".minN").forEach((el) => { el.textContent = MIN_MONTHS; });
function monthShift(ymStr, k) {   // "2026-09", -14 → "2025-07"
  const [y, m] = ymStr.split("-").map(Number), t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
function tplMonths() {
  const from = $("#tplFrom").value, to = $("#tplTo").value || from;
  if (!from || !to) return 0;
  const n = (s) => { const [y, m] = s.split("-").map(Number); return y * 12 + m; };
  return Math.abs(n(to) - n(from)) + 1;
}
function tplCheck() {
  const n = tplMonths(), ok = n >= MIN_MONTHS && n <= 120, el = $("#tplSpan");
  el.textContent = !n ? "" : n > 120 ? "Не больше 120 месяцев" : ok ? `Период: ${n} мес.` : `Выбрано ${n} мес., нужно не меньше ${MIN_MONTHS} — измените «Месяц с»`;
  el.classList.toggle("bad", !!n && !ok);
  $("#tplPl").disabled = $("#tplBs").disabled = !ok;
  return ok;
}
function tplDefaults() {
  const months = D.periods.filter((p) => p.k === "M").map((p) => p.p).sort();
  const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  const last = months.slice(-1)[0] || `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const ent = D.entities.find((e) => e.e === state.entity) || D.entities[0];
  if (!$("#tplE").value) $("#tplE").value = ent ? ent.e : "";
  if (!$("#tplName").value && ent && ent.name !== ent.e) $("#tplName").value = ent.name;
  if (!$("#tplTo").value) $("#tplTo").value = last;
  if (!$("#tplFrom").value) $("#tplFrom").value = monthShift($("#tplTo").value, -(MIN_MONTHS - 1));
  tplCheck();
}
function tplDownload(f) {
  const e = $("#tplE").value.trim(), from = $("#tplFrom").value, to = $("#tplTo").value || from;
  if (!e) { $("#tplE").focus(); return toast("Укажите код юрлица"); }
  if (!from) { $("#tplFrom").focus(); return toast("Укажите месяц"); }
  if (!tplCheck()) { $("#tplFrom").focus(); return toast(`Нужно не меньше ${MIN_MONTHS} месяцев`); }
  let a = parseYm(from), b = parseYm(to);
  if (b < a) [a, b] = [b, a];
  const text = csv.template(CFG, f, e, $("#tplName").value.trim(), monthRange(a, b));
  download(`${f}_шаблон_${e}_${ym(a)}_${ym(b)}.csv`, new Blob([text], { type: "text/csv;charset=utf-8" }));
  toast(`Шаблон ${f === "pl" ? "ОПУ" : "баланса"} — в «Загрузки»`);
}
["#tplFrom", "#tplTo"].forEach((sel) => $(sel).addEventListener("input", tplCheck));
$("#tplPl").addEventListener("click", () => tplDownload("pl"));
$("#tplBs").addEventListener("click", () => tplDownload("bs"));
$("#tplLink").addEventListener("click", () => upOpen(true));
function upGuess(file) {   // при перетаскивании обоих файлов сразу — по имени
  const n = file.name.toLowerCase();
  return /(^|[^a-z])(pl|pnl|опу)/.test(n) ? "pl" : /(^|[^a-z])(bs|баланс|balance)/.test(n) ? "bs" : null;
}
$("#upBtn").addEventListener("click", upOpen);
$("#upBtn2").addEventListener("click", upOpen);
$("#upClose").addEventListener("click", () => $("#upDlg").close());
$("#upCancel").addEventListener("click", () => $("#upDlg").close());
document.querySelectorAll("#upDlg input[type=file]").forEach((inp) => inp.addEventListener("change", () => {
  upFiles[inp.dataset.f] = inp.files[0] || null; $("#upErr").innerHTML = ""; upShow();
}));
[["pl", "#dropPl"], ["bs", "#dropBs"]].forEach(([f, sel]) => {
  const el = $(sel);
  el.addEventListener("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (ev) => {
    ev.preventDefault(); ev.stopPropagation(); el.classList.remove("over");
    const fs = [...ev.dataTransfer.files];
    if (fs.length === 1) upFiles[f] = fs[0]; else fs.forEach((x) => { const g = upGuess(x); if (g) upFiles[g] = x; });
    $("#upErr").innerHTML = ""; upShow();
  });
});
$("#upDlg").addEventListener("dragover", (ev) => ev.preventDefault());
$("#upDlg").addEventListener("drop", (ev) => {   // оба файла брошены мимо полей — раскладываем по имени
  ev.preventDefault();
  const fs = [...ev.dataTransfer.files], miss = [];
  fs.forEach((x) => { const g = upGuess(x); if (g) upFiles[g] = x; else miss.push(x.name); });
  $("#upErr").innerHTML = miss.length ? `Не понятно, ОПУ это или баланс: ${esc(miss.join(", "))} — перетащите файл на нужное поле.` : "";
  upShow();
});
function setUp(html, kind) { const s = $("#upStatus"); s.className = "genstatus " + (kind || ""); s.innerHTML = html; }

const stamp = () => new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
/** Проверенные файлы → расчёт → панель. saved = {pl, bs (тексты), names: {pl, bs}, loadedAt}. */
function applyData(saved) {
  const { pl, bs } = csv.checkUpload(CFG, { pl: saved.pl, bs: saved.bs });
  const label = `${saved.names.pl} и ${saved.names.bs} (загружены в этом браузере ${saved.loadedAt})`;
  DATA = buildMeasures(CFG, pl, bs, { key: "csv", label });
  META = { sourceLabel: label, generated: saved.loadedAt };
}
function rebuild() {
  D = dataset(CFG, DATA, TEXTS, META);
  Object.keys(edits).forEach((k) => delete edits[k]);
  fillBlocks(); resetState(); renderAll();
}
/** raw = {pl: Uint8Array, bs: Uint8Array}; names — имена файлов. Ошибки → в окно загрузки, прежние данные не трогаются. */
async function loadFiles(raw, names) {
  let checked;
  try {
    checked = csv.checkUpload(CFG, raw);
  } catch (exc) {
    if (!(exc instanceof csv.CsvError)) throw exc;
    $("#upErr").innerHTML = "Файлы не загружены — исправьте ошибки" +
      "<ul>" + exc.errors.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>" + `<div style="margin-top:6px">Прежние данные не изменены.</div>`;
    return false;
  }
  const saved = { pl: checked.texts.pl, bs: checked.texts.bs, names, loadedAt: stamp() };
  const cur = await store.get("data");
  if (cur) await store.set("prev", cur);
  await store.set("data", saved);
  applyData(saved); loadErrors = []; rebuild();
  const ents = DATA.entities();
  const span = (form) => { const ms = [...new Set(ents.flatMap((e) => DATA.months(form, e)))].sort((a, b) => a - b);
    return ms.length ? `${ym(ms[0])} … ${ym(ms[ms.length - 1])}` : "нет"; };
  const persist = await store.persistent();
  setUp(`✓ Данные загружены: ${esc(ents.map((e) => `${e} ${DATA.name(e)}`).join(", "))}. ОПУ ${esc(span("pl"))}, баланс ${esc(span("bs"))}; ` +
    `периодов для анализа — ${D.periods.length}. ` + (persist ? "Данные сохранены в этом браузере." : "<b>Браузер не разрешает хранение</b> — данные пропадут при закрытии вкладки.") +
    (cur ? " Прежние данные можно вернуть в окне «Загрузить данные»." : "") +
    (D.periods.length ? "" : " <b>Нет ни одного периода с полными данными</b> — нужны ОПУ за все месяцы периода и баланс на его конец."),
    D.periods.length ? "info" : "err");
  return true;
}
$("#upGo").addEventListener("click", async () => {
  const go = $("#upGo"); go.disabled = true; go.textContent = "⏳ Проверяю…";
  try {
    const raw = { pl: new Uint8Array(await upFiles.pl.arrayBuffer()), bs: new Uint8Array(await upFiles.bs.arrayBuffer()) };
    if (await loadFiles(raw, { pl: upFiles.pl.name, bs: upFiles.bs.name })) $("#upDlg").close();
  } catch (err) { $("#upErr").innerHTML = "Не удалось загрузить: " + esc(err.message); }
  finally { go.textContent = "Загрузить"; upShow(); }
});
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-sample]"); if (!b) return;
  const name = b.dataset.sample, title = name === "alisa" ? "«Алиса»" : "«ОАОМэри»";
  try {
    const get = async (f) => { const r = await fetch(`examples/${name}/${f}.csv`, { cache: "no-store" });
      if (!r.ok) throw new Error(`нет файла примера (${r.status})`); return new Uint8Array(await r.arrayBuffer()); };
    const ok = await loadFiles({ pl: await get("pl"), bs: await get("bs") }, { pl: `пример ${title} pl.csv`, bs: `bs.csv` });
    if (ok && $("#upDlg").open) $("#upDlg").close();
  } catch (err) { setUp("Не удалось загрузить пример: " + esc(err.message), "err"); }
});
$("#restoreBtn").addEventListener("click", async () => {
  const prev = await store.get("prev"), cur = await store.get("data");
  if (!prev) return;
  try { applyData(prev); } catch (exc) { $("#upErr").innerHTML = "Прежние данные не прочитаны: " + esc((exc.errors || [exc.message]).join("; ")); return; }
  await store.set("data", prev);
  if (cur) await store.set("prev", cur);
  loadErrors = []; rebuild(); $("#upDlg").close();
  setUp(`↩ Возвращены прежние данные: ${esc(META.sourceLabel)}.`, "info");
});
$("#clearBtn").addEventListener("click", async () => {
  if (!confirm("Удалить загруженные файлы, прежнюю загрузку и сохранённые заключения из этого браузера?")) return;
  await store.del("data"); await store.del("prev"); await store.del("texts");
  DATA = null; META = {}; TEXTS = {}; loadErrors = [];
  rebuild(); $("#upDlg").close();
  setUp("🗑 Данные удалены из этого браузера.", "info");
});

let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => renderTrend(state.entity), 150); });
fillBlocks();
renderAll();
