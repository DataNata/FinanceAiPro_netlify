/**
 * Формулы показателей Методики (разделы 3–5, 4.8) — как indicators.py. Ключи совпадают с config/indicators.toml.
 *
 * base()    — показатели одного периода (обороты ОПУ, баланс на конец, средние за период);
 * derive()  — показатели, которым нужен прошлый год или история (темпы, DOL, овертрейдинг, тренды).
 * Нерассчитываемый показатель — null (исключается из скоринга). Все суммы — USD.
 */

const isNum = (x) => x !== null && x !== undefined;
export const div = (a, b) => (!isNum(a) || !isNum(b) || b === 0 ? null : a / b);
export const add = (...xs) => (xs.some((x) => !isNum(x)) ? null : xs.reduce((s, x) => s + x, 0));
export const sub = (a, b) => (!isNum(a) || !isNum(b) ? null : a - b);
export const mul = (a, b) => (!isNum(a) || !isNum(b) ? null : a * b);
/** Как Python dict.get: отсутствующий ключ → null. */
export const g = (obj, k) => (obj && obj[k] !== undefined ? obj[k] : null);

/** Тест текущей / краткосрочной / долгосрочной финансовой устойчивости. */
export function stabilityLevel(cash, ar, inv, liab) {
  if ([cash, ar, inv, liab].some((x) => !isNum(x))) return null;
  if (cash >= liab) return "абсолютная";
  if (cash + ar >= liab) return "нормальная";
  if (cash + ar + inv >= liab) return "минимальная";
  return "кризисная";
}

export function base(d, e, p, notes = new Set()) {
  const ann = p.annualFactor;
  const flow = (k) => d.flow(e, k, p.months);
  const ltm = (k) => d.flow(e, k, p.ltmMonths);
  const end = (k) => d.val(e, k, p.end);
  const beg = (k) => d.val(e, k, p.begin);
  const avg = (...keys) => {
    const bEnd = add(...keys.map(end)), bBeg = add(...keys.map(beg));
    if (bEnd === null) return null;
    if (bBeg === null) {
      notes.add("Нет баланса на начало периода: средние значения статей заменены значениями на конец периода.");
      return bEnd;
    }
    return (bEnd + bBeg) / 2;
  };
  const v = { days: p.days };

  // --- ОПУ за период и EBIT / EBITDA (раздел 3.3) ---
  const rev = flow("revenue"), cogs = flow("cost_of_sales"), gp = flow("gross_profit");
  const pbt = flow("profit_before_tax"), ni = flow("net_profit"), tax = flow("income_tax");
  const intr = flow("interest_bank"), am = flow("amortisation");
  const ebit = add(pbt, intr);
  const ebitda = am ? add(ebit, am) : null;          // амортизация не выделена → EBITDA не определена
  Object.assign(v, { revenue: rev, cost_of_sales: cogs, gross_profit: gp, pbt, net_profit: ni, income_tax: tax,
    interest: intr, amortisation: am, ebit, ebitda });

  const revL = ltm("revenue"), niL = ltm("net_profit"), pbtL = ltm("profit_before_tax"),
    intrL = ltm("interest_bank"), amL = ltm("amortisation");
  const ebitL = add(pbtL, intrL);
  const ebitdaL = amL ? add(ebitL, amL) : null;
  Object.assign(v, { revenue_ltm: revL, net_profit_ltm: niL, ebit_ltm: ebitL, ebitda_ltm: ebitdaL });

  // --- Баланс на конец периода ---
  const ta = end("total_assets"), nca = end("non_current_assets"), ca = end("current_assets");
  const inv = end("inventories"), ar = end("trade_receivables"), cash = end("cash");
  const ncl = end("non_current_liabilities"), cl = end("current_liabilities"), eq = end("equity");
  const sc = end("share_capital"), tp = end("trade_payables");
  const blt = end("bank_loans_lt"), bst = end("bank_loans_st");
  const bank = add(blt, bst), liab = add(ncl, cl);
  Object.assign(v, { total_assets: ta, non_current_assets: nca, current_assets: ca, inventories: inv,
    trade_receivables: ar, cash, non_current_liabilities: ncl, current_liabilities: cl, equity: eq, share_capital: sc,
    trade_payables: tp, bank_loans: bank, bank_loans_st: bst, liabilities: liab });

  const t = isNum(pbt) && pbt > 0 ? div(tax, pbt) : null;
  v.tax_rate = t;
  const t0 = isNum(t) ? t : 0;

  // --- 4.1 Имущественное положение ---
  v.net_assets = sub(ta, liab);
  v.nca_share = div(nca, ta);
  v.inventory_share = div(inv, ta);

  // --- 4.2 Ликвидность ---
  v.current_ratio = div(ca, cl);
  v.quick_ratio = div(sub(ca, inv), cl);
  v.cash_ratio = div(cash, cl);
  v.balance_liquidity = div(add(cash, mul(0.5, ar), mul(0.3, inv)), add(sub(cl, bst), mul(0.5, bst), mul(0.3, ncl)));
  v.nwc = sub(ca, cl);
  v.non_cash_wc = sub(sub(ca, cash), cl);

  // --- 4.3 Финансовая устойчивость ---
  v.autonomy = div(eq, ta);
  v.fin_dependence = div(liab, ta);
  v.leverage = isNum(eq) && eq > 0 ? div(liab, eq) : null;
  v.bank_debt_share = div(bank, add(eq, bank));
  v.icr = intr ? div(ebit, intr) : null;
  if (bank === 0) v.bank_debt_ebitda = 0;
  else v.bank_debt_ebitda = isNum(ebitdaL) && ebitdaL > 0 ? div(bank, ebitdaL) : null;
  const netDebt = sub(bank, cash);
  if (isNum(netDebt) && netDebt <= 0) v.net_bank_debt_ebitda = ebitdaL && ebitdaL > 0 ? div(netDebt, ebitdaL) : 0;
  else v.net_bank_debt_ebitda = isNum(ebitdaL) && ebitdaL > 0 ? div(netDebt, ebitdaL) : null;
  v.fin_stab_current = stabilityLevel(cash, ar, inv, tp);
  v.fin_stab_short = stabilityLevel(cash, ar, inv, add(tp, bst));
  v.fin_stab_long = stabilityLevel(cash, ar, inv, add(tp, bank));

  // --- 4.4 Деловая активность (средние за период) ---
  const aInv = avg("inventories"), aAr = avg("trade_receivables"), aTp = avg("trade_payables");
  const aTa = avg("total_assets"), aCa = avg("current_assets"), aNca = avg("non_current_assets"), aEq = avg("equity");
  const aLiab = avg("non_current_liabilities", "current_liabilities"), aBank = avg("bank_loans_lt", "bank_loans_st");
  const aCe = avg("equity", "non_current_liabilities");
  const revA = mul(rev, ann);
  v.dio = mul(div(aInv, cogs), p.days);
  v.dso = mul(div(aAr, rev), p.days);
  v.dpo = mul(div(aTp, cogs), p.days);
  v.ccc = sub(add(v.dio, v.dso), v.dpo);
  v.dpo_cover = div(v.dpo, add(v.dio, v.dso));
  v.asset_turnover = div(revA, aTa);
  v.ca_turnover = div(revA, aCa);
  v.nca_turnover = div(revA, aNca);
  v.equity_turnover = isNum(aEq) && aEq > 0 ? div(revA, aEq) : null;
  v.sales_nwc = isNum(v.nwc) && v.nwc > 0 ? div(revA, v.nwc) : null;

  // --- 4.5 Рентабельность ---
  v.gross_margin = div(gp, rev);
  v.ebitda_margin = div(ebitda, rev);
  v.ebit_margin = div(ebit, rev);
  v.net_margin = div(ni, rev);
  v.roa_star = div(mul(ebit, ann), aTa);
  v.roa_investors = div(mul(add(ni, mul(intr, 1 - t0)), ann), aTa);
  v.roce = div(mul(ebit, ann), aCe);
  v.roe = isNum(aEq) && aEq > 0 ? div(mul(ni, ann), aEq) : null;

  // --- 4.6 Стоимость капитала ---
  v.r_d = aBank ? div(mul(intr, ann), aBank) : null;
  v.r_e = v.roe;
  v.i_rate = div(mul(intr, ann), aLiab);
  v.differential = sub(v.roa_star, v.i_rate);
  let wacc = null;   // r_E = ROE; при ROE ≤ 0 стоимость собственного капитала не определена
  if (isNum(v.roe) && v.roe > 0 && isNum(eq) && isNum(bank) && eq + bank > 0) {
    if (bank === 0) wacc = v.roe;
    else if (isNum(v.r_d)) wacc = v.roe * eq / (eq + bank) + v.r_d * bank / (eq + bank) * (1 - t0);
  }
  v.wacc = wacc;
  v.spread_roce_wacc = sub(v.roce, wacc);

  // --- 4.7 Финансовый рычаг ---
  v.dfl = div(ebit, pbt);

  // --- 4.8 Z-модели: статьи баланса на дату, ОПУ — годовые (LTM; если нет — период × 12 / n) ---
  let zRev = revL, zNi = niL, zEbit = ebitL;
  if ([zRev, zNi, zEbit].some((x) => !isNum(x))) {
    zRev = revA; zNi = mul(ni, ann); zEbit = mul(ebit, ann);
    if (isNum(zRev)) notes.add("Z-модель: ОПУ за 12 месяцев недоступен, использованы обороты периода, приведённые к году.");
  }
  const x = [div(v.nwc, ta), div(zNi, ta), div(zEbit, ta), div(eq, liab), div(zRev, ta)];
  v.z5 = x.some((y) => !isNum(y)) ? null : 0.717 * x[0] + 0.847 * x[1] + 3.107 * x[2] + 0.42 * x[3] + 0.995 * x[4];
  v.z5_factors = x;
  v.z2 = !isNum(v.current_ratio) || !isNum(v.fin_dependence) ? null
    : -0.3877 - 1.0736 * v.current_ratio + 0.579 * v.fin_dependence;

  // --- 5. Факторный анализ ---
  v.tb = div(ni, pbt);
  v.ib = div(pbt, ebit);
  v.om = v.ebit_margin;
  v.ta = v.asset_turnover;
  v.lr = isNum(aEq) && aEq > 0 ? div(aTa, aEq) : null;
  const de = isNum(aEq) && aEq > 0 ? div(aLiab, aEq) : null;
  v.roe_leverage = isNum(v.roa_star) && isNum(v.i_rate) && isNum(de)
    ? (1 - t0) * v.roa_star + (1 - t0) * (v.roa_star - v.i_rate) * de : null;
  v.de_avg = de;
  v.ce_turnover = div(revA, aCe);
  return v;
}

export const DUPONT = [["tb", "Налоговое бремя (TB)"], ["ib", "Банковское процентное бремя (IB)"],
  ["om", "Рентабельность по EBIT (OM)"], ["ta", "Оборачиваемость активов (TA)"], ["lr", "Финансовый рычаг (LR)"]];

/** Вклад факторов DuPont в изменение ROE методом цепных подстановок (прошлый год → текущий период). */
export function dupontChain(cur, prev) {
  const keys = DUPONT.map(([k]) => k);
  if (keys.some((k) => !isNum(g(cur, k)) || !isNum(g(prev, k)))) return null;
  const vals = keys.map((k) => prev[k]);
  const product = (xs) => xs[0] * xs[1] * xs[2] * xs[3] * xs[4];
  const out = [];
  let before = product(vals);
  DUPONT.forEach(([k, name], i) => {
    vals[i] = cur[k];
    const after = product(vals);
    out.push({ key: k, name, prev: prev[k], cur: cur[k], effect: after - before });
    before = after;
  });
  return out;
}

/** Показатели со сравнением: темпы к прошлому году, «золотое правило», DOL, овертрейдинг. */
export function derive(params, d, e, p, cur, py, hist) {
  const v = {};
  v.t_sales = g(py, "revenue") && py.revenue > 0 ? div(cur.revenue, py.revenue) : null;
  v.t_ebit = g(py, "ebit") && py.ebit > 0 ? div(cur.ebit, py.ebit) : null;
  v.t_assets = div(cur.total_assets, g(py, "total_assets"));

  const ts = v.t_sales, te = v.t_ebit, tas = v.t_assets;
  if (!isNum(ts) || !isNum(te) || !isNum(tas)) {
    v.golden_rule = null;
    v.golden_broken = null;
  } else {
    const broken = [!(te > ts), !(ts > tas), !(tas > 1)];
    const n = broken.filter(Boolean).length;
    v.golden_broken = n;
    v.golden_bad = tas > ts && te < 1;
    v.golden_rule = n === 0 ? "выполняется" : `нарушено звеньев: ${n} из 3`;
  }

  let dol = null;
  if (isNum(ts) && isNum(te) && Math.abs(ts - 1) >= (params.dol_min_sales_change ?? 0.005)) dol = (te - 1) / (ts - 1);
  v.dol = dol;
  v.margin_safety = isNum(dol) && dol > 0 ? 1 / dol : null;
  v.bep = isNum(dol) && dol > 0 && isNum(cur.revenue) ? cur.revenue * (1 - 1 / dol) : null;
  if (isNum(v.bep)) {
    // «Выручка слабых месяцев» — минимальная выручка за 12 месяцев, приведённая к длине периода.
    const monthly = p.ltmMonths.map((m) => d.val(e, "revenue", m)).filter(isNum);
    v.weak_revenue = monthly.length ? Math.min(...monthly) * p.n : null;
  }
  v.dtl = mul(dol, cur.dfl);
  if (isNum(dol) && dol < 0) v.dtl = v.dtl === null ? dol : -Math.abs(v.dtl);   // отрицательный DOL → красная зона

  // Тест на овертрейдинг (4.4): четыре признака
  const signs = [];
  if (isNum(ts)) signs.push(["Быстрый рост выручки", ts - 1 > (params.overtrading_revenue_growth ?? 0.2)]);
  if ([cur.current_liabilities, g(py, "current_liabilities"), cur.inventories, g(py, "inventories")].every(isNum)) {
    signs.push(["Рост текущих обязательств и запасов",
      cur.current_liabilities > py.current_liabilities && cur.inventories > py.inventories]);
  }
  const n = Math.trunc(params.overtrading_revenue_months ?? 3);
  const revN = d.flow(e, "revenue", Array.from({ length: n }, (_, i) => p.end - (n - 1 - i)));
  const stock = add(cur.inventories, cur.trade_receivables);
  if (isNum(revN) && isNum(stock)) signs.push([`Запасы + ДЗ больше выручки за ${n} мес.`, stock > revN]);
  if (isNum(cur.current_ratio) && isNum(g(py, "current_ratio"))) {
    signs.push(["Падение текущей ликвидности", cur.current_ratio < py.current_ratio]);
  }
  v.overtrading_signs = signs.filter(([, on]) => on).map(([name]) => name);
  v.overtrading = signs.length < 4 ? null : `признаков: ${v.overtrading_signs.length} из 4`;
  v.overtrading_count = signs.length === 4 ? v.overtrading_signs.length : null;

  // Доля запасов: сколько периодов подряд растёт
  const shares = [cur.inventory_share, ...hist.map((h) => g(h, "inventory_share"))];
  let growth = 0;
  for (let i = 0; i + 1 < shares.length; i++) {
    const a = shares[i], b = shares[i + 1];
    if (!isNum(a) || !isNum(b) || !(a > b)) break;
    growth++;
  }
  v.inventory_share_growth = growth;

  v.dupont = dupontChain(cur, py);
  return v;
}
