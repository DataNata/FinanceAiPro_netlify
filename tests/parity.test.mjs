// Сверка JS-расчёта с Python-версией: tests/golden/*.json делает tests/make_golden.py.
// Для каждого юрлица × периода совпадать должны балл, класс, стоп-факторы, сигналы, зоны и значения всех
// показателей, тексты значений, контроль данных, шаблонный текст и данные для LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadCfg, golden, loadFolder } from "./helpers.mjs";
import { analyze } from "../public/app/analysis.js";
import { periodsFor } from "../public/app/dataset.js";
import { templateText, payload } from "../public/app/narrative.js";
import { parseToml } from "../public/app/toml.js";
import { readFileSync } from "node:fs";

const cfg = loadCfg();
const PY_PROJECT = process.env.FINANCEAI_PY || join(ROOT, "..", "FinanceAiPro_data JS");
const FOLDERS = {
  alisa: join(ROOT, "public", "examples", "alisa"),
  mary: join(ROOT, "public", "examples", "mary"),
  changed: join(PY_PROJECT, "data", "csv", "examples", "changed"),
};

function close(a, b, where) {
  if (a === null || b === null || typeof a !== "number" || typeof b !== "number") {
    assert.deepEqual(a, b, where);
    return;
  }
  const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  assert.ok(Math.abs(a - b) <= tol, `${where}: JS ${a} ≠ Python ${b}`);
}

function deepClose(a, b, where) {
  if (typeof a === "number" || typeof b === "number") return close(a ?? null, b ?? null, where);
  if (Array.isArray(b)) {
    assert.ok(Array.isArray(a), `${where}: не массив`);
    assert.equal(a.length, b.length, `${where}: длина`);
    b.forEach((x, i) => deepClose(a[i], x, `${where}[${i}]`));
    return;
  }
  if (b && typeof b === "object") {
    assert.deepEqual(Object.keys(a || {}).sort(), Object.keys(b).sort(), `${where}: ключи`);
    for (const k of Object.keys(b)) deepClose(a[k], b[k], `${where}.${k}`);
    return;
  }
  assert.deepEqual(a ?? null, b ?? null, where);
}

test("TOML: настройки разбираются так же, как tomllib в Python", () => {
  const g = golden("config");
  if (!g) return;
  for (const name of Object.keys(g)) {
    const js = parseToml(readFileSync(join(ROOT, "config", `${name}.toml`), "utf8"));
    assert.deepEqual(js, g[name], name);
  }
});

for (const [name, folder] of Object.entries(FOLDERS)) {
  test(`сверка с Python: ${name}`, { skip: !golden(name) || !existsSync(folder) }, () => {
    const g = golden(name);
    const d = loadFolder(cfg, folder);
    assert.deepEqual(d.entities(), g.entities);
    const periods = periodsFor(d, d.entities());
    const labels = periods.flatMap((p) => d.entities().map((e) => `${p.label}|${e}`));
    assert.deepEqual(labels, g.records.map((r) => `${r.p}|${r.e}`), "набор периодов");
    let n = 0;
    for (const p of periods) {
      for (const e of d.entities()) {
        const exp = g.records[n++];
        const where = `${name} ${exp.p} ${e}`;
        const r = analyze(cfg, d, e, p);
        close(r.scoring.score, exp.score, `${where} балл`);
        assert.equal(r.cls.code, exp.cls, `${where} класс`);
        assert.equal(r.cls.capped, exp.capped, `${where} ограничение класса`);
        assert.deepEqual(r.stops, exp.stops, `${where} стоп-факторы`);
        deepClose(r.scoring.blocks.map((b) => [b.key, b.score, b.points, b.max]), exp.blocks, `${where} блоки`);
        assert.deepEqual(r.signals.map((s) => [s.code, s.zone, s.fact]), exp.signals, `${where} сигналы`);
        for (const [k, [val, zone, note, text, change]] of Object.entries(exp.items)) {
          const it = r.items[k];
          close(it.value, val, `${where} ${k} значение`);
          assert.equal(it.zone, zone, `${where} ${k} зона`);
          assert.equal(it.note, note, `${where} ${k} примечание`);
          assert.equal((await_fmt(it)).text, text, `${where} ${k} текст`);
          assert.equal((await_fmt(it)).change, change, `${where} ${k} изменение`);
        }
        assert.deepEqual(r.quality.map((q) => [q.level, q.text]), exp.quality, `${where} контроль данных`);
        assert.deepEqual(r.notes, exp.notes, `${where} примечания`);
        deepClose(r.prev, exp.prev, `${where} прошлый период`);
        for (const [k, val] of Object.entries(exp.values)) close(r.values[k] ?? null, val, `${where} ${k}`);
        deepClose(r.values.dupont, exp.dupont, `${where} DuPont`);
        assert.deepEqual(templateText(cfg, r), exp.template, `${where} шаблонный текст`);
        assert.deepEqual(payload(cfg, r), exp.payload, `${where} данные для LLM`);
      }
    }
  });
}

import * as fmt from "../public/app/fmt.js";
function await_fmt(it) { return { text: fmt.value(it.value, it.unit), change: fmt.change(it) }; }
