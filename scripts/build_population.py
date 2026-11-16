#!/usr/bin/env python3
"""Build pop.js: US Census Bureau population for every New York and California county.

Source: the Census Bureau's Population Estimates Program, Vintage 2025 county totals
(co-est2025-alldata.csv), column POPESTIMATE2025: the estimated resident population on
1 July 2025. It is a US government work in the public domain. Only New York (state FIPS 36)
and California (06) are kept: the state row (SUMLEV 040) and every county row (SUMLEV 050).

Counties are matched to data.js (window.BURN_DATA.states.<st>.counties) by their 5-digit FIPS
code, and the names are checked as well ("Kings County" against "Kings"). The build stops if a
data.js county has no census row, a census county is not in data.js, a name disagrees, or the
counties do not add up to the state row.

The population counts everyone who lives in the county, not the people near any fire.

Output (deterministic: the same CSV and data.js give the same bytes):
  window.POPULATION = {v, vintage, date, label, source, url, sha256,
                       states: {NY|CA: {fips, name, total, counties: {"36001": 316469, ...}}}}
with counties in data.js order. The page loads it with response.js and the other state extras
(src/extras.ts) and reads it through src/pop.ts.

Usage:
  python3 scripts/build_population.py                      # downloads the CSV to build/census/ once
  python3 scripts/build_population.py --csv co-est2025-alldata.csv --data data.js --out pop.js
"""
import argparse
import csv
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VINTAGE = 2025
URL = (
    "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/"
    "co-est2025-alldata.csv"
)
COLUMN = f"POPESTIMATE{VINTAGE}"
STATES = {"NY": "36", "CA": "06"}
SOURCE = (
    f"US Census Bureau, Population Estimates Program, Vintage {VINTAGE}: annual estimates of the "
    f"resident population for counties, 1 July {VINTAGE} (co-est{VINTAGE}-alldata.csv, {COLUMN})"
)


def fetch(dest: Path) -> None:
    """Download the census CSV once; the request carries a generic user agent and nothing else."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; data-fetch)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(dest)
    print(f"downloaded {URL} ({len(body):,} bytes) to {dest}")


def read_counties(data_js: Path) -> dict:
    """data.js counties per state, in page order: [{fips, name}, ...]"""
    s = data_js.read_text(encoding="utf-8")
    j = json.loads(s[s.index("{") : s.rindex("}") + 1])
    return {st: j["states"][st]["counties"] for st in STATES}


def read_census(csv_path: Path) -> dict:
    """{state FIPS: {"state": (name, pop), "counties": {5-digit FIPS: (name, pop)}}}"""
    out = {f: {"state": None, "counties": {}} for f in STATES.values()}
    with csv_path.open(newline="", encoding="latin-1") as fh:
        for row in csv.DictReader(fh):
            sf = row["STATE"].zfill(2)
            if sf not in out:
                continue
            pop = int(row[COLUMN])
            if row["SUMLEV"] == "040":
                out[sf]["state"] = (row["STNAME"], pop)
            elif row["SUMLEV"] == "050":
                out[sf]["counties"][sf + row["COUNTY"].zfill(3)] = (row["CTYNAME"], pop)
    return out


def build(csv_path: Path, data_js: Path) -> tuple[dict, list[str]]:
    ours = read_counties(data_js)
    census = read_census(csv_path)
    problems: list[str] = []
    states = {}
    for st, sf in STATES.items():
        c = census[sf]
        if c["state"] is None:
            problems.append(f"{st}: no state row for FIPS {sf}")
            continue
        counties = {}
        for cty in ours[st]:
            got = c["counties"].get(cty["fips"])
            if got is None:
                problems.append(f"{st}: {cty['name']} ({cty['fips']}) has no census row")
                continue
            name = got[0].removesuffix(" County")
            if name != cty["name"]:
                problems.append(f"{st}: {cty['fips']} is {cty['name']!r} in data.js, {got[0]!r} in the census")
            counties[cty["fips"]] = got[1]
        extra = sorted(set(c["counties"]) - {x["fips"] for x in ours[st]})
        for f in extra:
            problems.append(f"{st}: census county {c['counties'][f][0]} ({f}) is not in data.js")
        total = c["state"][1]
        if sum(counties.values()) != total:
            problems.append(f"{st}: counties add to {sum(counties.values()):,}, state row says {total:,}")
        states[st] = {"fips": sf, "name": c["state"][0], "total": total, "counties": counties}
    out = {
        "v": 1,
        "vintage": VINTAGE,
        "date": f"{VINTAGE}-07-01",
        "label": f"July {VINTAGE}",
        "source": SOURCE,
        "url": URL,
        "sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
        "states": states,
    }
    return out, problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--csv", type=Path, default=ROOT / "build" / "census" / f"co-est{VINTAGE}-alldata.csv",
                    help="the census county totals CSV (downloaded here if it is missing)")
    ap.add_argument("--data", type=Path, default=ROOT / "data.js", help="data.js, for the county list and order")
    ap.add_argument("--out", type=Path, default=ROOT / "pop.js")
    a = ap.parse_args()
    if not a.csv.exists():
        fetch(a.csv)
    out, problems = build(a.csv, a.data)
    if problems:
        print("population does not match data.js:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    body = json.dumps(out, separators=(",", ":"))
    a.out.write_text(
        "/* Burn Calendar county population, built by scripts/build_population.py from the US Census Bureau's "
        f"Vintage {VINTAGE} county estimates (public domain). */\nwindow.POPULATION = " + body + ";\n",
        encoding="utf-8",
    )
    for st, s in out["states"].items():
        top = sorted(s["counties"].items(), key=lambda kv: -kv[1])[:3]
        print(f"{st} {s['name']}: {s['total']:,} people in {len(s['counties'])} counties; largest "
              + ", ".join(f"{f} {p:,}" for f, p in top))
    print(f"wrote {a.out} ({a.out.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
