"""Check summary/v3 against summary/v2 and against itself.
Usage: validate_v3.py V2_DIR V3_DIR  (prints a report; exits non-zero on any failure)"""
import json, sys
from pathlib import Path

V2, V3 = Path(sys.argv[1]), Path(sys.argv[2])
NEW = {"last_date", "n_months", "partial", "sensor_last", "y2026"}
CHANGED = {"v", "y1", "filter", "monthly", "cells", "cell_rows", "totals", "bbox", "source"}
fail = []
i2 = json.load(open(V2 / "index.json"))
i3 = json.load(open(V3 / "index.json"))
e3 = {e["country"]: e for e in i3["countries"]}
assert i3["v"] == 3 and i3["y1"] == 2026 and len(i3["countries"]) == len(i2["countries"])
world = {"V26": 0, "N2026": 0, "cells_h": 0.0, "v_obs": 0, "modis": 0}
nrows_new = 0
for e in i2["countries"]:
    c = e["country"]
    a = json.load(open(V2 / f"{c}.json"))
    b = json.load(open(V3 / f"{c}.json"))
    n = b["n_months"]
    if set(b) != set(a) | NEW:
        fail.append((c, "keys", set(b) ^ (set(a) | NEW)))
    for k in a:
        if k not in CHANGED and a[k] != b[k]:
            fail.append((c, "unchanged key differs", k))
    if b["v"] != 3 or b["y1"] != 2026 or n != 311 or b["y0"] != a["y0"]:
        fail.append((c, "header"))
    if not b["filter"].startswith(a["filter"]):
        fail.append((c, "filter"))
    for s in ("T", "A", "V", "N20"):
        if b["monthly"][s][:300] != a["monthly"][s]:
            fail.append((c, "monthly 2001-2025 differs", s))
        if len(b["monthly"][s]) != n:
            fail.append((c, "monthly length", s))
        if b["totals"][s] != sum(b["monthly"][s]):
            fail.append((c, "totals != sum(monthly)", s))
        if sum(b["monthly"][s][:300]) != a["totals"][s]:
            fail.append((c, "2001-2025 part of totals != v2 totals", s))
    if b["cells"][:len(a["cells"])] != a["cells"] or b["cell"] != a["cell"]:
        fail.append((c, "cells prefix"))
    L = len(a["cell_rows"])
    if b["cell_rows"][:L] != a["cell_rows"]:
        fail.append((c, "cell_rows 2001-2025 differ"))
    new = b["cell_rows"][L:]
    nrows_new += len(new) // 5
    if any(new[p + 1] != 25 for p in range(0, len(new), 5)) or any(new[p] >= len(b["cells"]) // 2 for p in range(0, len(new), 5)):
        fail.append((c, "2026 cell rows: bad year or cell index"))
    y = b["y2026"]
    v26 = b["monthly"]["V"][300:]
    h = sum(new[p + 2] for p in range(0, len(new), 5))
    mo = sum(new[p + 3] for p in range(0, len(new), 5))
    vo = sum(new[p + 4] for p in range(0, len(new), 5))
    if vo != sum(y["v_obs"]):
        fail.append((c, "cell raw S-NPP != v_obs"))
    if mo != sum(b["monthly"]["T"][300:]) + sum(b["monthly"]["A"][300:]):
        fail.append((c, "cell raw MODIS != T+A 2026"))
    # harmonized cells: conversion is rounded per month in monthly.V and per cell (0.1) in cell_rows
    if abs(h - sum(v26)) > 1.0 * 11 + 0.05 * (len(new) // 5) + 1e-6:
        fail.append((c, "cell harmonized vs monthly V 2026", h, sum(v26)))
    if [o + v + q for o, v, q in zip(y["v_obs"], y["v_conv"], y["v_interp"])] != v26:
        fail.append((c, "V != v_obs + v_conv + v_interp"))
    for g in y["hist_gaps"]:
        if not (g["lo"] <= g["filled"] <= g["hi"]) or g["v2"] != a["monthly"]["V"][g["i"]]:
            fail.append((c, "hist_gaps entry", g["i"]))
    if any(not (lo <= v <= hi) for lo, v, hi in zip(y["v_lo"], v26, y["v_hi"])):
        fail.append((c, "V outside its range"))
    cm = {x["i"]: x for x in y["conv_months"]}
    for m in range(11):
        if (y["v_conv"][m] > 0 or y["v_interp"][m] > 0) and (300 + m) not in cm:
            fail.append((c, "converted month not listed", m))
    if y["same_days"]["cur"] != v26[-1] or y["ytd"]["cur"] != sum(v26) or y["same_days"]["cur_n20"] != b["monthly"]["N20"][-1]:
        fail.append((c, "current values"))
    bb, ba = b["bbox"], a["bbox"]
    if not (bb[0] <= ba[0] and bb[1] <= ba[1] and bb[2] >= ba[2] and bb[3] >= ba[3]):
        fail.append((c, "bbox shrank"))
    x = e3[c]
    if x["total_2001_2025"] != e["total"] or x["total"] != e["total"] + x["total_2026"] or x["total_2026"] != sum(v26):
        fail.append((c, "index totals"))
    if x["file"] != f"summary/v3/{c}.json" or x["bytes"] != (V3 / f"{c}.json").stat().st_size:
        fail.append((c, "index file/bytes"))
    world["V26"] += sum(v26); world["N2026"] += sum(b["monthly"]["N20"][300:]); world["cells_h"] += h
    world["v_obs"] += sum(y["v_obs"]); world["modis"] += mo
print(f"countries: {len(i2['countries'])}; new 2026 cell rows: {nrows_new:,}")
print(f"world 2026 to {i3['last_date']}: V (S-NPP terms) {world['V26']:,}, of which observed S-NPP {world['v_obs']:,}; "
      f"NOAA-20 {world['N2026']:,}; V/N20 {world['V26'] / world['N2026']:.4f}; harmonized cell sum {world['cells_h']:,.1f}; MODIS T+A {world['modis']:,}")
big = max((V3 / f).stat().st_size for f in [p.name for p in V3.glob("*.json")])
print(f"largest file {big:,} bytes")
if fail:
    print(f"FAILURES ({len(fail)}):")
    for f in fail[:50]:
        print("  ", f)
    sys.exit(1)
print("ALL CHECKS PASSED: v3 2001-2025 equals v2 exactly for every country (monthly T/A/V/N20, cells, cell_rows, rates, "
      "validation, all other fields); totals = sums of monthly arrays; 2026 cell rows sum to the monthly values; index totals consistent.")
