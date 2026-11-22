/** Контроль данных перед расчётом (раздел 8.1, этап 2 Методики) — как quality.py. */
import { ym } from "./periods.js";
import { pyGrouped, pyPercent0 } from "./fmt.js";

const isNum = (x) => x !== null && x !== undefined;

/** Замечания: level = error (расчёт недостоверен) | warning (часть показателей не определена) | info. */
export function check(cfg, d, e, p) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const params = cfg.settings.params || {};

  const missPl = p.months.filter((m) => !d.has("pl", e, m)).map(ym);
  if (missPl.length) add("error", `Нет ОПУ за месяцы периода: ${missPl.join(", ")}`);
  if (!d.has("bs", e, p.end)) add("error", `Нет баланса на конец периода (${ym(p.end)})`);
  if (!d.has("bs", e, p.begin)) add("warning", `Нет баланса на начало периода (${ym(p.begin)}): средние заменены значениями на конец`);
  const missPy = p.priorYear.months.filter((m) => !d.has("pl", e, m));
  if (missPy.length) add("warning", "Нет ОПУ за тот же период прошлого года — темпы роста, «золотое правило», DOL и тренды не определены");
  const missLtm = p.ltmMonths.filter((m) => !d.has("pl", e, m));
  if (missLtm.length) {
    add("warning", `ОПУ за 12 месяцев неполный (нет ${missLtm.length} мес.) — долг / EBITDA не определён, ` +
      "Z-модель — по оборотам периода, приведённым к году");
  }
  for (const m of [p.end, p.begin]) {
    const ta = d.val(e, "total_assets", m), le = d.val(e, "total_liabilities_equity", m);
    if (isNum(ta) && isNum(le) && Math.abs(ta - le) > (params.balance_check_tolerance ?? 1.0)) {
      add("error", `Баланс на ${ym(m)} не сходится: активы ${pyGrouped(ta, 0)} ≠ пассивы ${pyGrouped(le, 0)}`);
    }
  }
  const am = d.flow(e, "amortisation", p.months);
  if (!am) add("warning", "Амортизация в ОПУ не выделена — EBITDA и показатели на её основе не определены");
  const intr = d.flow(e, "interest_bank", p.months);
  const bank = [d.val(e, "bank_loans_lt", p.end), d.val(e, "bank_loans_st", p.end)].filter((x) => x).reduce((s, x) => s + x, 0);
  if (bank > 0 && !intr) {
    add("warning", "Есть банковские кредиты, но банковские проценты (Bank interest) за период равны нулю — " +
      "проверьте выделение процентов в ОПУ");
  }
  const invPl = d.val(e, "inventory_stat", p.end), invBs = d.val(e, "inventories", p.end);
  const tol = params.inventory_check_tolerance ?? 0.02;
  if (invPl && invBs && Math.abs(invPl - invBs) / Math.abs(invBs) > tol) {
    add("warning", `Запасы в ОПУ (${pyGrouped(invPl, 0)}) и в балансе (${pyGrouped(invBs, 0)}) расходятся на ` +
      `${pyPercent0(Math.abs(invPl - invBs) / Math.abs(invBs))}; в расчёте — баланс`);
  }
  const eq = d.val(e, "equity", p.end);
  if (isNum(eq) && eq <= 0) add("warning", "Собственный капитал отрицательный — ROE, рычаг и DuPont не интерпретируются");
  return out;
}
