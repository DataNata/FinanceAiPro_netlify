// Проверка загрузки CSV — те же случаи, что в tests/test_core.py Python-версии.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCfg } from "./helpers.mjs";
import { checkUpload, template, templateLines, CsvError } from "../public/app/csv.js";
import { buildMeasures } from "../public/app/measures.js";
import { analyze } from "../public/app/analysis.js";
import { parsePeriod, monthRange, mon } from "../public/app/periods.js";

const cfg = loadCfg();
const COLS = ["entity_code", "company_name", "year", "month", "code", "value"];

/** Юрлицо T: 2024-01…2025-12 (24 мес.), как synthetic_raw() в Python-тестах. */
function synthetic(growth = 0.01, name = "T test") {
  const pl = [], bs = [];
  monthRange(mon(2024, 1), mon(2025, 12)).forEach((m, i) => {
    const y = Math.floor(m / 12), mo = (m % 12) + 1, rev = 1000 * (1 + growth) ** i;
    const row = (code, v, rows) => rows.push(["T", name, y, mo, code, v]);
    row("1000000000", rev, pl); row("2000000000", -0.85 * rev, pl); row("8000000000", 0.15 * rev, pl);
    row("9100000000", 0.05 * rev, pl); row("7000000000", 0.04 * rev, pl); row("6000000000", -0.01 * rev, pl);
    row("5001020100", -0.01 * rev, pl); row("4001070000", -0.005 * rev, pl); row("9400000000", 1500, pl);
    for (const [code, v] of Object.entries({ 1000000000: 3000, 2000000000: 3000, 1100000000: 300, 1200000000: 2700,
      1201000000: 1500, 1202010000: 600, 1206000000: 200, 2100000000: 200, 2200000000: 1800, 2300000000: 1000,
      2301010000: 100, 2201010000: 1200, 2101010000: 100, 2204030000: 300 })) row(code, v, bs);
  });
  return { pl, bs };
}
const toCsv = (rows, sep = ",", dec = ".") =>
  [COLS.join(sep), ...rows.map((r) => r.map((x) => (typeof x === "number" ? String(x).replace(".", dec) : x)).join(sep))].join("\n");
const utf8 = (s) => new TextEncoder().encode("﻿" + s);
function cp1251(s) {   // кодировщик Windows-1251 для теста (кириллица, Ё/ё, ASCII)
  return Uint8Array.from([...s].map((ch) => {
    const c = ch.codePointAt(0);
    if (c < 128) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    if (c === 0x401) return 0xa8;
    if (c === 0x451) return 0xb8;
    throw new Error("нет в cp1251: " + ch);
  }));
}
function uploadBytes(sep = ",", dec = ".", enc = utf8) {
  const { pl, bs } = synthetic(0.01, "Тест Кириллица");
  return { pl: enc(toCsv(pl, sep, dec)), bs: enc(toCsv(bs, sep, dec)) };
}

test("загрузка: UTF-8 и CSV русского Excel в Windows-1251", () => {
  for (const args of [[",", ".", utf8], [";", ",", cp1251]]) {
    const { pl, texts } = checkUpload(cfg, uploadBytes(...args));
    assert.deepEqual([...new Set(pl.map((r) => r.entity_code))], ["T"]);
    assert.equal(pl[0].company_name, "Тест Кириллица");
    assert.deepEqual(Object.keys(texts).sort(), ["bs", "pl"]);
  }
});

test("загрузка: ошибки обоих файлов — одним списком", () => {
  const raw = uploadBytes();
  const pl = new TextDecoder().decode(raw.pl).replace(/^﻿/, "").split("\n");
  pl[2] = pl[2].replace(",2024,1,", ",2024,13,");
  pl[5] = pl[5].slice(0, pl[5].lastIndexOf(",")) + ",abc";
  raw.pl = utf8(pl.join("\n"));
  raw.bs = utf8("entity_code,year,month\nT,2024,1\n");
  assert.throws(() => checkUpload(cfg, raw), (e) => {
    assert.ok(e instanceof CsvError);
    assert.ok(e.errors.includes("pl.csv: строка 3: месяц не от 1 до 12"));
    assert.ok(e.errors.includes("pl.csv: строка 6: value не число"));
    assert.ok(e.errors.some((x) => x.startsWith("bs.csv: нет колонок")));
    return true;
  });
});

test("загрузка: файлы перепутаны или одного нет", () => {
  const raw = uploadBytes();
  assert.throws(() => checkUpload(cfg, { pl: raw.bs, bs: raw.pl }), (e) => {
    assert.equal(e.errors.length, 2);
    assert.match(e.errors[0], /а не баланс/);
    return true;
  });
  assert.throws(() => checkUpload(cfg, { pl: raw.pl, bs: new Uint8Array() }),
    (e) => e.errors.includes("Не выбран файл баланс (bs.csv)"));
});

test("шаблон: пустой не принимается, заполненный — принимается, пустые суммы пропускаются", () => {
  const months = monthRange(mon(2025, 1), mon(2026, 3));   // 15 месяцев — минимум
  const plT = template(cfg, "pl", "X1", "Моя компания", months);
  const bsT = template(cfg, "bs", "X1", "Моя компания", months);
  assert.ok(plT.startsWith("﻿entity_code;company_name;year;month;code;value;line_name"));
  const nPl = templateLines(cfg, "pl").length, nBs = templateLines(cfg, "bs").length;
  assert.equal(plT.trimEnd().split("\r\n").length, 1 + 15 * nPl);
  assert.ok(bsT.includes("Краткосрочные банковские кредиты и овердрафты: Овердрафты"));
  assert.ok(plT.includes("(расход — со знаком «−»)"));
  assert.throws(() => checkUpload(cfg, { pl: utf8(plT), bs: utf8(bsT) }), /не заполнена ни одна сумма/);
  const fill = (text, skipEvery = 0) => utf8(text.replace(/^﻿/, "").trimEnd().split("\r\n").map((line, i) => {
    const c = line.split(";");
    if (i && !(skipEvery && i % skipEvery === 0)) c[5] = `${1000 + i},5`;
    return c.join(";");
  }).join("\n"));
  const { pl, bs } = checkUpload(cfg, { pl: fill(plT), bs: fill(bsT, 4) });
  assert.equal(pl.length, 15 * nPl);
  assert.equal(bs.length, 15 * nBs - Math.floor((15 * nBs) / 4));
  assert.equal(pl[0].value, 1001.5);
  assert.deepEqual([...new Set(pl.map((r) => r.company_name))], ["Моя компания"]);
});

test("минимум 15 месяцев подряд и пропуски месяцев", () => {
  const { pl, bs } = synthetic();
  const short = pl.filter((r) => r[2] * 12 + r[3] > 2024 * 12 + 10);   // 2024-11 … 2025-12 — 14 мес.
  assert.throws(() => checkUpload(cfg, { pl: utf8(toCsv(short)), bs: utf8(toCsv(bs)) }), (e) => {
    assert.deepEqual(e.errors, ["pl.csv: юрлицо T: данные за 14 мес. (2024-11 … 2025-12), нужно не меньше 15 месяцев подряд"]);
    return true;
  });
  const gap = bs.filter((r) => !(r[2] === 2025 && (r[3] === 2 || r[3] === 3)));
  assert.throws(() => checkUpload(cfg, { pl: utf8(toCsv(pl)), bs: utf8(toCsv(gap)) }),
    (e) => e.errors[0].startsWith("bs.csv: юрлицо T: пропущены месяцы 2025-02, 2025-03"));
  const ok = pl.filter((r) => r[2] * 12 + r[3] > 2024 * 12 + 9);      // ровно 15 мес. — принимается
  checkUpload(cfg, { pl: utf8(toCsv(ok)), bs: utf8(toCsv(bs)) });
  const cfg24 = { ...cfg, settings: { ...cfg.settings, params: { ...cfg.settings.params, min_months: 24 } } };
  assert.throws(() => checkUpload(cfg24, { pl: utf8(toCsv(ok)), bs: utf8(toCsv(bs)) }), /нужно не меньше 24/);
});

test("расчёт по загруженным файлам: обычный CSV и CSV русского Excel дают один результат", () => {
  const p = parsePeriod("2025-Q2");
  const scores = [[",", "."], [";", ","]].map(([sep, dec]) => {
    const { pl, bs } = checkUpload(cfg, uploadBytes(sep, dec));
    const r = analyze(cfg, buildMeasures(cfg, pl, bs), "T", p);
    return [r.scoring.score, r.values.ebit];
  });
  assert.deepEqual(scores[0], scores[1]);
  assert.ok(scores[0][0] > 0);
});
