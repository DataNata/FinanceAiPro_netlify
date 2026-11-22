/** Отчёты: заключение по компании и сводка по группе (Word), расчёт (Excel) — как report_word.py и report_excel.py. */
import * as fmt from "./fmt.js";
import { ZONE_RU } from "./zones.js";
import { Doc } from "./docx.js";
import { workbook } from "./xlsx.js";

const FILL = { G: "C6EFCE", Y: "FFEB9C", R: "FFC7CE" };
const ZONE_BY_RU = { "З": "G", "Ж": "Y", "К": "R" };
export const LIMITATIONS = "Статьи ОПУ и баланса не корректировались; оценка запасов и дебиторской задолженности — балансовая; " +
  "ДЗ и КЗ включают НДС, выручка и себестоимость — без НДС, поэтому DSO и DPO выше экономических. " +
  "ДЗ — торговая перед третьими лицами; КЗ — торговая перед третьими лицами и внутригрупповая (ICO), без авансов и ребейтов; " +
  "банковский долг — без факторинга и аренды. Рентабельность активов и капитала, оборачиваемость — " +
  "по оборотам периода, приведённым к году; долг / EBITDA и Z-модель — по данным за 12 месяцев.";

const today = () => new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const zoneFill = (col) => (ri, ci, v) => (ci === col ? FILL[ZONE_BY_RU[v]] || null : null);
const vv = (r, key) => { const i = r.items[key]; return fmt.value(i.value, i.unit); };
const pct0 = (x) => fmt.pyFixed(x * 100, 0) + "%";

export function companyDocx(cfg, r, text, sourceLabel) {
  const doc = new Doc();
  const v = r.values, cls = r.cls, sc = r.scoring;
  doc.heading(`Заключение о финансовом состоянии ${r.company}`, 1);
  doc.para(`за ${r.period.title} (по ОПУ и балансу, без корректировок). Дата расчёта: ${today()}. Источник: ${sourceLabel}. ` +
    `Суммы — USD. Текст выводов: ${text.source || ""}.`, { size: 9 });
  if (text.warning) doc.para(text.warning, { color: "C00000" });

  doc.heading("1. Итог", 2);
  const prev = r.prev || {};
  let delta = "";
  if (prev.score !== null && prev.score !== undefined && sc.score !== null) {
    delta = `${sc.score >= prev.score ? "+" : ""}${fmt.num(sc.score - prev.score, 1)} (за ${prev.period}: ${fmt.num(prev.score, 1)}, класс ${prev.cls})`;
  }
  doc.table(["Класс", "Балл", "Изменение к прошлому периоду", "Стоп-факторы", "Реакция по Методике"],
    [[`${cls.code || "—"} — ${cls.name}` + (cls.capped ? " (ограничен стоп-фактором)" : ""), fmt.num(sc.score, 1),
      delta || "н/д", r.stops.join("; ") || "нет", cls.reaction]], { widths: [3.2, 1.5, 3.8, 4.5, 4.5] });
  doc.para(text.summary || "");
  doc.para(`EBIT ${fmt.value(v.ebit, "money")} = прибыль до налогообложения ${fmt.value(v.pbt, "money")} + ` +
    `банковские проценты ${fmt.value(v.interest, "money")}; EBITDA ${fmt.value(v.ebitda, "money")} = ` +
    `EBIT + амортизация ${fmt.value(v.amortisation, "money")}. Выручка ${fmt.value(v.revenue, "money")}.`);

  doc.heading("2. Главные выводы", 2);
  doc.bullets(text.findings || []);
  const lines = [
    ["Оборотный капитал", `DIO ${vv(r, "dio")} / DSO ${vv(r, "dso")} / DPO ${vv(r, "dpo")} / денежный цикл ${vv(r, "ccc")}`, "working_capital"],
    ["Рентабельность", `ROE ${vv(r, "roe")} = TB ${fmt.num(v.tb ?? null, 2)} × IB ${fmt.num(v.ib ?? null, 2)} × ` +
      `OM ${fmt.value(v.om ?? null, "pct")} × TA ${fmt.num(v.ta ?? null, 2)} × LR ${fmt.num(v.lr ?? null, 2)}`, "profitability"],
    ["Финансирование", `покрытие банковских процентов ${vv(r, "icr")}; банковский долг / EBITDA ${vv(r, "bank_debt_ebitda")}; ` +
      `дифференциал ${vv(r, "differential")}`, "financing"],
    ["Риски", `DOL ${vv(r, "dol")}, маржа безопасности ${vv(r, "margin_safety")}; Z-модель ${vv(r, "z5")} (2 фактора: ${vv(r, "z2")})`, "risks"],
  ];
  for (const [title, numbers, key] of lines) {
    const n = numbers.endsWith(".") ? numbers : numbers + ".";
    doc.para([{ text: `${title}: `, bold: true }, { text: n + (text[key] ? " " + text[key] : "") }]);
  }

  doc.heading("3. Интегральная оценка по блокам", 2);
  doc.table(["Блок", "Вес", "Балл блока", "Баллы", "Не рассчитаны (исключены)"],
    sc.blocks.map((b) => [b.name, pct0(b.weight), fmt.num(b.score, 0), `${b.points} из ${b.max}`, b.excluded.join(", ")]),
    { widths: [5, 1.4, 2, 1.8, 7] });

  doc.heading("4. Показатели", 2);
  for (const b of sc.blocks) {
    doc.heading(b.name, 3);
    const spec = cfg.scoring.blocks[b.key];
    const rows = spec.report.map((k) => {
      const i = r.items[k];
      return [i.name + (spec.indicators.includes(k) ? " ★" : ""), fmt.value(i.value, i.unit), fmt.change(i),
        ZONE_RU[i.zone] ?? "—", i.norm ? i.norm.join(" | ") : "", i.note || ""];
    });
    doc.table(["Показатель", "Значение", "К прошлому году", "Зона", "Ориентир З | Ж | К", "Примечание"], rows,
      { fill: zoneFill(3), widths: [5, 2.4, 2.2, 1.1, 4.3, 3] });
  }
  doc.para("★ — показатель участвует в скоринге.", { size: 8 });

  doc.heading("5. Факторный анализ ROE (DuPont, к тому же периоду прошлого года)", 2);
  if (v.dupont) {
    const rows = v.dupont.map((f) => [f.name, fmt.num(f.prev, 3), fmt.num(f.cur, 3), fmt.num(f.effect * 100, 1)]);
    rows.push(["Итого изменение ROE", "", "", fmt.num(v.dupont.reduce((s, f) => s + f.effect, 0) * 100, 1)]);
    doc.table(["Фактор", "Прошлый год", "Текущий период", "Вклад, п. п."], rows, { widths: [6, 3, 3, 3] });
  } else {
    doc.para("Не рассчитан: нет данных за тот же период прошлого года или ROE не определён.");
  }
  doc.para(`ROE через финансовый рычаг: ${fmt.value(v.roe_leverage ?? null, "pct")} при фактическом ROE ` +
    `${fmt.value(v.roe ?? null, "pct")} (ROA* ${vv(r, "roa_star")}, i ${vv(r, "i_rate")}, ` +
    `D/E ${fmt.num(v.de_avg ?? null, 2)}). Расхождение — небанковские финансовые статьи, оставшиеся в EBIT. ` +
    `ROCE ${vv(r, "roce")} = OM ${fmt.value(v.om ?? null, "pct")} × S/CE ${fmt.num(v.ce_turnover ?? null, 2)}.`);

  doc.heading("6. Сигналы раннего предупреждения", 2);
  if (r.signals.length) {
    doc.table(["Сигнал", "Факт", "Зона", "Вероятная причина", "Действия", "Ответственный"],
      r.signals.map((s) => [s.signal, s.fact, ZONE_RU[s.zone], s.cause, s.action, s.owner]),
      { fill: zoneFill(2), widths: [3.5, 3, 1.1, 3.3, 4, 3] });
  } else doc.para("Сигналов нет.");

  doc.heading("7. Рекомендации", 2);
  const recs = text.recommendations || [];
  if (recs.length) {
    doc.table(["Мероприятие", "Эффект", "Ответственный", "Срок"],
      recs.map((x) => [x.action || "", x.effect || "", x.owner || "", x.deadline || ""]), { widths: [6.5, 5, 3.5, 2.5] });
  } else doc.para("Нет.");

  doc.heading("8. Контроль данных и ограничения расчёта", 2);
  doc.bullets([...r.quality.map((q) => (q.level === "error" ? "Ошибка: " : "") + q.text), ...r.notes]);
  doc.para(LIMITATIONS);
  doc.para("");
  doc.para("Подготовил: финансовый аналитик ______________     Согласовал: финансовый директор ______________");
  return doc.toBytes();
}

export function groupDocx(cfg, results, text, sourceLabel) {
  const doc = new Doc();
  const period = results[0].period;
  doc.heading(`Финансовое состояние компаний группы — ${period.title}`, 1);
  doc.para(`По ОПУ и балансу, без корректировок. Дата расчёта: ${today()}. Источник: ${sourceLabel}. Текст: ${text.source || ""}.`, { size: 9 });
  if (text.warning) doc.para(text.warning, { color: "C00000" });
  doc.para(text.summary || "");
  const keys = ["ebit_margin", "roe", "current_ratio", "ccc", "autonomy", "bank_debt_ebitda", "z5"];
  const header = ["Компания", "Класс", "Балл", "Прошлый период", ...keys.map((k) => cfg.indicators[k].name.split(" (")[0])];
  const sorted = [...results].sort((a, b) => -(a.scoring.score || 0) + (b.scoring.score || 0));
  const rows = sorted.map((r) => {
    const prev = r.prev || {};
    return [`${r.entity} ${r.company}` + (r.stops.length ? " ⚠" : ""), r.cls.code || "—", fmt.num(r.scoring.score, 0),
      `${fmt.num(prev.score ?? null, 0)} (${prev.cls || "—"})`, ...keys.map((k) => fmt.value(r.items[k].value, r.items[k].unit))];
  });
  doc.table(header, rows, { size: 8, fill: (ri, ci) => (ci >= 4 ? FILL[sorted[ri].items[keys[ci - 4]].zone] || null : null) });
  doc.para("⚠ — есть стоп-фактор (класс не выше C).", { size: 8 });
  for (const [title, key] of [["Лидеры", "leaders"], ["Требуют внимания", "attention"], ["Общие риски группы", "group_risks"]]) {
    if (text[key] && text[key].length) { doc.heading(title, 2); doc.bullets(text[key]); }
  }
  doc.heading("Стоп-факторы и сигналы по компаниям", 2);
  for (const r of results) {
    const parts = [...(r.stops.length ? ["стоп: " + r.stops.join("; ")] : []), ...r.signals.map((s) => s.signal)];
    doc.para([{ text: `${r.entity}: `, bold: true }, { text: parts.join("; ") || "нет" }]);
  }
  return doc.toBytes();
}

const MEASURE_KEYS = ["revenue", "cost_of_sales", "gross_profit", "pbt", "interest", "amortisation", "ebit", "ebitda",
  "net_profit", "income_tax", "revenue_ltm", "ebit_ltm", "ebitda_ltm", "total_assets", "non_current_assets",
  "current_assets", "inventories", "trade_receivables", "cash", "equity", "share_capital",
  "non_current_liabilities", "current_liabilities", "trade_payables", "bank_loans", "days"];

/** Excel с расчётом: Сводка, Показатели, Блоки, Сигналы, Контроль данных, Меры. */
export function excel(cfg, results) {
  const summary = [], indicators = [], blocks = [], signals = [], quality = [], measures = [];
  const num = (x) => (typeof x === "number" ? x : null);
  for (const r of results) {
    const base = { "Юрлицо": r.entity, "Компания": r.company, "Период": r.period.label };
    const prev = r.prev || {};
    summary.push({ ...base, "Класс": r.cls.code, "Состояние": r.cls.name, "Балл": r.scoring.score,
      "Балл прошлого периода": prev.score ?? null, "Класс прошлого периода": prev.cls ?? null,
      "Стоп-факторы": r.stops.join("; "), "Сигналов": r.signals.length,
      "Ошибок данных": r.quality.filter((q) => q.level === "error").length });
    for (const [key, i] of Object.entries(r.items)) {
      indicators.push({ ...base, "Блок": i.block, "Ключ": key, "Показатель": i.name, "Значение": num(i.value),
        "Значение (текст)": fmt.value(i.value, i.unit), "Прошлый год": num(i.py_value), "Зона": ZONE_RU[i.zone] ?? "",
        "Ориентир": i.norm ? i.norm.join(" | ") : "", "Формула": i.formula, "Примечание": i.note || "" });
    }
    for (const b of r.scoring.blocks) {
      blocks.push({ ...base, "Блок": b.name, "Вес": b.weight, "Балл блока": b.score, "Баллы": b.points, "Максимум": b.max,
        "Исключены": b.excluded.join(", ") });
    }
    for (const s of r.signals) {
      signals.push({ ...base, "Сигнал": s.signal, "Факт": s.fact, "Зона": ZONE_RU[s.zone], "Причина": s.cause,
        "Действия": s.action, "Ответственный": s.owner, "Срок": s.deadline });
    }
    for (const q of r.quality) quality.push({ ...base, "Уровень": q.level, "Замечание": q.text });
    measures.push({ ...base, ...Object.fromEntries(MEASURE_KEYS.map((k) => [k, r.values[k] ?? null])) });
  }
  return workbook([{ name: "Сводка", rows: summary }, { name: "Показатели", rows: indicators }, { name: "Блоки", rows: blocks },
    { name: "Сигналы", rows: signals }, { name: "Контроль данных", rows: quality }, { name: "Меры", rows: measures }]);
}
