/**
 * Месяцы и отчётные периоды (месяц, квартал, год) — как periods.py.
 * Месяц — целое число: год × 12 + (месяц − 1). Так месяцы легко сдвигать и сравнивать.
 */

export const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const QUARTERS_RU = ["I", "II", "III", "IV"];
const KIND_N = { M: 1, Q: 3, Y: 12 };

export const mon = (year, month) => year * 12 + (month - 1);
export const yearOf = (m) => Math.floor(m / 12);
export const monthOf = (m) => (m % 12) + 1;
/** "2026-06" */
export const ym = (m) => `${yearOf(m)}-${String(monthOf(m)).padStart(2, "0")}`;
export function parseYm(s) {
  const r = /^(\d{4})-(\d{1,2})$/.exec(String(s).trim());
  if (!r || +r[2] < 1 || +r[2] > 12) throw new Error(`месяц «${s}»: ожидается ГГГГ-ММ`);
  return mon(+r[1], +r[2]);
}
export function daysInMonth(m) {
  return new Date(Date.UTC(yearOf(m), monthOf(m), 0)).getUTCDate();
}
export function monthRange(a, b) {
  const out = [];
  for (let m = a; m <= b; m++) out.push(m);
  return out;
}

export class Period {
  constructor(kind, end) { this.kind = kind; this.end = end; }
  get n() { return KIND_N[this.kind]; }
  /** Месяцы периода по возрастанию. */
  get months() { return monthRange(this.end - this.n + 1, this.end); }
  /** Месяц, на конец которого берётся баланс «на начало периода». */
  get begin() { return this.end - this.n; }
  get ltmMonths() { return monthRange(this.end - 11, this.end); }
  get days() { return this.months.reduce((s, m) => s + daysInMonth(m), 0); }
  get annualFactor() { return 12 / this.n; }
  shift(k = 1) { return new Period(this.kind, this.end - k * this.n); }
  get priorYear() { return new Period(this.kind, this.end - 12); }
  get label() {
    const y = yearOf(this.end), m = monthOf(this.end);
    return { M: ym(this.end), Q: `${y}-Q${Math.floor((m - 1) / 3) + 1}`, Y: `${y}` }[this.kind];
  }
  get title() {
    const y = yearOf(this.end), m = monthOf(this.end);
    return { M: `${MONTHS_RU[m - 1]} ${y} г.`, Q: `${QUARTERS_RU[Math.floor((m - 1) / 3)]} квартал ${y} г.`, Y: `${y} год` }[this.kind];
  }
  get kindName() { return { M: "месяц", Q: "квартал", Y: "год" }[this.kind]; }
  get key() { return this.kind + this.end; }
}

/** 2026-06 → месяц; 2026-Q2 → квартал; 2026 → год. */
export function parsePeriod(text) {
  const s = String(text).trim().toUpperCase();
  let r;
  if ((r = /^(\d{4})-Q([1-4])$/.exec(s))) return new Period("Q", mon(+r[1], +r[2] * 3));
  if ((r = /^(\d{4})-(\d{1,2})$/.exec(s)) && +r[2] >= 1 && +r[2] <= 12) return new Period("M", mon(+r[1], +r[2]));
  if ((r = /^(\d{4})$/.exec(s))) return new Period("Y", mon(+r[1], 12));
  throw new Error(`Период «${text}»: ожидается 2026-06, 2026-Q2 или 2026`);
}
