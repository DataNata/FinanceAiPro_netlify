/**
 * Текст заключения — как narrative.py: данные для LLM (payload), разбор ответа LLM, шаблон без LLM.
 * Сам вызов LLM — на сервере (lib/llm.mjs): ключи API в браузер не попадают.
 */
import * as fmt from "./fmt.js";
import { ZONE_RU } from "./zones.js";

const isNum = (x) => x !== null && x !== undefined;

/** Показатель одной строкой: «Название: значение (зона; ориентир …; к ПГ …; примечание)». */
function itemLine(i) {
  if (!isNum(i.value) && !isNum(i.zone)) return null;
  const parts = [ZONE_RU[i.zone] ?? "без зоны"];
  if ((i.zone === "Y" || i.zone === "R") && i.norm) parts.push("ориентир З|Ж|К: " + i.norm.join(" | "));
  const ch = fmt.change(i);
  if (ch) parts.push(`к ПГ ${ch}`);
  if (i.note) parts.push(i.note);
  return `${i.name}: ${fmt.value(i.value, i.unit)} (${parts.join("; ")})`;
}

/** Агрегированные показатели юрлица для LLM (строки CSV не передаются). */
export function payload(cfg, r) {
  const v = r.values, items = r.items;
  const blocks = {};
  for (const b of r.scoring.blocks) {
    const lines = cfg.scoring.blocks[b.key].report.map((k) => itemLine(items[k]));
    blocks[`${b.name} (балл ${fmt.num(b.score, 0)})`] = lines.filter(Boolean);
  }
  let dupont = null;
  if (v.dupont) {
    dupont = v.dupont.map((f) => `${f.name}: ${fmt.num(f.prev, 3)} → ${fmt.num(f.cur, 3)}, вклад в ROE ` +
      `${fmt.num(f.effect * 100, 1)} п. п.`);
  }
  const prev = r.prev || {};
  const m = (key) => fmt.value(v[key] ?? null, "money");
  return {
    "компания": `${r.entity} ${r.company}`,
    "период": r.period.title,
    "итог": `класс ${r.cls.code} (${r.cls.name}), балл ${fmt.num(r.scoring.score, 1)}; ` +
      `прошлый период ${prev.period ?? "—"}: балл ${fmt.num(prev.score ?? null, 1)}, класс ${prev.cls || "—"}` +
      (r.cls.capped ? "; класс ограничен стоп-фактором" : ""),
    "стоп_факторы": r.stops.length ? r.stops : "нет",
    "суммы": `выручка ${m("revenue")}; прибыль до налогообложения ${m("pbt")}; банковские проценты ${m("interest")}; ` +
      `EBIT ${m("ebit")}; амортизация ${m("amortisation")}; EBITDA ${m("ebitda")}`,
    "блоки": blocks,
    "DuPont_к_прошлому_году": dupont,
    "ROE_через_рычаг": `факт ${fmt.value(v.roe ?? null, "pct")}, по формуле рычага ${fmt.value(v.roe_leverage ?? null, "pct")}`,
    "сигналы": r.signals.map((s) => `[${ZONE_RU[s.zone]}] ${s.signal} — ${s.fact}; причина: ${s.cause}; ` +
      `действие: ${s.action}; ответственный: ${s.owner}`),
    "контроль_данных": [...r.quality.map((q) => q.text), ...r.notes],
  };
}

/** JSON из ответа модели (первая «{» … последняя «}»). */
export function parseJson(text) {
  const m = /\{[\s\S]*\}/.exec(String(text));
  if (!m) throw new Error("Ответ модели не содержит JSON");
  try {
    return JSON.parse(m[0]);
  } catch (exc) {
    throw new Error(`Ответ модели — некорректный JSON: ${exc.message}`);
  }
}

/** Ответ LLM по компании → текст заключения (как company_text после _ask). */
export function companyFromLlm(obj, source) {
  const out = { ...obj };
  if (!Array.isArray(out.findings)) out.findings = out.findings ? [String(out.findings)] : [];
  out.recommendations = (Array.isArray(out.recommendations) ? out.recommendations : [])
    .filter((x) => x && typeof x === "object" && !Array.isArray(x));
  out.source = source;
  return out;
}

/** Выводы без LLM: из зон, сигналов и правил связки показателей Методики. */
export function templateText(cfg, r) {
  const items = r.items, v = r.values, cls = r.cls;
  const score = r.scoring.score;
  let summary = cls.code ? `Класс ${cls.code} — ${cls.name.toLowerCase()} состояние, интегральный балл ${fmt.num(score, 0)}.`
    : "Интегральная оценка не определена: недостаточно данных.";
  if (r.stops.length) summary += " Стоп-факторы: " + r.stops.join("; ").toLowerCase() + ".";
  const findings = [];
  for (const b of r.scoring.blocks) {
    const reds = cfg.scoring.blocks[b.key].indicators.map((k) => items[k]).filter((i) => i.zone === "R");
    if (reds.length) {
      const line = `${b.name}: в красной зоне — ` + reds.map((i) => `${i.name} ${fmt.value(i.value, i.unit)}`).join("; ");
      findings.push(line.endsWith(".") ? line : line + ".");
    }
  }
  const cr = items.current_ratio, ccc = items.ccc;
  const profOk = ["ebit_margin", "roa_star"].filter((k) => items[k].zone).every((k) => items[k].zone === "G");
  if ((cr.zone === "Y" || cr.zone === "R") && isNum(v.ccc)) {
    if (v.ccc <= 0 && profOk) {
      findings.push("Низкая ликвидность при отрицательном денежном цикле и рентабельности в зелёной зоне — " +
        "допустимая модель работы на деньгах поставщиков.");
    } else if (ccc.zone === "Y" || ccc.zone === "R") {
      findings.push(`Ликвидность ${fmt.value(cr.value, "ratio")} при денежном цикле ` +
        `${fmt.value(v.ccc, "days")} — оборотный капитал финансируется не поставщиками.`);
    }
  }
  const recs = r.signals.map((s) => ({ action: s.action, effect: s.signal, owner: s.owner, deadline: s.deadline }));
  return { summary, findings: findings.length ? findings : ["Существенных отклонений не выявлено."],
    recommendations: recs, source: "шаблон (без LLM)" };
}

export function groupPayload(results) {
  const keys = ["ebit_margin", "roe", "roa_star", "current_ratio", "ccc", "dio", "dso", "autonomy", "bank_debt_ebitda", "z5"];
  return results.map((r) => ({
    "компания": `${r.entity} ${r.company}`, "класс": r.cls.code,
    "балл": isNum(r.scoring.score) ? Number(fmt.pyFixed(r.scoring.score, 1)) : null,
    "прошлый_период": r.prev ?? null, "стоп_факторы": r.stops,
    "показатели": Object.fromEntries(keys.map((k) => [r.items[k].name,
      `${fmt.value(r.items[k].value, r.items[k].unit)} (${ZONE_RU[r.items[k].zone] ?? "—"})`])),
    "сигналы": r.signals.map((s) => s.signal),
  }));
}

/** Сводка по группе без LLM. */
export function groupTemplate(results) {
  const byCls = {};
  for (const r of results) (byCls[r.cls.code || "—"] ??= []).push(r.entity);
  const summary = "Распределение по классам: " + Object.keys(byCls).sort()
    .map((k) => `${k} — ${byCls[k].join(", ")}`).join("; ") + ".";
  const attention = results.filter((r) => r.cls.code === "C" || r.cls.code === "D" || r.stops.length)
    .map((r) => `${r.entity}: класс ${r.cls.code}, ` + (r.stops.length ? r.stops.join("; ")
      : r.signals.slice(0, 3).map((s) => s.signal).join(", ") || "без сигналов"));
  return { summary, leaders: results.filter((r) => r.cls.code === "A").map((r) => `${r.entity}: класс ${r.cls.code}`),
    attention, group_risks: [], source: "шаблон (без LLM)" };
}
