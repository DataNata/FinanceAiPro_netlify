/**
 * Витрина мер: юрлицо × месяц × меры Методики (Приложение А) из строк ОПУ и баланса — как measures.py.
 * Значение отсутствует — null (в Python — NaN / None).
 */
import { mon } from "./periods.js";

export const CSV_SOURCE = { key: "csv", label: "CSV-файлы pl.csv и bs.csv" };

export function buildMeasures(cfg, plRows, bsRows, source = CSV_SOURCE) {
  const available = { pl: new Set(), bs: new Set() };
  const columns = [];
  for (const [form, rows] of [["pl", plRows], ["bs", bsRows]]) {
    const prepared = rows.map((r) => ({ key: `${String(r.entity_code)}|${mon(r.year, r.month)}`,
      code: String(r.code).trim(), value: r.value }));
    for (const r of prepared) available[form].add(r.key);
    for (const [mkey, m] of Object.entries(cfg.measures[form])) {
      const codes = new Set(m.codes);
      const s = new Map();
      for (const r of prepared) if (codes.has(r.code)) s.set(r.key, (s.get(r.key) ?? 0) + r.value);   // в порядке строк
      columns.push({ form, mkey, missing: m.missing || "nan", sign: m.sign ?? 1, s });
    }
  }
  const wide = new Map();
  for (const k of new Set([...available.pl, ...available.bs])) {
    const row = {};
    for (const { form, mkey, missing, sign, s } of columns) {
      let v = s.has(k) ? s.get(k) * sign : null;
      if (v === null && missing === "zero" && available[form].has(k)) v = 0;   // форма за месяц есть, строки нет → 0
      row[mkey] = v;
    }
    wide.set(k, row);
  }
  const names = {};
  for (const rows of [plRows, bsRows]) for (const r of rows) names[String(r.entity_code)] = r.company_name;
  return new Data(wide, available, names, source);
}

/** Доступ к мерам: значение на месяц, оборот за месяцы, наличие форм. */
export class Data {
  constructor(wide, available, names, source = CSV_SOURCE) {
    Object.assign(this, { wide, available, names, source, cache: new Map() });
  }
  val(entity, key, month) {
    const row = this.wide.get(`${entity}|${month}`);
    if (!row) return null;
    const v = row[key];
    return v === undefined || v === null || Number.isNaN(v) ? null : v;
  }
  flow(entity, key, months) {
    let sum = 0;
    for (const m of months) {
      const v = this.val(entity, key, m);
      if (v === null) return null;
      sum += v;
    }
    return sum;
  }
  has(form, entity, month) { return this.available[form].has(`${entity}|${month}`); }
  months(form, entity) {
    const out = [];
    for (const k of this.available[form]) {
      const [e, m] = k.split("|");
      if (e === entity) out.push(+m);
    }
    return out.sort((a, b) => a - b);
  }
  entities() {
    const s = new Set();
    for (const form of Object.values(this.available)) for (const k of form) s.add(k.split("|")[0]);
    return [...s].sort();
  }
  name(entity) { return String(this.names[entity] ?? entity); }
}
