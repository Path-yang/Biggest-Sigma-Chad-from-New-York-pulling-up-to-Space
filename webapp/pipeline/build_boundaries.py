#!/usr/bin/env python3
"""Convert geoBoundaries (CC BY 4.0) into small outline files the copilot can load at run time.

No fire numbers are computed here: the copilot measures fire inside an outline when it is asked.

Outputs (under webapp/public/data/b/):
  index.json        one row per region: [id, name, level, west, south, east, north]
  p/<ISO>.json      a country: its outline, plus the outline of each state
  p/<ISO>.<n>.json  a state: the outline of each district

Region ids: "USA" (country), "USA.5" (state), "USA.5.12" (district).
"""
import json
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
B = ROOT / "data" / "boundaries"
OUT = ROOT / "webapp" / "public" / "data" / "b"

t0 = time.time()
log = lambda *a: print(f"[{time.time() - t0:4.0f}s]", *a, flush=True)
con = duckdb.connect()
con.execute("SET threads=10; SET memory_limit='14GB'")
con.execute("INSTALL spatial; LOAD spatial")
con.execute(f"CREATE TABLE a0 AS SELECT shapeName AS name, shapeGroup AS iso, geom FROM ST_Read('{B}/geoBoundariesCGAZ_ADM0.geojson')")
for lvl in (1, 2):
    con.execute(f"""CREATE TABLE a{lvl} AS SELECT row_number() OVER () AS k, shapeName AS name, shapeGroup AS iso, geom
                    FROM ST_Read('{B}/geoBoundariesCGAZ_ADM{lvl}.geojson') WHERE shapeType = 'ADM{lvl}'""")
log("read", [con.execute(f"SELECT count(*) FROM a{i}").fetchone()[0] for i in (0, 1, 2)])

# the state each district belongs to
con.execute("""CREATE TABLE par AS SELECT d.k AS k2, min(s.k) AS k1
               FROM a2 d JOIN a1 s ON s.iso = d.iso AND ST_Contains(s.geom, ST_PointOnSurface(d.geom)) GROUP BY d.k""")
con.execute("""INSERT INTO par SELECT d.k, arg_min(s.k, ST_Distance(s.geom, ST_PointOnSurface(d.geom)))
               FROM a2 d JOIN a1 s ON s.iso = d.iso WHERE d.k NOT IN (SELECT k2 FROM par) GROUP BY d.k""")
parent = dict(con.execute("SELECT k2, k1 FROM par").fetchall())
log("parents", len(parent))


def ring_area(r):
    return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))) / 2


def tidy(geojson, nd, keep=0.01):
    """Round coordinates, drop holes and tiny islands; return (geometry, bbox of the main parts)."""
    g = json.loads(geojson)
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
    out = []
    for poly in polys:
        pts, last = [], None
        for x, y in poly[0]:
            p = [round(x, nd), round(y, nd)]
            if p != last:
                pts.append(p); last = p
        if len(pts) >= 4:
            out.append((ring_area(pts), [pts]))
    if not out:
        return None, None
    big = max(a for a, _ in out)
    kept = [p for a, p in sorted(out, key=lambda t: -t[0]) if a >= big * keep][:60]
    main = [p for a, p in out if a >= big * 0.25]
    xs = [x for p in main for x, _ in p[0]]; ys = [y for p in main for _, y in p[0]]
    bbox = [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]
    return ({"type": "Polygon", "coordinates": kept[0]} if len(kept) == 1 else {"type": "MultiPolygon", "coordinates": kept}), bbox


simp = lambda t, tol: f"ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, {tol})) FROM {t}"
r0 = con.execute(f"SELECT name, iso, {simp('a0', 0.03)}").fetchall(); log("country outlines")
r1 = con.execute(f"SELECT k, name, iso, {simp('a1', 0.01)} ORDER BY iso, name").fetchall(); log("state outlines")
r2 = con.execute(f"SELECT k, name, iso, {simp('a2', 0.005)} ORDER BY iso, name").fetchall(); log("district outlines")

index, id1, kids1, kids2 = [], {}, {}, {}
(OUT / "p").mkdir(parents=True, exist_ok=True)
for k, name, iso, gj in r1:
    geom, bbox = tidy(gj, 3)
    if geom:
        lst = kids1.setdefault(iso, []); rid = f"{iso}.{len(lst) + 1}"; id1[k] = rid
        lst.append({"id": rid, "name": name, "b": bbox, "g": geom}); index.append([rid, name, 1, *bbox])
for k, name, iso, gj in r2:
    p = id1.get(parent.get(k))
    geom, bbox = tidy(gj, 3) if p else (None, None)
    if geom:
        lst = kids2.setdefault(p, []); rid = f"{p}.{len(lst) + 1}"
        lst.append({"id": rid, "name": name, "b": bbox, "g": geom}); index.append([rid, name, 2, *bbox])
for name, iso, gj in r0:
    geom, bbox = tidy(gj, 2)
    if geom:
        index.append([iso, name, 0, *bbox])
        (OUT / "p" / f"{iso}.json").write_text(json.dumps({"id": iso, "name": name, "b": bbox, "g": geom, "children": kids1.get(iso, [])}, ensure_ascii=False, separators=(",", ":")))
for pid, lst in kids2.items():
    (OUT / "p" / f"{pid}.json").write_text(json.dumps({"id": pid, "children": lst}, ensure_ascii=False, separators=(",", ":")))
index.sort(key=lambda r: (r[2], r[0]))
(OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
files = list((OUT / "p").glob("*.json"))
log(f"DONE: {len(index):,} regions, {len(files):,} files, {sum(f.stat().st_size for f in files) / 1e6:.0f} MB, "
    f"index {(OUT / 'index.json').stat().st_size / 1e6:.1f} MB, largest {max(f.stat().st_size for f in files) / 1e6:.1f} MB")
