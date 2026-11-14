#!/usr/bin/env python3
"""Build world.js: one simplified outline per FIRMS country, for the globe.

The site's globe needs a clickable shape for every country name that appears in
the FIRMS data (build/hf/manifest.csv, column "country"). The shapes come from
Natural Earth admin-0 (public domain): the 1:50m "map units" layer, which has the
same outlines as the 1:50m countries layer but keeps overseas regions such as
French Guiana, Reunion or Svalbard apart from their parent country, as FIRMS
does. The 1:10m layer is used for FIRMS names that 1:50m does not have, and for
small territories (under 1 square degree at 1:50m): 1:50m leaves out many of
their outlying islands, so a good share of their fire detections fell outside
the 1:50m shape (Cook Islands, Tonga, South Sandwich Islands, Amsterdam Island).

Output, loaded by index.html before app.js:

    window.WORLD = {"countries": [
      {"k": FIRMS name, "n": display name, "c": [lon, lat] label point inside the
       largest ring, "b": [w, s, e, n], "r": [[lon, lat, lon, lat, ...], ...]}
    ]};

Rings are outer rings only, closed, simplified (0.05 degrees, 0.003 for the small
territories), rounded to 2 decimals. No ring spans 180 degrees of longitude or more: Natural Earth
already cuts Russia, Fiji and the USA at the antimeridian, and anything still
that wide (Antarctica) is cut into 60-degree slices.

Every match is checked against the data: a sample of each country's vegetation
fire detections (type 0) is tested against its shape, and the share inside is
written to a coverage CSV. Natural Earth features that no FIRMS name claims are
listed together with the FIRMS countries whose detections fall inside them.

Usage:
    .venv/bin/python scripts/build_world_shapes.py [--cache DIR] [--coverage CSV]

Needs shapely and duckdb.
"""
import argparse
import csv
import json
import re
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

import duckdb
import numpy as np
import shapely
from shapely.geometry import Polygon, box, shape
from shapely.ops import polylabel, unary_union

ROOT = Path(__file__).resolve().parent.parent
HF = ROOT / "build" / "hf"
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"
NE50 = "ne_50m_admin_0_map_units"
NE10 = "ne_10m_admin_0_map_units"

TOLERANCE = 0.05
SMALL_AREA = 1.0  # square degrees at 1:50m below which a territory uses 1:10m
SMALL_TOLERANCE = 0.003
TINY_TOLERANCE = 0.005
DECIMALS = 2
MIN_AREA = 1e-6  # square degrees; a rounded ring smaller than this is a sliver
SLICE = 60  # degrees of longitude per slice for shapes that wrap the globe
SAMPLE_FILES = 4
SAMPLE_ROWS = 4000

# Natural Earth fields tried in order when matching a feature to a FIRMS name.
NAME_FIELDS = ["GEOUNIT", "NAME", "NAME_LONG", "ADMIN", "FORMAL_EN", "SOVEREIGNT"]

# FIRMS name -> Natural Earth names (any field above) it should also claim.
ALIASES = {
    "Aland_Islands": ["Aland"],
    "Cape_Verde": ["Cabo Verde"],
    "Czech_Republic": ["Czechia"],
    "Dem_Rep_Korea": ["North Korea"],
    "Faeroe_Islands": ["Faroe Islands"],
    "Heard_I_and_McDonald_Islands": ["Heard Island and McDonald Islands"],
    "Macedonia_Former_Yugoslav_Republic_of": ["North Macedonia"],
    "Republic_of_Congo": ["Republic of the Congo"],
    "South_Georgia_and_South_Sandwich_Islands": ["South Georgia and the Islands"],
    "Svalbard_and_Jan_Mayen": ["Svalbard", "Jan Mayen"],
    "Swaziland": ["eSwatini", "Eswatini"],
    "The_Gambia": ["Gambia"],
    "United_States": ["United States of America"],
    "Wallis_and_Futuna_Islands": ["Wallis and Futuna"],
    "United_States_Minor_Outlying_Islands": ["United States Minor Outlying Islands"],
    # Areas Natural Earth keeps apart but FIRMS files under a country; each one
    # is confirmed by where that country's detections fall (see the report).
    "Serbia": ["Republic of Serbia"],  # brings in Vojvodina
    "Tanzania": ["United Republic of Tanzania"],  # brings in Zanzibar
    "Somalia": ["Somaliland"],
    "Cyprus": ["Northern Cyprus", "N. Cyprus", "Cyprus U.N. Buffer Zone"],
    "Morocco": ["Western Sahara"],
    "Palestine": ["West Bank", "Gaza"],
}

# Display names where turning underscores into spaces is not enough. Kept the
# same as NAME_FIX in scripts/build_country_summaries.py.
DISPLAY = {
    "Brunei_Darussalam": "Brunei",
    "Cote_d_Ivoire": "Cote d'Ivoire",
    "Dem_Rep_Korea": "North Korea",
    "Republic_of_Korea": "South Korea",
    "Faeroe_Islands": "Faroe Islands",
    "Heard_I_and_McDonald_Islands": "Heard Island and McDonald Islands",
    "Lao_PDR": "Laos",
    "Macedonia_Former_Yugoslav_Republic_of": "North Macedonia",
    "Republic_of_Congo": "Republic of the Congo",
    "Russian_Federation": "Russia",
    "Saint-Barthelemy": "Saint Barthelemy",
    "Saint-Martin": "Saint Martin",
    "Swaziland": "Eswatini",
    "Wallis_and_Futuna_Islands": "Wallis and Futuna",
}


def norm(text):
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower().replace("&", "and"))


def display_name(firms):
    return DISPLAY.get(firms, firms.replace("_", " "))


def load_layer(cache, name):
    path = cache / f"{name}.geojson"
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        print(f"downloading {name}", file=sys.stderr)
        urllib.request.urlretrieve(NE_URL.format(name), path)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["features"]


def firms_countries():
    with open(HF / "manifest.csv", newline="") as fh:
        rows = list(csv.DictReader(fh))
    files = defaultdict(list)
    for row in rows:
        files[row["country"]].append(row)
    return files


def match_features(features, lookup):
    """Assign each feature to the first FIRMS name one of its fields matches."""
    claimed, loose = defaultdict(list), []
    for feat in features:
        props = feat["properties"]
        target = None
        for field in NAME_FIELDS:
            target = lookup.get(norm(props.get(field) or ""))
            if target:
                break
        if target:
            claimed[target].append(feat)
        else:
            loose.append(feat)
    return claimed, loose


def feature_label(feat):
    p = feat["properties"]
    return p.get("GEOUNIT") or p.get("NAME") or p.get("ADMIN")


def union(feats):
    return unary_union([shapely.make_valid(shape(f["geometry"])) for f in feats])


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def cut_wide(polys):
    """Cut any polygon spanning 180 degrees of longitude or more into slices."""
    out = []
    for poly in polys:
        w, s, e, n = poly.bounds
        if e - w < 180:
            out.append(poly)
            continue
        for x in range(-180, 180, SLICE):
            out.extend(polygons(poly.intersection(box(x, -90, x + SLICE, 90))))
    return out


def ring_coords(poly, tolerance):
    """Simplified, rounded, closed outer ring, or None if it vanished."""
    ext = Polygon(poly.exterior).simplify(tolerance, preserve_topology=False)
    best = max(polygons(ext), key=lambda p: p.area, default=None)
    if best is None:
        return None
    pts = []
    for x, y in shapely.get_coordinates(shapely.geometry.polygon.orient(best, 1).exterior):
        pt = (round(float(x), DECIMALS), round(float(y), DECIMALS))
        if not pts or pts[-1] != pt:
            pts.append(pt)
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    if len(pts) < 4 or Polygon(pts).area < MIN_AREA:
        return None
    return pts


def build_rings(geom, tolerance):
    polys = cut_wide(polygons(geom))
    rings = [r for r in (ring_coords(p, tolerance) for p in polys) if r]
    if not rings:
        # Every island vanished at the globe tolerance: keep them at a finer one.
        rings = [r for r in (ring_coords(p, TINY_TOLERANCE) for p in polys) if r]
    if not rings:
        # Still too small to survive rounding: a small square around the largest.
        big = max(polys, key=lambda p: p.area)
        x, y = big.representative_point().coords[0]
        x, y = round(x, DECIMALS), round(y, DECIMALS)
        d = 0.02
        rings = [[(x - d, y - d), (x + d, y - d), (x + d, y + d), (x - d, y + d), (x - d, y - d)]]
    for ring in rings:
        xs = [p[0] for p in ring]
        assert max(xs) - min(xs) < 180, "ring spans the antimeridian"
    return rings


def label_point(rings, feats):
    largest = Polygon(max(rings, key=lambda r: Polygon(r).area))
    candidates = []
    for feat in sorted(feats, key=lambda f: -shape(f["geometry"]).area):
        p = feat["properties"]
        if p.get("LABEL_X") is not None:
            candidates.append((p["LABEL_X"], p["LABEL_Y"]))
    body = largest if largest.is_valid else max(polygons(shapely.make_valid(largest)), key=lambda p: p.area)
    lab = polylabel(body, tolerance=0.001)
    rp = body.representative_point()
    candidates += [(lab.x, lab.y), (rp.x, rp.y)]
    # Two decimals like the rings; a ring too thin to hold a point of the
    # 0.01 grid gets a label point with more decimals.
    for decimals in (DECIMALS, DECIMALS + 2):
        for x, y in candidates:
            pt = (round(float(x), decimals), round(float(y), decimals))
            if largest.contains(shapely.Point(pt)):
                return list(pt)
    raise RuntimeError("no label point inside the largest ring")


def sample_points(con, rows):
    """Vegetation-fire detections sampled from a few of a country's files."""
    rows = sorted(rows, key=lambda r: int(r["rows"]), reverse=True)
    picks = rows[:: max(1, len(rows) // SAMPLE_FILES)][:SAMPLE_FILES]
    paths = [str(HF / r["path"]) for r in picks]
    lst = "[" + ",".join("'" + p.replace("'", "''") + "'" for p in paths) + "]"
    q = f"""SELECT longitude, latitude, type FROM read_parquet({lst}, union_by_name=true)"""
    pts = con.execute(f"SELECT longitude, latitude FROM ({q}) WHERE type = 0 USING SAMPLE reservoir({SAMPLE_ROWS} ROWS) REPEATABLE (7)").fetchnumpy()
    if len(pts["longitude"]) == 0:
        pts = con.execute(f"SELECT longitude, latitude FROM ({q}) USING SAMPLE reservoir({SAMPLE_ROWS} ROWS) REPEATABLE (7)").fetchnumpy()
    return np.asarray(pts["longitude"], float), np.asarray(pts["latitude"], float)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", type=Path, default=ROOT / "build" / "ne", help="Natural Earth download folder")
    ap.add_argument("--out", type=Path, default=ROOT / "world.js")
    ap.add_argument("--coverage", type=Path, default=ROOT / "build" / "world_shapes_coverage.csv")
    args = ap.parse_args()

    files = firms_countries()
    names = sorted(files)
    lookup = {norm(n): n for n in names}
    for firms, alts in ALIASES.items():
        for alt in alts:
            lookup[norm(alt)] = firms

    claimed, loose = match_features(load_layer(args.cache, NE50), lookup)
    c10, _ = match_features(load_layer(args.cache, NE10), lookup)
    from10 = {}
    for n in names:
        if n not in c10:
            continue
        if n not in claimed or union(claimed[n]).area < SMALL_AREA:
            from10[n] = c10[n]
    claimed.update(from10)
    no_shape = [n for n in names if n not in claimed]

    con = duckdb.connect()
    out, report = [], []
    samples = {}
    for firms in names:
        feats = claimed.get(firms)
        xs, ys = sample_points(con, files[firms])
        samples[firms] = (xs, ys)
        if not feats:
            report.append({"firms": firms, "ne": "", "layer": "", "rings": 0, "points": len(xs),
                           "inside_final": "", "inside_source": ""})
            continue
        geom = union(feats)
        rings = build_rings(geom, SMALL_TOLERANCE if firms in from10 else TOLERANCE)
        final = unary_union([Polygon(r).buffer(0) for r in rings])
        xs_all = [p[0] for r in rings for p in r]
        ys_all = [p[1] for r in rings for p in r]
        out.append({
            "k": firms,
            "n": display_name(firms),
            "c": label_point(rings, feats),
            "b": [min(xs_all), min(ys_all), max(xs_all), max(ys_all)],
            "r": [[v for p in r for v in p] for r in rings],
        })
        share_final = float(shapely.contains_xy(final, xs, ys).mean()) if len(xs) else float("nan")
        share_src = float(shapely.contains_xy(geom, xs, ys).mean()) if len(xs) else float("nan")
        report.append({"firms": firms, "ne": "; ".join(sorted(feature_label(f) for f in feats)),
                       "layer": "10m" if firms in from10 else "50m", "rings": len(rings), "points": len(xs),
                       "inside_final": f"{share_final:.3f}", "inside_source": f"{share_src:.3f}"})

    body = json.dumps({"countries": out}, separators=(",", ":"), ensure_ascii=False)
    args.out.write_text(
        "// Country outlines for the globe: Natural Earth admin-0 (public domain), simplified.\n"
        "// Built by scripts/build_world_shapes.py. Keys are the FIRMS country names.\n"
        f"window.WORLD={body};\n", encoding="utf-8")

    args.coverage.parent.mkdir(parents=True, exist_ok=True)
    with open(args.coverage, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(report[0]))
        w.writeheader()
        w.writerows(report)

    print(f"wrote {args.out} ({args.out.stat().st_size:,} bytes, {len(out)} countries)")
    print(f"coverage: {args.coverage}")
    print("FIRMS names with no shape:", ", ".join(no_shape) or "none")
    print(f"FIRMS names taken from 1:10m ({len(from10)}):", ", ".join(sorted(from10)) or "none")
    for r in report:
        flag = "  <-- under 80%" if r["inside_final"] and float(r["inside_final"]) < 0.8 else ""
        print(f"{r['firms']:42s} {r['layer']:3s} rings={r['rings']:4d} n={r['points']:5d} "
              f"inside={r['inside_final']:>5s} src={r['inside_source']:>5s}  [{r['ne']}]{flag}")

    print("\nNatural Earth features not claimed by any FIRMS name, and whose detections fall in them:")
    for feat in loose:
        g = union([feat])
        hits = {n: int(shapely.contains_xy(g, *samples[n]).sum()) for n in names if len(samples[n][0])}
        hits = {n: c for n, c in sorted(hits.items(), key=lambda kv: -kv[1]) if c}
        print(f"  {feature_label(feat)}: {hits or 'no sampled detections'}")


if __name__ == "__main__":
    main()
