"""Эталон для сверки JS-расчёта с Python-версией → tests/golden/*.json.

Считает Python-версией (проект FinanceAiPro_data JS) те же CSV, что лежат в public/examples, и сохраняет
баллы, классы, зоны, значения показателей, сигналы, контроль данных и шаблонный текст по каждому юрлицу × периоду.
Тест tests/parity.test.mjs пересчитывает то же на JS и сравнивает.

Запуск (Python-окружение исходного проекта):
  "..\\FinanceAiPro_data JS\\.venv\\Scripts\\python" tests\\make_golden.py
Путь к Python-проекту можно задать переменной FINANCEAI_PY.
"""
import json
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PY_PROJECT = Path(os.getenv("FINANCEAI_PY", ROOT.parent / "FinanceAiPro_data JS"))
sys.path.insert(0, str(PY_PROJECT / "src"))

from financeai import csv_source, dashboard, fmt, narrative  # noqa: E402
from financeai.analysis import analyze  # noqa: E402
from financeai.config import CONFIG_DIR, load_config, load_toml  # noqa: E402
from financeai.measures import build_measures  # noqa: E402

DATASETS = {"alisa": ROOT / "public" / "examples" / "alisa", "mary": ROOT / "public" / "examples" / "mary"}
# Эталон на данных с реальной структурой (не публикуется: tests/ не входит в сайт)
CHANGED = PY_PROJECT / "data" / "csv" / "examples" / "changed"
if CHANGED.is_dir():
    DATASETS["changed"] = CHANGED


def clean(x):
    """JSON без NaN / inf; Period → метка."""
    if isinstance(x, float):
        return None if math.isnan(x) or math.isinf(x) else x
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if hasattr(x, "label") and hasattr(x, "kind"):
        return x.label
    return x


def main():
    cfg = load_config()
    out_dir = HERE / "golden"
    out_dir.mkdir(exist_ok=True)
    # Настройки как их читает Python (tomllib) — для проверки разбора TOML на JS
    configs = {p.stem: load_toml(p.name) for p in sorted(CONFIG_DIR.glob("*.toml"))}
    (out_dir / "config.json").write_text(json.dumps(clean(configs), ensure_ascii=False, indent=1), encoding="utf-8")

    for name, folder in DATASETS.items():
        pl, bs = csv_source.load_csv(cfg, folder)
        d = build_measures(cfg, pl, bs)
        ents = d.entities()
        recs = []
        for p in dashboard._periods(d, ents):
            for e in ents:
                r = analyze(cfg, d, e, p)
                values = {k: v for k, v in r["values"].items() if isinstance(v, (int, float)) or v is None}
                recs.append({
                    "p": p.label, "kind": p.kind, "e": e, "score": r["scoring"]["score"], "cls": r["cls"]["code"],
                    "capped": r["cls"]["capped"], "stops": r["stops"],
                    "blocks": [[b["key"], b["score"], b["points"], b["max"]] for b in r["scoring"]["blocks"]],
                    "signals": [[s["code"], s["zone"], s["fact"]] for s in r["signals"]],
                    "items": {k: [i["value"], i["zone"], i["note"], fmt.value(i["value"], i["unit"]), fmt.change(i)]
                              for k, i in r["items"].items()},
                    "quality": [[q["level"], q["text"]] for q in r["quality"]], "notes": r["notes"],
                    "prev": r.get("prev"), "values": values,
                    "dupont": r["values"].get("dupont"),
                    "template": narrative.template_text(cfg, r),
                    "payload": narrative.payload(cfg, r),
                })
        doc = {"dataset": name, "entities": ents, "names": {e: d.name(e) for e in ents}, "records": recs}
        (out_dir / f"{name}.json").write_text(json.dumps(clean(doc), ensure_ascii=False), encoding="utf-8")
        print(f"{name}: {len(recs)} записей")


if __name__ == "__main__":
    main()
