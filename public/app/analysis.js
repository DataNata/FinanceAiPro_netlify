/** Полная оценка одного юрлица за период: расчёт → зоны → скоринг → стоп-факторы → сигналы → контроль данных. */
import { base, derive } from "./indicators.js";
import * as zones from "./zones.js";
import * as scoring from "./scoring.js";
import * as signals from "./signals.js";
import * as quality from "./quality.js";

function cachedBase(d, e, p) {
  const key = `base|${e}|${p.key}`;
  if (!d.cache.has(key)) d.cache.set(key, base(d, e, p));
  return d.cache.get(key);
}

export function analyze(cfg, d, e, p, withPrev = true) {
  const notes = new Set();
  const cur = { ...base(d, e, p, notes) };
  const py = cachedBase(d, e, p.priorYear);
  const hist = [1, 2, 3].map((k) => cachedBase(d, e, p.shift(k)));
  Object.assign(cur, derive(cfg.settings.params || {}, d, e, p, cur, py, hist));
  cur.annual_factor = p.annualFactor;

  const items = zones.evaluate(cfg, e, cur, py, hist);
  const sc = scoring.score(cfg, items);
  const stops = scoring.stopFactors(d, e, p, cur, hist[0]);
  const cls = scoring.classify(cfg, sc.score, stops);
  const result = {
    entity: e, company: d.name(e), period: p, source: d.source, values: cur, py, items, scoring: sc, cls, stops,
    signals: signals.evaluate(cfg, cur, py, hist, items), quality: quality.check(cfg, d, e, p), notes: [...notes].sort(),
  };
  if (withPrev) {
    const prev = analyze(cfg, d, e, p.shift(1), false);
    result.prev = { period: prev.period.label, score: prev.scoring.score, cls: prev.cls.code };
  }
  return result;
}
