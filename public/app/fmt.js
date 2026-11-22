/**
 * Форматирование чисел — как fmt.py. Округление как в Python (точное значение числа, половина — к чётному),
 * чтобы тексты совпадали с Python-версией до знака.
 */

export const NBSP = " ";

/** Неотрицательное число → строка с dec знаками после точки, без разделителей (как Python f"{x:.{dec}f}"). */
function fixedAbs(x, dec) {
  const s = x.toFixed(dec);
  if (x >= 1e21) return s;
  const full = x.toFixed(100);                       // точное десятичное представление двоичного числа
  const dot = full.indexOf(".");
  const tail = full.slice(dot + 1 + dec);
  if (!/^50*$/.test(tail)) return s;                  // не ровно половина — toFixed округлил верно
  const kept = full.slice(0, dot + 1 + dec).replace(/\.$/, "");
  const lastDigit = +kept.replace(".", "").slice(-1);
  return lastDigit % 2 === 0 ? kept : s;               // половина: к чётному
}

/** Как Python f"{x:.{dec}f}" (знак «-»). */
export function pyFixed(x, dec) {
  if (!Number.isFinite(x)) return x > 0 ? "inf" : x < 0 ? "-inf" : "nan";
  const s = fixedAbs(Math.abs(x), dec);
  return x < 0 || Object.is(x, -0) ? "-" + s : s;   // Python оставляет знак и у «-0.0»
}

/** Как Python f"{x:,.{dec}f}": разделитель тысяч — запятая, дробная часть — точка. */
export function pyGrouped(x, dec) {
  const s = pyFixed(x, dec);
  const neg = s.startsWith("-");
  const [int, frac] = (neg ? s.slice(1) : s).split(".");
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + g + (frac !== undefined ? "." + frac : "");
}

/** Как Python round(x, dec) == 0. */
export const roundsToZero = (x, dec) => Number(pyFixed(x, dec)) === 0;

/** 1 234 567,8 (неразрывный пробел, минус «−»); None → «н/д». */
export function num(x, dec = 1) {
  if (x === null || x === undefined) return "н/д";
  if (roundsToZero(x, dec)) x = 0;   // без «−0»
  return pyGrouped(x, dec).replace(/,/g, NBSP).replace(".", ",").replace("-", "−");
}

export function value(v, unit) {
  if (v === null || v === undefined) return "н/д";
  if (unit === "text") return String(v);
  if (unit === "ratio") return num(v, 2);
  if (unit === "pct") return num(v * 100, 1) + "%";
  if (unit === "pp") return num(v * 100, 1) + " п. п.";
  if (unit === "days") return num(v, 0) + " дн.";
  if (unit === "money") return num(v / 1000, 0) + " тыс. USD";
  if (unit === "index") return num(v * 100, 1) + "%";
  return String(v);
}

/** Изменение к прошлому году для таблиц отчёта. */
export function change(item) {
  const cur = item.value, py = item.py_value, unit = item.unit;
  if (cur === null || cur === undefined || py === null || py === undefined || unit === "text" || unit === "index"
      || typeof cur === "string") return "";
  if (unit === "pct" || unit === "pp") return (cur >= py ? "+" : "") + num((cur - py) * 100, 1) + " п. п.";
  if (unit === "days") return (cur >= py ? "+" : "") + num(cur - py, 0) + " дн.";
  if (py !== 0 && (unit === "money" || unit === "ratio")) {
    return py > 0 ? (cur >= py ? "+" : "") + num((cur / py - 1) * 100, 0) + "%" : "";
  }
  return "";
}

/** Python f"{x:.0%}" */
export const pyPercent0 = (x) => pyFixed(x * 100, 0) + "%";
