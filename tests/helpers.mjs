// Общее для тестов: настройки и CSV читаются с диска, как их загрузил бы браузер.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { makeConfig, CONFIG_FILES } from "../public/app/config.js";
import { checkUpload } from "../public/app/csv.js";
import { buildMeasures } from "../public/app/measures.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function loadCfg() {
  return makeConfig(Object.fromEntries(CONFIG_FILES.map((n) => [n, readFileSync(join(ROOT, "config", `${n}.toml`), "utf8")])));
}

export const golden = (name) => {
  const f = join(ROOT, "tests", "golden", `${name}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};

/** Папка с pl.csv и bs.csv → Data (через ту же проверку, что при загрузке с панели). */
export function loadFolder(cfg, folder) {
  const raw = { pl: readFileSync(join(folder, "pl.csv")), bs: readFileSync(join(folder, "bs.csv")) };
  const { pl, bs } = checkUpload(cfg, raw);
  return buildMeasures(cfg, pl, bs);
}
