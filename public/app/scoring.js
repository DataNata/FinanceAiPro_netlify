/** Интегральная оценка, классы A–D и стоп-факторы (раздел 6 Методики) — как scoring.py. */
import { g, stabilityLevel } from "./indicators.js";

const isNum = (x) => x !== null && x !== undefined;

export function score(cfg, items) {
  const pts = cfg.scoring.points;
  const blocks = [];
  let total = 0, weights = 0;
  for (const key of cfg.scoring.order.blocks) {
    const b = cfg.scoring.blocks[key];
    const inPts = (z) => z !== null && z !== undefined && Object.hasOwn(pts, z);
    const used = b.indicators.map((k) => items[k]).filter((i) => inPts(i.zone));
    const excluded = b.indicators.filter((k) => !inPts(items[k].zone)).map((k) => items[k].name);
    const got = used.reduce((s, i) => s + pts[i.zone], 0), mx = 2 * used.length;
    const blockScore = mx ? 100 * got / mx : null;
    blocks.push({ key, name: b.name, weight: b.weight, score: blockScore, points: got, max: mx, excluded });
    if (blockScore !== null) { total += blockScore * b.weight; weights += b.weight; }
  }
  // Нерассчитываемый блок целиком исключается, веса остальных нормируются.
  return { blocks, score: weights ? total / weights : null, weights_used: weights };
}

export function classify(cfg, value, stops) {
  if (!isNum(value)) return { code: null, name: "не определён", reaction: "", capped: false };
  const classes = cfg.scoring.classes;
  let cls = classes.find((c) => value >= c.min);
  let capped = false;
  const cap = cfg.scoring.stop.max_class;
  const order = classes.map((c) => c.code);
  if (stops.length && order.indexOf(cls.code) < order.indexOf(cap)) {
    cls = classes.find((c) => c.code === cap);
    capped = true;
  }
  return { code: cls.code, name: cls.name, reaction: cls.reaction, capped };
}

export function stopFactors(d, e, p, v, prev) {
  const out = [];
  const na = g(v, "net_assets"), sc = g(v, "share_capital");
  if (isNum(na) && (na < 0 || (isNum(sc) && na < sc))) out.push("Чистые активы отрицательные или ниже уставного капитала");
  if (g(v, "interest") && isNum(g(v, "icr")) && v.icr < 1) out.push("Покрытие банковских процентов меньше 1");
  if (isNum(g(v, "differential")) && v.differential < 0 && isNum(g(v, "bank_loans")) && isNum(g(prev, "bank_loans"))
      && v.bank_loans > prev.bank_loans) {
    out.push("Отрицательный дифференциал рычага при росте банковских кредитов");
  }
  if (isNum(g(v, "z5")) && v.z5 < 1.23) out.push("Z (5 факторов) ниже 1,23");
  // Два квартала подряд: скользящие 3 месяца, заканчивающиеся концом периода, и предыдущие 3 месяца.
  const qNow = d.flow(e, "profit_before_tax", [p.end - 2, p.end - 1, p.end]);
  const qPrev = d.flow(e, "profit_before_tax", [p.end - 5, p.end - 4, p.end - 3]);
  if (isNum(qNow) && isNum(qPrev) && qNow < 0 && qPrev < 0) out.push("Убыток до налогообложения два квартала подряд");
  const levels = [p.end, p.end - 3].map((m) => stabilityLevel(d.val(e, "cash", m), d.val(e, "trade_receivables", m),
    d.val(e, "inventories", m), d.val(e, "trade_payables", m)));
  if (levels[0] === "кризисная" && levels[1] === "кризисная") out.push("Кризисная текущая финансовая устойчивость два квартала подряд");
  return out;
}
