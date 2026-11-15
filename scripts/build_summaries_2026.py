#!/usr/bin/env python3
"""Build summary/v3: the per-country summaries of v2 (2001-2025, unchanged) extended with 2026 to date.

v3 = v2 + January 2026 to the last complete UTC day (2026-11-14). The 2026 values continue v2's series
with the same unit and filters:

  * One unit throughout: VIIRS hotspot detections (375 m pixels flagged as burning on one overpass) at
    nominal or high confidence, vegetation fires only, with the same-year 0.05 degree static-source mask.
    Counts measure fire activity, not the number of separate fires.
  * Suomi NPP (V) stays the reference series. Where S-NPP has no complete day in 2026 (outages in March-
    October, and every day after 1 November, when the satellite stopped), or its partial data miss a country's
    overpass hours, the day's count comes from NOAA-20 alone, times the country's NOAA-20-to-S-NPP rate for that
    calendar month, learned on 2018-2025 with the same shrinkage as the MODIS rates and backtested by holding out
    years. Where both satellites missed a country's overpasses (12 October), the day is the mean of the days
    either side. The two satellites are never added together: each country-day has one source (summary2026/daycls.py).
  * The last month is partial (1-14 November 2026) and December 2026 is absent, not zero: monthly arrays end
    at index 310. For like-for-like comparisons each file carries the same days (1-14 November) and the same
    year-to-date span in every year since 2012, from the daily archive with v2's exact filters.

Stages (run in order; each reads what the previous ones wrote in --work):
  modis-download  2026 MODIS world files from the FIRMS API (needs the key in ~/.firms_map_key)
  history         daily S-NPP and NOAA-20 counts per country, 2012-2025, from build/hf (read-only), v2 filters
  rates           NOAA-20 -> S-NPP rates and the held-out backtest (work/backtest_n20.txt)
  modis           2026 MODIS counts per country and 0.05 degree cell
  build           build/hf/summary/v3/<Country>.json and index.json
  check           v3 against v2 and its own totals (exits non-zero on any difference)
  spot            fresh FIRMS area requests against v3 2026 monthly values (work/spot_check_v3.txt)

Inputs from the 2026 fetch step (--raw): viirs-snpp_2026.parquet, viirs-noaa20_2026.parquet,
coverage_days.csv, daily_counts_2026.parquet, mask_2026_cells.parquet, validation/validation_2025_by_country.csv;
and its scripts folder (--fetch-scripts) for the FIRMS client (firms.py) and point-in-polygon (firms_pip.py).

Usage:
    .venv/bin/python scripts/build_summaries_2026.py --raw DIR --fetch-scripts DIR [--work DIR] [--out DIR]
        [--stages history,rates,modis,build,check]
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "scripts" / "summary2026"
V2 = ROOT / "build" / "hf" / "summary" / "v2"
ALL = ["modis-download", "history", "rates", "modis", "build", "check", "spot"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", type=Path, required=True)
    ap.add_argument("--fetch-scripts", type=Path, required=True)
    ap.add_argument("--work", type=Path, default=ROOT / "build" / "summary2026")
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "hf" / "summary" / "v3")
    ap.add_argument("--stages", default="history,rates,modis,build,check")
    a = ap.parse_args()
    a.work.mkdir(parents=True, exist_ok=True)
    py = [sys.executable, "-I"]
    env = dict(os.environ, Y2026_FETCH_SCRIPTS=str(a.fetch_scripts))
    cmds = {
        "modis-download": [str(HERE / "dl_modis.py"), str(a.work / "dl")],
        "history": [str(HERE / "daily_history.py"), str(a.work)],
        "rates": [str(HERE / "n20_rates.py"), str(a.work), str(V2 / "index.json")],
        "modis": [str(HERE / "modis_2026.py"), str(a.work / "dl"), str(a.raw), str(a.fetch_scripts), str(a.work)],
        "build": [str(HERE / "build_v3.py"), str(V2), str(a.raw), str(a.work), str(a.out)],
        "check": [str(HERE / "validate_v3.py"), str(V2), str(a.out)],
        "spot": [str(HERE / "spot_check_v3.py"), str(a.raw), str(a.out), str(a.work / "spot_check_v3.txt")],
    }
    for s in a.stages.split(","):
        if s not in ALL:
            raise SystemExit(f"unknown stage {s}; stages are {', '.join(ALL)}")
        print(f"== {s}", flush=True)
        subprocess.run(py + cmds[s], check=True, env=env)


if __name__ == "__main__":
    sys.exit(main())
