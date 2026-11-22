/**
 * Источник данных: CSV-файлы ОПУ (pl.csv) и баланса (bs.csv) — как csv_source.py.
 *
 * Одна строка — одно юрлицо × месяц × статья, колонки COLUMNS:
 *     entity_code, company_name, year, month, code, value
 * company_name необязательна; строки с пустой суммой value пропускаются (незаполненные строки шаблона).
 * Разделитель «,» (точка в числах) или «;» (как сохраняет русский Excel, запятая в числах).
 * Кодировка UTF-8; файлы русского Excel в Windows-1251 тоже читаются.
 * По каждому юрлицу нужно не меньше min_months месяцев подряд (config/settings.toml, по умолчанию 15) без пропусков.
 * Всё выполняется в браузере: файлы никуда не отправляются.
 */
import { mon, monthRange, ym } from "./periods.js";

export const FILES = { pl: "pl.csv", bs: "bs.csv" };
export const TITLES = { pl: "ОПУ", bs: "баланс" };
export const COLUMNS = ["entity_code", "company_name", "year", "month", "code", "value"];
const REQUIRED = ["entity_code", "year", "month", "code", "value"];
const MAX_SHOWN = 20;
const MIN_MONTHS = 15;

export class CsvError extends Error {
  constructor(message, errors) {
    super(message);
    this.errors = errors || [message];
  }
}

export const minMonths = (cfg) => Math.trunc(Number((cfg.settings.params || {}).min_months ?? MIN_MONTHS));

/** UTF-8 (с BOM или без); если не получилось — Windows-1251. */
export function decode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(u8);
  } catch {
    return new TextDecoder("windows-1251").decode(u8);
  }
}

/** Строки CSV с учётом кавычек. Пустые строки пропускаются (как pandas). */
function splitCsv(text, sep) {
  const rows = [];
  let row = [], field = "", q = false, i = 0, any = false;
  const pushRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "" || any) rows.push(row);
    row = []; field = ""; any = false;
  };
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; any = true; i++; continue; }
    if (c === sep) { row.push(field); field = ""; any = true; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length || any) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === "" && r[0] === ""));
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Число как pd.to_numeric после удаления пробелов и замены запятой на точку; не число → NaN. */
function toNumber(s) {
  const t = String(s).replace(/ /g, "").replace(/ /g, "").replace(/,/g, ".");
  if (NUM_RE.test(t)) return parseFloat(t);
  if (/^[+-]?inf(inity)?$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  return NaN;
}

function coverage(rows, name, need) {
  const byEntity = new Map();
  for (const r of rows) {
    if (!byEntity.has(r.entity_code)) byEntity.set(r.entity_code, new Set());
    byEntity.get(r.entity_code).add(mon(r.year, r.month));
  }
  const errors = [];
  for (const e of [...byEntity.keys()].sort()) {
    const have = [...byEntity.get(e)].sort((a, b) => a - b);
    const first = have[0], last = have[have.length - 1];
    const span = first !== last ? `${ym(first)} … ${ym(last)}` : ym(first);
    const set = new Set(have);
    const gaps = monthRange(first, last).filter((m) => !set.has(m));
    if (gaps.length) {
      const shown = gaps.slice(0, 12).map(ym).join(", ") + (gaps.length > 12 ? ` и ещё ${gaps.length - 12}` : "");
      errors.push(`${name}: юрлицо ${e}: пропущены месяцы ${shown} (период ${span}) — нужны все месяцы подряд`);
    } else if (have.length < need) {
      errors.push(`${name}: юрлицо ${e}: данные за ${have.length} мес. (${span}), нужно не меньше ${need} месяцев подряд`);
    }
  }
  return errors;
}

/** Разбирает и проверяет текст одного файла. Все ошибки — сразу, списком (CsvError.errors). */
export function parse(text, name, form, cfg) {
  const body = String(text).replace(/^﻿/, "");
  const lines = body.split(/\r?\n/);
  if (!lines.some((l) => l.trim())) throw new CsvError(`${name}: файл пустой`);
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const rows = splitCsv(body, sep);
  const header = rows[0].map((c) => String(c).trim().toLowerCase());
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length > header.length) {
      throw new CsvError(`${name}: не удалось прочитать как CSV (строка ${r + 1}: полей ${rows[r].length}, ` +
        `а в заголовке ${header.length})`);
    }
  }
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new CsvError(`${name}: нет колонок ${missing.join(", ")} (нужны: ${COLUMNS.join(", ")})`);
  if (rows.length < 2) throw new CsvError(`${name}: нет строк с данными, только заголовок`);

  const col = Object.fromEntries(header.map((h, k) => [h, k]));
  const get = (r, c) => (col[c] === undefined ? undefined : String(r[col[c]] ?? "").trim());
  let df = rows.slice(1).map((r, idx) => ({
    idx, entity_code: get(r, "entity_code"), company_name: get(r, "company_name"), year: get(r, "year"),
    month: get(r, "month"), code: get(r, "code"), value: get(r, "value"),
  }));
  df = df.filter((r) => r.value !== "");   // пустая сумма — как будто строки нет
  if (!df.length) throw new CsvError(`${name}: не заполнена ни одна сумма (колонка value)`);
  if (col.company_name === undefined || df.every((r) => r.company_name === "")) df.forEach((r) => { r.company_name = r.entity_code; });

  const found = [];
  const checks = [
    ["пустой entity_code", (r) => r.entity_code === ""],
    ["пустой code", (r) => r.code === ""],
    ["год не число", (r) => { const y = toNumber(r.year); return Number.isNaN(y) || y % 1 !== 0; }],
    ["месяц не от 1 до 12", (r) => { const m = toNumber(r.month); return !(m >= 1 && m <= 12) || m % 1 !== 0; }],
    ["value не число", (r) => Number.isNaN(toNumber(r.value))],
  ];
  for (const [why, bad] of checks) for (const r of df) if (bad(r)) found.push([r.idx, why]);
  found.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  if (found.length) {
    const errors = found.slice(0, MAX_SHOWN).map(([i, why]) => `${name}: строка ${i + 2}: ${why}`);
    if (found.length > MAX_SHOWN) errors.push(`${name}: … и ещё ${found.length - MAX_SHOWN} ошибок`);
    throw new CsvError(errors.join("; "), errors);
  }

  const out = df.map((r) => ({ idx: r.idx, entity_code: r.entity_code, company_name: r.company_name,
    year: Math.trunc(toNumber(r.year)), month: Math.trunc(toNumber(r.month)), code: r.code, value: toNumber(r.value) }));
  const counts = new Map();
  for (const r of out) { const k = `${r.entity_code}|${r.year}|${r.month}|${r.code}`; counts.set(k, (counts.get(k) || 0) + 1); }
  const dup = out.filter((r) => counts.get(`${r.entity_code}|${r.year}|${r.month}|${r.code}`) > 1);
  if (dup.length) {
    throw new CsvError(`${name}: повторяются юрлицо + месяц + статья (строки ${dup.slice(0, MAX_SHOWN).map((r) => r.idx + 2).join(", ")})`);
  }
  const codesOf = (f) => new Set(Object.values(cfg.measures[f]).flatMap((m) => m.codes));
  const known = codesOf(form);
  const other = form === "pl" ? "bs" : "pl";
  const otherCodes = codesOf(other);
  const own = new Set([...known].filter((c) => !otherCodes.has(c)));   // коды, которых нет в другой форме
  if (!out.some((r) => own.has(r.code))) {
    throw new CsvError(`${name}: нет ни одной статьи ${TITLES[form]} из config/measures.toml — ` +
      `проверьте, что это файл ${TITLES[form]} (${FILES[form]}), а не ${TITLES[other]}`);
  }
  const short = coverage(out, name, minMonths(cfg));
  if (short.length) throw new CsvError(short.join("; "), short);
  return out.filter((r) => known.has(r.code)).map(({ idx, ...r }) => r);
}

/** Проверяет оба файла {pl: bytes, bs: bytes}; ошибки обоих — в одном CsvError. Возвращает {pl, bs, texts}. */
export function checkUpload(cfg, raw) {
  const texts = {}, frames = {}, errors = [];
  for (const form of ["pl", "bs"]) {
    const b = raw[form];
    if (!b || (b.length ?? b.byteLength) === 0) {
      errors.push(`Не выбран файл ${TITLES[form]} (${FILES[form]})`);
      continue;
    }
    texts[form] = typeof b === "string" ? b : decode(b);
    try {
      frames[form] = parse(texts[form], FILES[form], form, cfg);
    } catch (exc) {
      if (!(exc instanceof CsvError)) throw exc;
      errors.push(...exc.errors);
    }
  }
  if (errors.length) throw new CsvError(errors.join("; "), errors);
  return { pl: frames.pl, bs: frames.bs, texts };
}

/** Статьи формы для шаблона — [код, подсказка] в порядке config/measures.toml. */
export function templateLines(cfg, form) {
  const out = [];
  for (const m of Object.values(cfg.measures[form])) {
    const labels = m.labels || [];
    m.codes.forEach((code, i) => {
      const text = i < labels.length ? `${m.name}: ${labels[i]}` : m.name;
      out.push([code, m.hint ? `${text} (${m.hint})` : text]);
    });
  }
  return out;
}

const csvCell = (v) => {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Шаблон pl.csv / bs.csv (строка): месяц × статья, value пустое; «;», для Excel — с BOM. */
export function template(cfg, form, entity, company, months) {
  const lines = [[...COLUMNS, "line_name"].join(";")];
  for (const m of months) {
    for (const [code, text] of templateLines(cfg, form)) {
      lines.push([entity, company, Math.floor(m / 12), (m % 12) + 1, code, "", text].map(csvCell).join(";"));
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
