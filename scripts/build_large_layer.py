#!/usr/bin/env python3
"""Turn the large-fire outputs into the "large" layer that build_forecast.py merges into forecast.js.

Pipeline (California only):
  .venv/bin/python scripts/build_large_fires.py --out DIR      # perimeters -> DIR/large_*.json
  .venv/bin/python scripts/build_large_layer.py DIR            # -> forecast_inputs/large.json
  .venv/bin/python scripts/build_forecast.py --merge-only      # -> forecast.js gets CA.large

The layer keeps the shape the forecast contract asks for (p, county, event, method,
backtest) and adds what the page needs to show large-fire history ("past odds"):
the marked hexagon-months as flat pairs and the per-county rows. The "history alone"
arrays of large_forecast.json are left out: the page recomputes them from the pairs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_layer(hex_months: dict, fc: dict) -> dict:
    hm, fm = hex_months["meta"], fc["meta"]
    viirs = hm.get("firms_check", {}).get("viirs", {})
    modis = hm.get("firms_check", {}).get("modis", {})
    return {
        "p": fc["p"],
        "county": fc["county"],
        "event": "at least one large fire (1,000 acres or more on CAL FIRE's fire perimeter maps) that started in the month and reached the hexagon or county",
        "method": fm["method"],
        "is_forecast": fm["is_forecast"],
        "backtest": {
            "design": fm["backtest_design"],
            "hex": fm["hex"]["backtest"],
            "county": fm["county"]["backtest"],
        },
        "coefficients": {"hex": fm["hex"]["coefficients_standardized"], "county": fm["county"]["coefficients_standardized"]},
        "past": {
            "years": [2001, 2025],
            "pairs": hex_months["pairs"],
            "pairs_layout": "flat pairs: hexagon index (BURN_DATA.states.CA.hexes rows), month index i = (year-2001)*12 + (month-1)",
            "county_rows": hex_months["county_rows"],
            "county_rows_layout": hex_months["county_rows_layout"],
        },
        "definition": hm["definition"],
        "hex_rule": hm["hex_rule"],
        "county_rule": hm["county_rule"],
        "limits": hm["limits"],
        "large_fires": hm["large_fires"],
        "hex_months": hm["hex_months"],
        "hexagons_ever_marked": hm["hexagons_ever_marked"],
        "firms_inside": {
            "viirs": viirs.get("share_inside_during_fire"),
            "modis": modis.get("share_inside_during_fire"),
            "viirs_by_year": viirs.get("by_year_share_inside_during_fire"),
            "note": viirs.get("note"),
        },
        "source": hm["source"],
        "source_url": hm["source_url"],
        "source_page": hm["source_page"],
        "credit": hm["credit"],
        "retrieved": hm["retrieved"],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="the --out folder of build_large_fires.py (large_hex_months.json, large_forecast.json)")
    ap.add_argument("--out", default=os.path.join(ROOT, "forecast_inputs", "large.json"))
    a = ap.parse_args(argv)
    with open(os.path.join(a.src, "large_hex_months.json"), encoding="utf-8") as f:
        hex_months = json.load(f)
    with open(os.path.join(a.src, "large_forecast.json"), encoding="utf-8") as f:
        fc = json.load(f)
    layer = build_layer(hex_months, fc)
    if len(layer["past"]["pairs"]) % 2 or len(layer["past"]["county_rows"]) % 4:
        raise ValueError("pairs must come in twos and county rows in fours")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"CA": {"large": layer}}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {a.out}: {len(layer['p'])} hexagon values, {len(layer['past']['pairs']) // 2} past hexagon-months", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
