/** Сигналы раннего предупреждения (раздел 7 Методики) — как signals.py. Тексты — config/signals.toml. */
import { g } from "./indicators.js";
import { ratioZone } from "./zones.js";
import { pyGrouped } from "./fmt.js";

const isNum = (x) => x !== null && x !== undefined;
const gt = (a, b, k = 1) => isNum(a) && isNum(b) && a > b * k;
/** Как fmt() в signals.py: группы тысяч — обычный пробел, дробная часть — запятая. */
const f = (x, unit = "", dec = 1) => (!isNum(x) ? "—" : pyGrouped(x, dec).replace(/,/g, " ").replace(".", ",") + unit);

export function evaluate(cfg, v, py, hist, items) {
  const h1 = hist.length > 0 ? hist[0] : {};
  const h2 = hist.length > 1 ? hist[1] : {};
  const ts = g(v, "t_sales");
  const fired = [];

  if (gt(g(v, "dio"), g(h1, "dio")) && gt(g(h1, "dio"), g(h2, "dio")) && gt(g(v, "inventory_share"), g(h1, "inventory_share"))) {
    fired.push(["dio_up", items.dio.zone || "Y", `DIO ${f(g(h2, "dio"))} → ${f(g(h1, "dio"))} → ${f(g(v, "dio"))} дн.`]);
  }
  if (gt(g(v, "dso"), g(h1, "dso")) && isNum(ts) && Math.abs(ts - 1) < 0.05) {
    fired.push(["dso_up", items.dso.zone || "Y",
      `DSO ${f(g(h1, "dso"))} → ${f(g(v, "dso"))} дн. при выручке ${f((ts - 1) * 100, "%")} к прошлому году`]);
  }
  // DPO меньше 5 дней — сокращение не информативно (поставщики почти не финансируют оборот).
  if (isNum(g(v, "dpo")) && isNum(g(h1, "dpo")) && h1.dpo >= 5 && v.dpo < h1.dpo * 0.95) {
    fired.push(["dpo_down", items.dpo.zone || "Y", `DPO ${f(h1.dpo)} → ${f(v.dpo)} дн.`]);
  }
  if (isNum(g(v, "ccc")) && v.ccc > 30) fired.push(["ccc_high", "R", `Денежный цикл ${f(v.ccc)} дн.`]);
  const signs = g(v, "overtrading_signs") || [];
  if (isNum(ts) && ts > 1 && signs.includes("Рост текущих обязательств и запасов") && signs.includes("Падение текущей ликвидности")) {
    fired.push(["overtrading", items.overtrading.zone || "Y",
      `Выручка ${f((ts - 1) * 100, "%")}, КТЛ ${f(g(py, "current_ratio"), "", 2)} → ${f(g(v, "current_ratio"), "", 2)}`]);
  }
  const gm = g(v, "gross_margin"), gmPy = g(py, "gross_margin");
  if (isNum(gm) && isNum(gmPy) && gm - gmPy < -0.01) {
    fired.push(["gm_down", items.gross_margin.zone || "Y", `Валовая маржа ${f(gmPy * 100, "%")} → ${f(gm * 100, "%")}`]);
  }
  const dol = g(v, "dol");
  if (isNum(dol) && (dol > 5 || dol < 0)) fired.push(["dol_high", "R", `DOL ${f(dol)}`]);
  const icr = g(v, "icr"), de = g(v, "bank_debt_ebitda");
  if ((g(v, "interest") && isNum(icr) && icr < 2) || (isNum(de) && de > 3.5)) {
    fired.push(["debt_high", "R", `Покрытие процентов ${f(icr, "", 2)}, долг / EBITDA ${f(de, "", 2)}`]);
  }
  if (isNum(g(v, "differential")) && v.differential < 0.05) {
    fired.push(["differential_low", items.differential.zone || "Y", `ROA* − i = ${f(v.differential * 100, " п. п.")}`]);
  }
  if (ratioZone(cfg, "z5", v) === "Y" && ratioZone(cfg, "z5", h1) === "Y") {
    fired.push(["z_yellow", "Y", `Z5 ${f(g(h1, "z5"))} → ${f(g(v, "z5"))}`]);
  }
  return fired.map(([code, zone, fact]) => ({ code, zone, fact, ...cfg.signals[code],
    deadline: zone === "R" ? "5 рабочих дней" : "30 дней" }));
}
