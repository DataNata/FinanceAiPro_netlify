/** Зоны З / Ж / К (G / Y / R): правила из config/indicators.toml и нестандартные зоны Методики — как zones.py. */
import { g } from "./indicators.js";

export const ZONE_RU = { G: "З", Y: "Ж", R: "К" };
const isNum = (x) => x !== null && x !== undefined;

export function match(value, rules) {
  if (!isNum(value)) return null;
  for (const r of rules) {
    if ("lt" in r && !(value < r.lt)) continue;
    if ("le" in r && !(value <= r.le)) continue;
    if ("gt" in r && !(value > r.gt)) continue;
    if ("ge" in r && !(value >= r.ge)) continue;
    return r.zone;
  }
  return null;
}

/** Величина, к которой применяются правила зоны (поле on). */
export function basis(spec, key, cur, py) {
  const on = spec.on ?? "value";
  if (on === "value") return g(cur, key);
  if (on === "yoy_change") {
    const a = g(cur, key), b = g(py, key);
    return !isNum(a) || !isNum(b) || b <= 0 ? null : a / b - 1;
  }
  if (on === "yoy_pp") {
    const a = g(cur, key), b = g(py, key);
    return !isNum(a) || !isNum(b) ? null : a - b;
  }
  return g(cur, on);
}

function stab(level, long = false) {
  if (!isNum(level)) return null;
  if (level === "кризисная") return "R";
  if (long) return "G";
  return level === "минимальная" ? "Y" : "G";
}

/** v — текущий период, py — прошлый год, prev — предыдущий период. Возвращает [зона, пояснение]. */
export function customZone(key, v, py, prev, params, entity, marketRates) {
  if (key === "golden_rule") {
    if (!isNum(g(v, "golden_broken"))) return [null, null];
    if (v.golden_broken === 0) return ["G", null];
    return [g(v, "golden_bad") ? "R" : "Y", null];
  }
  if (key === "net_assets") {
    const na = g(v, "net_assets"), sc = g(v, "share_capital");
    if (!isNum(na)) return [null, null];
    if (na < 0 || (isNum(sc) && na < sc)) return ["R", "Чистые активы меньше уставного капитала или отрицательные"];
    if (isNum(g(prev, "net_assets")) && na < prev.net_assets) return ["Y", "Чистые активы снизились за период"];
    return ["G", null];
  }
  if (key === "inventory_share") {
    if (!isNum(g(v, "inventory_share"))) return [null, null];
    const gr = g(v, "inventory_share_growth") ?? 0;
    if (gr >= 3 && isNum(g(v, "t_sales")) && v.t_sales < 1) return ["R", `Доля запасов растёт ${gr} периода подряд при падении выручки`];
    if (gr >= 2) return ["Y", `Доля запасов растёт ${gr} периода подряд`];
    return ["G", null];
  }
  if (key === "nwc") {
    const nwc = g(v, "nwc"), nwcPy = g(py, "nwc");
    if (!isNum(nwc)) return [null, null];
    if (nwc < 0 && isNum(g(v, "bank_loans")) && isNum(g(py, "bank_loans")) && v.bank_loans > py.bank_loans) {
      return ["R", "ЧРК отрицательный при росте банковских кредитов"];
    }
    const ts = g(v, "t_sales");
    if (isNum(nwcPy) && isNum(ts)) {
      if ((nwcPy > 0 && nwc / nwcPy > ts) || (nwcPy <= 0 && 0 < nwc)) return ["Y", "ЧРК растёт быстрее выручки"];
    }
    return ["G", null];
  }
  if (key === "non_cash_wc") {
    const w = g(v, "non_cash_wc"), rev = g(v, "revenue");
    if (!isNum(w) || !isNum(rev)) return [null, null];
    const revYear = rev * (g(v, "annual_factor") ?? 1);
    if (revYear > 0 && w / revYear <= (params.non_cash_wc_near_zero ?? 0.02)) return ["G", null];
    const wPy = g(py, "non_cash_wc"), ts = g(v, "t_sales");
    if (isNum(wPy) && wPy > 0 && isNum(ts) && w / wPy > ts) return ["R", "Неденежный рабочий капитал растёт быстрее выручки"];
    return ["Y", null];
  }
  if (key === "fin_stab_current" || key === "fin_stab_short") return [stab(g(v, key)), null];
  if (key === "fin_stab_long") return [stab(g(v, key), true), null];
  if (key === "overtrading") {
    const c = g(v, "overtrading_count");
    if (!isNum(c)) return [null, null];
    return [c === 0 ? "G" : c <= 2 ? "Y" : "R", (g(v, "overtrading_signs") || []).join("; ") || null];
  }
  if (key === "roce") {
    const r = g(v, "roce"), w = g(v, "wacc");
    if (!isNum(r)) return [null, null];
    if (r >= 0.20) return ["G", null];
    if ((isNum(w) && r >= w) || (!isNum(w) && r >= 0)) return ["Y", null];
    return ["R", isNum(w) ? "ROCE ниже WACC" : null];
  }
  if (key === "roe") {
    const r = g(v, "roe");
    if (!isNum(r)) {
      if (isNum(g(v, "equity")) && v.equity <= 0) return ["R", "Собственный капитал отрицательный"];
      return [null, null];
    }
    const rd = g(v, "r_d");
    if (r < 0.15 || (isNum(rd) && r < rd)) {
      return ["R", isNum(rd) && r < rd && r >= 0.15 ? "ROE ниже ставки по кредитам" : null];
    }
    return [r < 0.25 ? "Y" : "G", null];
  }
  if (key === "r_d") {
    const rd = g(v, "r_d"), mkt = marketRates[entity] ?? null;
    if (!isNum(rd) || !isNum(mkt)) return [null, null];
    return [rd < mkt - 0.01 ? "G" : rd <= mkt + 0.01 ? "Y" : "R", null];
  }
  if (key === "bep") {
    const bep = g(v, "bep"), weak = g(v, "weak_revenue");
    if (!isNum(bep) || !isNum(weak)) return [null, null];
    const tol = params.bep_tolerance ?? 0.1;
    return [bep < weak * (1 - tol) ? "G" : bep <= weak * (1 + tol) ? "Y" : "R", null];
  }
  return [null, null];
}

/** Особые случаи, когда показатель не считается, но зона по смыслу Методики определена. */
export function overrideZone(key, v) {
  if (key === "leverage" && !isNum(g(v, "leverage")) && isNum(g(v, "equity")) && v.equity <= 0) {
    return ["R", "Собственный капитал отрицательный"];
  }
  if (key === "icr" && !isNum(g(v, "icr")) && g(v, "interest") === 0) return ["G", "Банковских процентов в периоде нет"];
  if ((key === "bank_debt_ebitda" || key === "net_bank_debt_ebitda") && !isNum(g(v, key))
      && (g(v, "bank_loans") || 0) > 0 && isNum(g(v, "ebitda_ltm")) && v.ebitda_ltm <= 0) {
    return ["R", "EBITDA за 12 месяцев отрицательная при наличии банковского долга"];
  }
  if (key === "spread_roce_wacc" && !isNum(g(v, key)) && isNum(g(v, "roce")) && v.roce < 0) {
    return ["R", "ROCE отрицательный — стоимость не создаётся (WACC не определён: ROE ≤ 0)"];
  }
  return null;
}

/** Ухудшение n периодов подряд (values: текущий, предыдущий, …). */
export function worsened(spec, key, values, n) {
  const better = spec.better;
  if ((better !== "higher" && better !== "lower") || values.length < n + 1 || values.slice(0, n + 1).some((x) => !isNum(x))) return false;
  for (let i = 0; i < n; i++) {
    const a = values[i], b = values[i + 1];
    if (!(better === "higher" ? a < b : a > b)) return false;
  }
  return true;
}

/** Зоны всех показателей из config/indicators.toml → {key: {value, zone, note, …}}. */
export function evaluate(cfg, entity, v, py, hist) {
  const params = cfg.settings.params || {};
  const market = Object.fromEntries(Object.entries(cfg.settings.market_rates || {}).map(([k, x]) => [String(k), Number(x)]));
  const prev = hist.length ? hist[0] : {};
  const n = Math.trunc(params.worsening_periods ?? 3);
  const out = {};
  for (const [key, spec] of Object.entries(cfg.indicators)) {
    let zone = null, note = null;
    const ov = overrideZone(key, v);
    if (ov) [zone, note] = ov;
    else if (spec.custom) [zone, note] = customZone(key, v, py, prev, params, entity, market);
    else if ("zones" in spec) zone = match(basis(spec, key, v, py), spec.zones);
    if (zone === "G" && worsened(spec, key, [g(v, key), ...hist.map((h) => g(h, key))], n)) {
      zone = "Y"; note = `Ухудшение в пределах зелёной зоны ${n} периода подряд`;
    }
    const on = spec.on ?? null;
    out[key] = {
      key, name: spec.name, block: spec.block, unit: spec.unit, value: g(v, key), zone, note,
      formula: spec.formula ?? "", norm: spec.norm ?? null, py_value: g(py, key),
      basis: on === "yoy_change" || on === "yoy_pp" ? basis(spec, key, v, py) : null, on,
    };
  }
  return out;
}

export function ratioZone(cfg, key, values) {
  const spec = cfg.indicators[key];
  return "zones" in spec ? match(g(values, key), spec.zones) : null;
}
