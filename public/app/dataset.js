/**
 * Данные панели: все юрлица × все доступные периоды — как dashboard.py.
 * Тексты заключений LLM хранятся в браузере (store.js) вместе с «отпечатком» расчёта: если после загрузки
 * новых CSV показатели изменились, старый текст не показывается.
 */
import * as fmt from "./fmt.js";
import { analyze } from "./analysis.js";
import { templateText } from "./narrative.js";
import { Period } from "./periods.js";

export const HEATMAP_KEYS = ["ebit_margin", "roe", "roa_star", "current_ratio", "quick_ratio", "dio", "dso", "dpo", "ccc",
  "autonomy", "leverage", "bank_debt_ebitda", "z5"];

/** Периоды, за которые есть ОПУ за все месяцы и баланс на конец хотя бы у одного юрлица. */
export function periodsFor(d, entities) {
  const months = [...new Set(entities.flatMap((e) => d.months("pl", e)))].sort((a, b) => a - b);
  if (!months.length) return [];
  const bsMonths = entities.flatMap((e) => d.months("bs", e));
  if (!bsMonths.length) return [];
  const lastBs = Math.max(...bsMonths);
  const set = new Set(months);
  const out = [];
  for (const m of months) {
    if (m > lastBs) continue;
    out.push(new Period("M", m));
    if (((m % 12) + 1) % 3 === 0 && set.has(m - 2)) out.push(new Period("Q", m));
    if ((m % 12) + 1 === 12 && set.has(m - 11)) out.push(new Period("Y", m));
  }
  return out;
}

/** Стабильная строка JSON (ключи по алфавиту) и короткий хэш — «отпечаток» расчёта. */
function stable(x) {
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + stable(x[k])).join(",") + "}";
  return JSON.stringify(x ?? null);
}
function hash(s) {   // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
export function fingerprint(r) {
  return hash(stable({
    items: Object.fromEntries(Object.entries(r.items).map(([k, i]) => [k, [i.value, i.zone]])),
    score: r.scoring.score, cls: r.cls.code, stops: r.stops, signals: r.signals.map((s) => s.signal),
  }));
}

/** Сохранённый текст LLM, если он написан по тем же данным; иначе — шаблонный текст. */
export function pickText(cfg, r, saved) {
  if (!saved) return templateText(cfg, r);
  const { data_fp: fp, ...text } = saved;
  if (fp && fp !== fingerprint(r)) {
    const out = templateText(cfg, r);
    out.warning = `данные изменились после того, как заключение написала LLM (${text.source || ""}) — сформируйте заключение заново`;
    out.stale = true;
    return out;
  }
  return text;
}

const round1 = (x) => (x === null || x === undefined ? null : Number(fmt.pyFixed(x, 1)));

export function record(cfg, r, text) {
  const p = r.period;
  const items = {};
  for (const [k, i] of Object.entries(r.items)) {
    const raw = typeof i.value === "number" ? i.value : null;
    items[k] = [fmt.value(i.value, i.unit), i.zone, fmt.change(i), i.note || "", raw];
  }
  const prev = r.prev || {};
  const v = r.values;
  return {
    e: r.entity, p: p.label, k: p.kind,
    score: round1(r.scoring.score), cls: r.cls.code, clsName: r.cls.name, reaction: r.cls.reaction, capped: r.cls.capped,
    prevScore: round1(prev.score), prevCls: prev.cls ?? null, prevP: prev.period ?? null,
    stops: r.stops,
    signals: r.signals.map((s) => ({ s: s.signal, f: s.fact, z: s.zone, a: s.action, o: s.owner, d: s.deadline })),
    blocks: r.scoring.blocks.map((b) => ({ k: b.key, n: b.name, w: b.weight, s: b.score === null ? null : Number(fmt.pyFixed(b.score, 0)) })),
    items,
    quality: [...r.quality.map((q) => q.text), ...r.notes],
    sums: { revenue: fmt.value(v.revenue, "money"), ebit: fmt.value(v.ebit, "money"), ebitda: fmt.value(v.ebitda, "money"),
      net: fmt.value(v.net_profit, "money"), assets: fmt.value(v.total_assets, "money") },
    text,
  };
}

/**
 * Всё для панели. d = null — данных нет (панель пустая). texts — сохранённые тексты LLM {"2026-Q2|589": {...}}.
 * meta — {sourceLabel, generated}.
 */
export function dataset(cfg, d, texts = {}, meta = {}) {
  const ents = d ? d.entities() : [];
  const countries = cfg.settings.entities.countries || {};
  const periods = d ? periodsFor(d, ents) : [];
  const records = [];
  for (const p of periods) {
    for (const e of ents) {
      const r = analyze(cfg, d, e, p);
      if (r.quality.some((q) => q.level === "error")) continue;
      records.push(record(cfg, r, pickText(cfg, r, texts[`${p.label}|${e}`])));
    }
  }
  const indMeta = {};
  for (const [k, spec] of Object.entries(cfg.indicators)) {
    const scored = Object.values(cfg.scoring.blocks).some((b) => b.indicators.includes(k));
    indMeta[k] = { n: spec.name, b: spec.block, u: spec.unit, f: spec.formula ?? "", norm: spec.norm ?? null, sc: scored };
  }
  return {
    source: "csv", sourceName: "CSV-файл",
    sourceLabel: meta.sourceLabel || (d ? d.source.label : "данные не загружены"),
    generated: meta.generated || "",
    entities: ents.map((e) => ({ e, name: d.name(e), country: countries[e] ?? "Без страны" })),
    periods: periods.filter((p) => records.some((r) => r.p === p.label)).map((p) => ({ p: p.label, k: p.kind, t: p.title })),
    blocks: cfg.scoring.order.blocks.map((k) => ({ k, n: cfg.scoring.blocks[k].name, w: cfg.scoring.blocks[k].weight,
      report: cfg.scoring.blocks[k].report })),
    classes: cfg.scoring.classes,
    heatmap: HEATMAP_KEYS,
    meta: indMeta,
    records,
  };
}
