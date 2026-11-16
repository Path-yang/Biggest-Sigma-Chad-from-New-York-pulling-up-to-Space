#!/usr/bin/env python3
"""Build provinces/v1: monthly harmonized fire counts for every state or province (admin level 1) of every country.

Boundaries are Natural Earth 1:10m "Admin 1 - States, Provinces" (public domain). Each Natural Earth province is
given to the FIRMS country whose Natural Earth admin-0 map unit (1:10m) holds the province's representative point;
the FIRMS name -> map unit match is the one the globe uses (scripts/build_world_shapes.py: same names, same aliases,
so Western Sahara goes with Morocco, Somaliland with Somalia, Zanzibar with Tanzania, and so on). A province whose
fire FIRMS files almost wholly under one other country goes to that country instead (MOVE_SHARE, MOVE_MIN): this
moves Crimea and Sevastopol to Ukraine, where FIRMS puts their detections. The four Natural Earth provinces in map
units no FIRMS name claims (Vatican, Kashmir in Siachen Glacier, Tuvalu, Spratly Islands) hold no fire and are left out.

For seven countries whose Natural Earth units are years out of date (GB: Kenya, DR Congo, Ghana, Nepal, Sudan,
Indonesia, Ethiopia) the Natural Earth units are replaced by geoBoundaries ADM1 (gbOpen / gbHumanitarian, pinned to
GB_COMMIT; public domain or CC BY 3.0 IGO, credited in those files). Other countries whose units are out of date are
marked (BOUNDARY_NOTES): every country file and index row carries a `boundaries` source, `outdated` flag and note.

Fire comes from fine/v1's local monthly table (scripts/build_fine_grid.py, WORK/monthly_cells.parquet): the exact
harmonized value per country, 0.05 degree cell and month, 2001-01 .. 2026-11 (November 2026 to the 14th), the same
values the site's country series and cells/v1 use (outage fill included). A cell is given to the province of its
own country that contains the cell centre (a cell crossed by a province border goes wholly to the province holding
its centre). A centre that falls in no province of its country (coast and border cells, where FIRMS's country
outline and Natural Earth's differ) goes to the nearest province of that country within SNAP degrees; past that the
cell is "unassigned" and reported per country. Detections stay with the country FIRMS filed them under: a province
only ever receives cells of its own country.

Each country-month is rounded to 0.1 over its provinces and the unassigned part by largest remainder, so the
province values plus the unassigned value add up exactly to the published cells/v1 month sum (the exact country sum
rounded to 0.1). Each province also gets usual[m] (median of calendar month m, 2001-2025) and watch[m] (0.6 x median
of month m over its ten latest complete years + 0.4 x mean of the last three; the site's outlook rule).

Geometry is simplified per country with GEOS's coverage simplification (shapely.coverage_simplify), which keeps the
shared borders shared: no gaps or overlaps between neighbours. The tolerance grows until the country's geometry is
under GEOM_BUDGET bytes. Province names and aliases come from Natural Earth's name fields (or geoBoundaries' name and
the Natural Earth names of a matching unit) plus Wikidata's English labels and aliases by QID (cached in --wikidata,
CC0); each matching key goes to one province (names_for), Natural Earth's attribute errors are fixed (PROP_FIX), and
repeated display names are told apart.

Outputs: OUT/<Country>.json, OUT/index.json (every province: name, aliases, region, bbox, totals), OUT/rank.json
(usual and watch per province); the run report REPORT (JSON). Format: PROVINCES.md beside the build outputs.

Checks (the run fails on any): every Natural Earth province is given to one FIRMS country or listed as left out;
province + unassigned exact sums equal the country exact sum per month; the exact country months are within 0.05 of
the published cells/v1 month sums and the rounded parts add up to those sums exactly; no rounded value moves by 0.1;
the yearly sums are within rounding of fine/v1's year totals; the unassigned share of all fire is under 0.5%; every
file is under 2 MB.

Usage:
  .venv/bin/python scripts/build_provinces.py --ne DIR --monthly PARQUET --cells-v1 DIR --fine-v1 DIR --out DIR
      --report JSON [--gb DIR] [--wikidata JSON]
    --ne        folder with ne_10m_admin_1_states_provinces.geojson and ne_10m_admin_0_map_units.geojson
                (downloaded from github.com/nvkelso/natural-earth-vector when missing)
    --monthly   fine/v1's WORK/monthly_cells.parquet
    --cells-v1  local copy of cells/v1 (cross-check of the country months)
    --fine-v1   local copy of fine/v1 (cross-check of the yearly totals)
    --gb        folder with geoBoundaries-<ISO3>-ADM1.geojson (downloaded when missing; default: --ne)
    --wikidata  Wikidata names cache (fetched from query.wikidata.org when missing; default: --ne/wikidata_names.json)
"""
import argparse
import hashlib
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import duckdb
import numpy as np
import shapely
import shapely.ops
from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_world_shapes as bws  # noqa: E402  FIRMS name -> Natural Earth admin-0 map units

ROOT = Path(__file__).resolve().parent.parent
V3 = ROOT / "build" / "hf" / "summary" / "v3"
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"
NE_A1 = "ne_10m_admin_1_states_provinces"
NE_MU = "ne_10m_admin_0_map_units"
Y0 = 2001
NM = 311  # 2001-01 .. 2026-11
NY = 26
CELL = 0.05
SNAP = 0.1  # degrees: a cell centre this close to a province of its country goes to that province
# A province whose fire FIRMS files at least MOVE_SHARE under one other country (and at least MOVE_MIN hotspots)
# goes to that country: FIRMS files Crimea and Sevastopol under Ukraine, Natural Earth draws them in Russia.
MOVE_SHARE = 0.85
MOVE_MIN = 200
GEOM_BUDGET = 300_000  # bytes of geometry per country file
TOLERANCES = [0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2]
MAX_FILE = 2_000_000
MAX_UNASSIGNED = 0.005
R_EARTH = 6371.0088  # km, mean radius
NAME_LANGS = ["en", "es", "fr", "de", "pt", "it", "nl", "pl", "sv", "tr", "vi", "id", "hu", "ru", "uk", "el", "ar",
              "fa", "he", "hi", "bn", "ur", "zh", "zht", "ja", "ko"]
LICENCE = ("Province boundaries and names: Natural Earth (naturalearthdata.com), public domain; more names from "
           "Wikidata (CC0). Fire values: derived from NASA FIRMS (see the dataset card).")

# Countries whose Natural Earth units are years out of date and for which geoBoundaries (Runfola et al. 2020,
# geoboundaries.org) has the current first-level units under an open licence. Their provinces come from geoBoundaries
# instead: FIRMS country -> (ISO3, ISO 3166 alpha-2, release, unit type, licence, original source, year, units).
GB_COMMIT = "9469f09"  # geoBoundaries release data commit (the API's "current" on 2026-11-15)
GB_URL = ("https://github.com/wmgeolab/geoBoundaries/raw/{commit}/releaseData/{rel}/{iso3}/ADM1/"
          "geoBoundaries-{iso3}-ADM1.geojson")
CC_IGO = "CC BY 3.0 IGO (creativecommons.org/licenses/by/3.0/igo)"
GB = {
    "Kenya": ("KEN", "KE", "gbOpen", "County", "public domain", "RCMRD GeoPortal, Africa GeoPortal", "2020",
              "the 47 counties (since 2013)"),
    "Democratic_Republic_of_the_Congo": ("COD", "CD", "gbHumanitarian", "Province", CC_IGO,
                                         "Referentiel Geographique Commun, via OCHA HDX", "2019",
                                         "the 26 provinces (since 2015)"),
    "Ghana": ("GHA", "GH", "gbHumanitarian", "Region", CC_IGO, "Ghana Statistical Service, via OCHA HDX", "2021",
              "the 16 regions (since 2019)"),
    "Nepal": ("NPL", "NP", "gbHumanitarian", "Province", CC_IGO, "Survey Department of Nepal, via OCHA HDX", "2020",
              "the 7 provinces (since 2015)"),
    "Sudan": ("SDN", "SD", "gbHumanitarian", "State", CC_IGO, "OCHA Information Management Working Group, via HDX",
              "2020", "18 states and the Abyei area"),
    "Indonesia": ("IDN", "ID", "gbHumanitarian", "Province", CC_IGO, "OCHA ROAP, via HDX", "2019",
                  "34 provinces (as of 2019)"),
    "Ethiopia": ("ETH", "ET", "gbHumanitarian", "Region", CC_IGO, "Central Statistics Agency and BoFED, via OCHA HDX",
                 "2020", "11 regions and 2 chartered cities (as of 2021)"),
}
GB_TYPE = {("Ethiopia", "Addis Ababa"): "Chartered City", ("Ethiopia", "Dire Dawa"): "Chartered City",
           ("Democratic_Republic_of_the_Congo", "Kinshasa"): "City-Province",
           ("Sudan", "Abyei PCA"): "Special Administrative Area",
           ("Indonesia", "Dki Jakarta"): "Special Capital Region",
           ("Indonesia", "Daerah Istimewa Yogyakarta"): "Special Region", ("Indonesia", "Aceh"): "Special Region"}
# geoBoundaries units whose name Wikidata does not carry in a matching form: (country, shapeName) -> QID
GB_QID = {("Nepal", "Province 1"): "Q25104008", ("Nepal", "Province 2"): "Q25104009",
          ("Ghana", "Northern East"): "Q60764359", ("Sudan", "Gedaref"): "Q309478", ("Sudan", "Aj Jazirah"): "Q309469",
          ("Sudan", "Abyei PCA"): "Q336494", ("Indonesia", "Maluku"): "Q5093", ("Indonesia", "Papua"): "Q5095",
          ("Indonesia", "Papua Barat"): "Q5096", ("Ethiopia", "Benishangul Gumz"): "Q207635",
          ("Nepal", "Gandaki"): "Q25104016", ("Democratic_Republic_of_the_Congo", "Kasaï"): "Q6373961"}
# ISO 3166-2 codes Wikidata does not carry on the current unit's item
GB_ISO = {("Nepal", "Gandaki"): "NP-P4", ("Democratic_Republic_of_the_Congo", "Kasaï"): "CD-KS"}
# display names and extra names for geoBoundaries units: (country, shapeName) -> (display or None, [aliases])
GB_NAMES = {
    ("Ethiopia", "SNNP"): ("SNNPR (now Central and South Ethiopia)",
                           ["SNNP", "SNNPR", "Southern Nations, Nationalities, and Peoples' Region", "Central Ethiopia",
                            "South Ethiopia", "Central Ethiopia Region", "South Ethiopia Region"]),
    ("Sudan", "Abyei PCA"): ("Abyei Area", ["Abyei", "Abyei PCA"]),
    ("Nepal", "Province 1"): (None, ["Province 1", "Province No. 1"]),
    ("Nepal", "Province 2"): (None, ["Province 2", "Province No. 2"]),
    ("Democratic_Republic_of_the_Congo", "Kasaï"): ("Kasaï", ["Kasai", "Kasaï Province"]),
    ("Ethiopia", "South West Ethiopia"): ("South West Ethiopia", ["Southwest Ethiopia",
                                                                  "South West Ethiopia Peoples' Region"]),
}
GB_IOU = 0.8  # a Natural Earth unit this close to a geoBoundaries one is the same unit: its names become aliases
# Natural Earth units known to be out of date, and the note shown with them (M1 of the provinces/v1 review)
BOUNDARY_NOTES = {
    "Angola": "Natural Earth's 18 provinces. Angola has 21 since the 2024 reform, which split Cuando Cubango, Moxico "
              "and Luanda; those three are the former, larger provinces here.",
    "Vietnam": "Natural Earth's 63 provinces. Vietnam merged its provinces into 34 in 2025; the names here are the "
               "former provinces.",
    "Madagascar": "Natural Earth's 22 regions. Vatovavy-Fitovinany was split into Vatovavy and Fitovinany in 2021.",
    "Tanzania": "Natural Earth's 30 regions. Songwe was split from Mbeya in 2016 and is inside Mbeya here.",
    "Central_African_Republic": "Natural Earth's 17 prefectures. The 2020 reform added Lim-Pende, Mambere and "
                                "Ouham-Fafa, which are inside Ouham-Pende, Mambere-Kadei and Ouham here.",
    "Lao_PDR": "Natural Earth's 17 provinces. Xaisomboun province (2013) is missing; its area is in the neighbouring "
               "provinces.",
    "Cambodia": "Natural Earth's 24 provinces. Tbong Khmum (split from Kampong Cham in 2013) is inside Kampong Cham "
                "here.",
    "Latvia": "Natural Earth's 119 municipalities from before the 2021 reform, which made 43.",
    "Mali": "Natural Earth's 8 regions and Bamako. Mali has since created more regions (19 in law).",
    "Kazakhstan": "Natural Earth's regions from before 2022: Abai, Jetisu and Ulytau are inside East Kazakhstan, "
                  "Almaty and Karaganda here.",
    "Sierra_Leone": "Natural Earth's 4 provinces. North West Province (2017) is inside Northern here.",
    "Uganda": "Natural Earth's 112 districts and counties from about 2010. Uganda has over 140 districts now.",
    "Papua_New_Guinea": "Natural Earth's 20 provinces. Hela and Jiwaka (2012) are inside Southern Highlands and "
                        "Western Highlands here.",
    "Chad": "Natural Earth's 22 units. Chad has 23 provinces since 2018.",
    "Cote_d_Ivoire": "Natural Earth's mix of 12 older departments and 7 regions. Cote d'Ivoire has 14 districts and "
                     "31 regions.",
    "Burkina_Faso": "Natural Earth's 45 provinces. The 2025 reform made 47 provinces in 17 regions.",
}
GB_NOTES = {
    "Ethiopia": "The SNNP region was split in 2023 into Central Ethiopia and South Ethiopia; here it is still one "
                "unit, named 'SNNPR (now Central and South Ethiopia)'.",
    "Indonesia": "Papua and West Papua are the units before the 2022 split into six provinces (Papua, Central "
                 "Papua, Highland Papua, South Papua, West Papua, Southwest Papua).",
    "Nepal": "Province 1 is now named Koshi and Province 2 Madhesh.",
}
GB_OUTDATED = {"Ethiopia", "Indonesia"}
# Natural Earth attribute errors (by adm1_code). "_names": replace every name field (the unit was mislabelled).
PROP_FIX = {
    "RUS-2364": {"iso_3166_2": "RU-MOS"},  # Moscow Oblast; Natural Earth swaps the two Moscow codes
    "RUS-2365": {"iso_3166_2": "RU-MOW"},  # Moscow (federal city)
    "UKR-321": {"wikidataid": "Q170036"},  # Kyiv Oblast (Natural Earth gives it the city's QID)
    "AFG-1769": {"_names": "Panjshir", "iso_3166_2": "AF-PAN", "wikidataid": "Q181235"},  # labelled "Parwan"
    "AFG-1753": {"_names": "Daykundi", "iso_3166_2": "AF-DAY", "wikidataid": "Q181220"},  # labelled "Uruzgan"
    "IND-2429": {"type_en": "State"},  # Himachal Pradesh
    "BRA-599": {"_display": "Federal District"},  # Natural Earth's English name is "Federal"
    "OMN-2406": {"_display": "Ash Sharqiyah South", "wikidataid": None},  # QID is the former whole region
    "RUS-5482": {"type_en": "City with special status"},  # Sevastopol (filed under Ukraine, see MOVE_SHARE)
}
REGION_NULL = {"Russian_Federation", "Greece"}  # Natural Earth's region field is wrong for several units
# names people use that neither Natural Earth nor Wikidata's English aliases have (by adm1_code)
EXTRA_ALIASES = {"BRA-599": ["Brasilia", "Federal District"], "IND-3257": ["Bengal"]}
JUNK = re.compile(r"[£¡¿¤§]|obsolete", re.I)  # mis-encoded or retired names in Natural Earth's name_alt
ISO_LIKE = re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,3}$")
WD_SPARQL = "https://query.wikidata.org/sparql"
WD_UA = "BurnCalendarDataBuild/1.0 (dataset build script)"
WD_LANGS = ["en", "mul", "fr", "id"]  # fr and id only to match geoBoundaries names (DR Congo, Indonesia)
# a Wikidata label that only adds the unit type to Natural Earth's name ("Badakhshan Province") does not replace it
GENERIC = re.compile(r"^(provinceof|regionof|stateof|countyof|cityof|republicof|departmentof|governorateof)|(province|"
                     r"region|county|state|district|oblast|krai|kray|governorate|department|departement|prefecture|"
                     r"municipality|city|territory|okrug|republic|voivodeship|canton|parish|division|zone|emirate|"
                     r"wilaya|aimag|raion|rayon|municipio|commune|island|islands|area|regionalstate|borough|council)$")
TYPE_WORDS = re.compile(r"^(provinceof|regionof|stateof|countyof|provinsi)|(province|region|regionalstate|state|county)$")


def dumps(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def t2n(t):
    """integer tenths -> int, or float with one decimal"""
    t = int(t)
    return t // 10 if t % 10 == 0 else t / 10


def r1(x):
    return t2n(math.floor(float(x) * 10 + 0.5 + 1e-9))


def key(s):
    """matching key: '&' read as 'and', no accents, case-folded, letters and digits only (any script)"""
    s = str(s).replace("&", " and ")
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))
    return re.sub(r"[\W_]+", "", s.casefold())


def is_latin(s):
    return all(not ch.isalpha() or "LATIN" in unicodedata.name(ch, "") for ch in s)


# ---------------------------------------------------------------- boundaries

def load_ne(folder, name):
    path = folder / f"{name}.geojson"
    if not path.exists():
        folder.mkdir(parents=True, exist_ok=True)
        print(f"downloading {name}", flush=True)
        urllib.request.urlretrieve(NE_URL.format(name), path)
    data = path.read_bytes()
    return json.loads(data)["features"], hashlib.sha256(data).hexdigest()


def polygonal(g):
    g = shapely.make_valid(g)
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in bws.polygons(g)]
    return shapely.MultiPolygon(parts) if len(parts) > 1 else (parts[0] if parts else shapely.Polygon())


def map_unit_owners(names, ne_dir):
    """every Natural Earth admin-1 feature as (props, geometry, FIRMS country or None) by the map unit holding it"""
    lookup = {bws.norm(n): n for n in names}
    for firms, alts in bws.ALIASES.items():
        for alt in alts:
            lookup[bws.norm(alt)] = firms
    mu, _ = load_ne(ne_dir, NE_MU)
    claimed, loose = bws.match_features(mu, lookup)
    owners, geoms = [], []
    for firms, feats in claimed.items():
        for f in feats:
            owners.append(firms)
            geoms.append(polygonal(shape(f["geometry"])))
    for f in loose:
        owners.append(None)
        geoms.append(polygonal(shape(f["geometry"])))
    tree = shapely.STRtree(geoms)
    a1, sha = load_ne(ne_dir, NE_A1)
    feats, nearest = [], []
    for f in a1:
        g = polygonal(shape(f["geometry"]))
        p = g.representative_point()
        hit = tree.query(p, predicate="intersects")
        if len(hit):
            owner = owners[min(hit)]
        else:
            j, d = tree.query_nearest(p, return_distance=True)
            owner = owners[j[0]]
            nearest.append({"adm1_code": f["properties"]["adm1_code"], "name": f["properties"]["name"],
                            "to": owner, "deg": round(float(d[0]), 3)})
        shapely.prepare(g)
        feats.append((f["properties"], g, owner))
    return feats, nearest, sha


def wd_sparql(query):
    data = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    req = urllib.request.Request(WD_SPARQL, data=data, headers={"User-Agent": WD_UA,
                                                                "Accept": "application/sparql-results+json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)["results"]["bindings"]
        except Exception:  # rate limit or timeout: wait and retry
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))


def wikidata_names(path, qids, prefixes):
    """{qid: {"label": {lang: str}, "aliases": {lang: [str]}, "iso": [str], "ended": bool}} for the given QIDs and every
    item with an ISO 3166-2 code (P300) under the given alpha-2 prefixes; cached in PATH (CC0 data) so rebuilds are
    deterministic. Missing QIDs or prefixes are fetched and added to the cache."""
    cache = json.loads(path.read_text()) if path.exists() else {"items": {}, "prefixes": {}}
    items, pre = cache["items"], cache["prefixes"]
    todo_p = sorted(p for p in prefixes if p not in pre)
    if todo_p:
        cond = " || ".join(f'STRSTARTS(?iso, "{p}-")' for p in todo_p)
        rows = wd_sparql(f"SELECT ?item ?iso WHERE {{ ?item wdt:P300 ?iso . FILTER({cond}) }}")
        for p in todo_p:
            pre[p] = sorted({b["item"]["value"].rsplit("/", 1)[1] for b in rows if b["iso"]["value"].startswith(p + "-")})
    want = sorted(set(qids) | {q for v in pre.values() for q in v})
    todo = [q for q in want if q not in items]
    langs = ", ".join(f'"{x}"' for x in WD_LANGS)
    for i in range(0, len(todo), 300):
        chunk = todo[i:i + 300]
        vals = " ".join("wd:" + q for q in chunk)
        got = {q: {"label": {}, "aliases": {}, "iso": [], "ended": False} for q in chunk}
        for b in wd_sparql(f"""SELECT ?item ?l ?kind WHERE {{ VALUES ?item {{ {vals} }}
              {{ ?item rdfs:label ?l . BIND("label" AS ?kind) }} UNION {{ ?item skos:altLabel ?l . BIND("alias" AS ?kind) }}
              FILTER(LANG(?l) IN ({langs})) }}"""):
            q, s, lang = b["item"]["value"].rsplit("/", 1)[1], b["l"]["value"], b["l"]["xml:lang"]
            if b["kind"]["value"] == "label":
                got[q]["label"][lang] = s
            else:
                got[q]["aliases"].setdefault(lang, []).append(s)
        for b in wd_sparql(f"""SELECT ?item ?iso ?end WHERE {{ VALUES ?item {{ {vals} }}
              OPTIONAL {{ ?item wdt:P300 ?iso }} OPTIONAL {{ ?item wdt:P576 ?end }} }}"""):
            q = b["item"]["value"].rsplit("/", 1)[1]
            if "iso" in b:
                got[q]["iso"].append(b["iso"]["value"])
            if "end" in b:
                got[q]["ended"] = True
        for q, v in got.items():
            v["iso"] = sorted(set(v["iso"]))
            v["aliases"] = {k: sorted(set(x)) for k, x in sorted(v["aliases"].items())}
            items[q] = v
        print(f"wikidata: {min(i + 300, len(todo))}/{len(todo)} items fetched", flush=True)
    if todo or todo_p:
        cache["fetched"] = time.strftime("%Y-%m-%d")
        path.write_text(json.dumps(cache, ensure_ascii=False, sort_keys=True, indent=0), encoding="utf-8")
    return items, pre, cache.get("fetched")


def wd_label(item):
    return (item or {}).get("label", {}).get("en") or (item or {}).get("label", {}).get("mul")


def wd_strings(item, langs=("en", "mul")):
    """Wikidata labels and aliases in LANGS, without "Place, Country" forms, ISO codes and very long strings"""
    if not item:
        return []
    out = [item["label"][x] for x in langs if item["label"].get(x)]
    for x in langs:
        out += item["aliases"].get(x, [])
    return [s for s in out if "," not in s and len(s) <= 60 and not ISO_LIKE.match(s.strip())]


def strip_type(k):
    return TYPE_WORDS.sub("", k) or k


def load_gb(folder, country):
    iso3, _, rel = GB[country][:3]
    path = folder / f"geoBoundaries-{iso3}-ADM1.geojson"
    if not path.exists():
        folder.mkdir(parents=True, exist_ok=True)
        print(f"downloading geoBoundaries {rel} {iso3} ADM1", flush=True)
        urllib.request.urlretrieve(GB_URL.format(commit=GB_COMMIT, rel=rel, iso3=iso3), path)
    data = path.read_bytes()
    return json.loads(data)["features"], hashlib.sha256(data).hexdigest()


def gb_units(country, gb_feats, ne_items, wd, wd_prefix):
    """(props, geometry) for each geoBoundaries unit of COUNTRY, in Natural Earth's property names, and the match
    report. The Wikidata item is found by ISO code (Kenya) or by name among the country's ISO 3166-2 items; a
    Natural Earth unit with nearly the same outline (IoU >= GB_IOU) lends its names as aliases."""
    iso3, a2, _, utype = GB[country][:4]
    cand = {}  # name key -> QIDs, over the country's ISO 3166-2 items (current ones first)
    for q in wd_prefix.get(a2, []):
        it = wd.get(q)
        for s in wd_strings(it, WD_LANGS):
            for k in {key(s), strip_type(key(s))}:
                cand.setdefault(k, set()).add(q)
    ne_simple = [(p, shapely.simplify(g, 0.005, preserve_topology=True)) for p, g in ne_items]
    tree = shapely.STRtree([g for _, g in ne_simple])
    out, report = [], []
    for f in gb_feats:
        sp = f["properties"]
        gname = sp["shapeName"].strip()
        g = polygonal(shape(f["geometry"]))
        shapely.prepare(g)
        # Wikidata item
        qid = GB_QID.get((country, gname))
        iso_gb = (sp.get("shapeISO") or "").strip()
        if not qid and ISO_LIKE.match(iso_gb):
            hits = [q for q in wd_prefix.get(a2, []) if iso_gb in wd.get(q, {}).get("iso", [])]
            qid = hits[0] if len(hits) == 1 else None
        if not qid:
            hits = cand.get(key(gname), set()) | cand.get(strip_type(key(gname)), set())
            live = sorted(q for q in hits if not wd[q]["ended"])
            hits = live if live else sorted(hits)
            qid = hits[0] if len(hits) == 1 else None
        item = wd.get(qid) if qid else None
        isos = [x for x in (item or {}).get("iso", []) if x.startswith(a2 + "-") and ISO_LIKE.match(x)]
        iso = GB_ISO.get((country, gname)) or (iso_gb if ISO_LIKE.match(iso_gb) else
                                               (isos[0] if len(isos) == 1 else None))
        # Natural Earth unit with the same outline
        gs = shapely.simplify(g, 0.005, preserve_topology=True)
        best, best_iou = None, 0.0
        for j in tree.query(gs, predicate="intersects"):
            p, ng = ne_simple[j]
            inter = gs.intersection(ng).area
            iou = inter / (gs.area + ng.area - inter) if inter > 0 else 0.0
            if iou > best_iou:
                best, best_iou = p, iou
        disp, extra = GB_NAMES.get((country, gname), (None, []))
        if disp is None:
            lab = wd_label(item)
            disp = gname
            if lab:
                words = lab.split()
                if len(words) > 1 and words[-1].lower() in ("province", "region", "county", "state"):
                    lab = " ".join(words[:-1])
                disp = lab
        names = [gname] + list(extra)
        if best is not None and best_iou >= GB_IOU:
            names += [s for s in core_names(best) if s] + [best.get(f"name_{x}") for x in NAME_LANGS]
        props = {"adm1_code": f"{iso3}-gb-{sp['shapeID']}", "name": disp, "name_en": disp, "_extra": names,
                 "_display": disp, "iso_3166_2": iso, "type_en": GB_TYPE.get((country, gname), utype),
                 "region": None, "wikidataid": qid, "_source": "geoboundaries", "_gb_name": gname}
        out.append((props, g))
        report.append({"gb": gname, "id": props["adm1_code"], "name": disp, "qid": qid, "iso": iso,
                       "ne": best.get("name") if best is not None else None, "iou": round(best_iou, 3),
                       "ne_names_used": bool(best is not None and best_iou >= GB_IOU)})
    return out, report


def fix_props(props):
    """Natural Earth properties with PROP_FIX applied"""
    fx = PROP_FIX.get(props.get("adm1_code"))
    if not fx:
        return props
    p = dict(props)
    for k, v in fx.items():
        if k == "_names":
            for f in ["name", "name_en", "name_alt", "name_local", "woe_name", "gn_name", "gns_name"] + \
                     [f"name_{x}" for x in NAME_LANGS]:
                p[f] = None
            p["name"] = p["name_en"] = v
        else:
            p[k] = v
    return p


def fire_by_country(feats, cci, xs, ys, cell_v, n_countries):
    """per feature: fire (sum of the cells' values) by FIRMS country, over the cells whose centre it holds"""
    order = np.argsort(xs, kind="stable")
    xs_s = xs[order]
    out = []
    for _, g, _ in feats:
        w, s, e, n = g.bounds
        lo_, hi_ = np.searchsorted(xs_s, w, side="left"), np.searchsorted(xs_s, e, side="right")
        idx = order[lo_:hi_]
        idx = idx[(ys[idx] >= s) & (ys[idx] <= n)]
        ins = idx[shapely.contains_xy(g, xs[idx], ys[idx])] if len(idx) else idx
        out.append(np.bincount(cci[ins], weights=cell_v[ins], minlength=n_countries))
    return out


def ring_area(coords):
    lon = np.radians(coords[:, 0])
    lat = np.radians(coords[:, 1])
    return float(np.sum((lon[1:] - lon[:-1]) * (2 + np.sin(lat[:-1]) + np.sin(lat[1:]))) / 2)


def area_km2(g):
    a = 0.0
    for p in bws.polygons(g):
        a += abs(ring_area(np.asarray(p.exterior.coords)))
        for h in p.interiors:
            a -= abs(ring_area(np.asarray(h.coords)))
    return a * R_EARTH ** 2


def bbox_of(parts_bounds, dec=3):
    """[west, south, east, north]; west > east when the shape crosses 180 degrees (RFC 7946)"""
    b = np.asarray(parts_bounds, float)
    s, n = b[:, 1].min(), b[:, 3].max()
    w, e = b[:, 0].min(), b[:, 2].max()
    if e - w > 180:
        sh = b.copy()
        neg = sh[:, 2] <= 0
        sh[neg, 0] += 360
        sh[neg, 2] += 360
        w2, e2 = sh[:, 0].min(), sh[:, 2].max()
        if e2 - w2 < e - w:
            w, e = w2, e2 - 360
    f = 10 ** dec
    return [math.floor(w * f) / f, math.floor(s * f) / f, math.ceil(e * f) / f, math.ceil(n * f) / f]


def geom_json(g, dec):
    """GeoJSON geometry, exterior rings counter-clockwise, rounded; None if nothing is left"""
    polys = []
    for p in bws.polygons(g):
        p = shapely.geometry.polygon.orient(p, 1.0)
        rings = []
        for k, ring in enumerate([p.exterior, *p.interiors]):
            pts = []
            for x, y in np.asarray(ring.coords):
                pt = [round(float(x), dec), round(float(y), dec)]
                if not pts or pts[-1] != pt:
                    pts.append(pt)
            if pts and pts[0] != pts[-1]:
                pts.append(pts[0])
            xy = np.asarray(pts, float)
            area2 = float(np.sum(xy[:-1, 0] * xy[1:, 1] - xy[1:, 0] * xy[:-1, 1])) if len(pts) >= 4 else 0.0
            if area2 == 0:  # collapsed by the rounding
                pts = []
            elif (k == 0) != (area2 > 0):  # rounding flipped a tiny ring: exterior CCW, holes CW (RFC 7946)
                pts = pts[::-1]
            if len(pts) >= 4:
                rings.append(pts)
            elif k == 0:
                break
        if rings and len(rings[0]) >= 4:
            polys.append(rings)
    if not polys:
        return None
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def simplify_country(geoms):
    """coverage-simplified geometry JSON per province, the tolerance and decimals used"""
    arr = np.array(geoms, dtype=object)
    valid = bool(shapely.coverage_is_valid(arr))
    for tol in TOLERANCES:
        if valid:
            simp = shapely.coverage_simplify(arr, tol, simplify_boundary=True)
        else:
            simp = shapely.simplify(arr, tol, preserve_topology=True)
        dec = 3 if tol <= 0.01 else 2
        out = []
        for g0, g in zip(geoms, simp):
            j = geom_json(g, dec)
            if j is None:  # vanished: keep the original at the finest step
                j = geom_json(shapely.simplify(g0, 0.001, preserve_topology=True), 4)
            if not shape(j).is_valid:  # rounding made it touch itself: repair, then snap-round on the same grid
                try:
                    k = geom_json(shapely.set_precision(polygonal(shape(j)), 10 ** -dec), dec)
                except shapely.errors.GEOSException:
                    k = None
                j = k if k is not None and shape(k).is_valid else j
            out.append(j)
        size = sum(len(dumps(j)) for j in out)
        if size <= GEOM_BUDGET or tol == TOLERANCES[-1]:
            return out, tol, dec, size, valid
    raise AssertionError


def label_point(props, g, gj):
    """Natural Earth's label point when it lies in the simplified shape, else a point inside it"""
    sg = shape(gj)
    cands = []
    if props.get("longitude") is not None and props.get("latitude") is not None:
        cands.append((props["longitude"], props["latitude"]))
    big = max(bws.polygons(sg), key=lambda p: p.area, default=None)
    if big is not None:
        if not big.is_valid:
            big = max(bws.polygons(shapely.make_valid(big)), key=lambda p: p.area)
        q = shapely.ops.polylabel(big, tolerance=0.001) if big.area > 0 else big.representative_point()
        cands += [(q.x, q.y), big.representative_point().coords[0]]
    q = g.representative_point()
    cands.append((q.x, q.y))
    for dec in (3, 4, 5):
        for x, y in cands:
            pt = [round(float(x), dec), round(float(y), dec)]
            if shapely.contains_xy(sg, *pt):
                return pt
    return [round(float(cands[-1][0]), 3), round(float(cands[-1][1]), 3)]


def core_names(p):
    c = [p.get("name"), p.get("name_en")]
    for f in ("name_alt", "name_local"):
        c += (p.get(f) or "").split("|")
    return c + [p.get("woe_name"), p.get("gn_name"), p.get("gns_name")] + list(p.get("_extra") or [])


def clean(strings):
    out = []
    for s in strings:
        s = (s or "").strip()
        if s and len(key(s)) >= 2 and not JUNK.search(s):
            out.append(s)
    return out


def names_for(plist, country_name, wd):
    """display name, aliases (all scripts) and index aliases (Latin script) for each province of one country.

    Names come in two tiers: Natural Earth's own name fields (or geoBoundaries' name and the names of the Natural
    Earth unit it replaces), then Wikidata's English and language-neutral label and aliases (by the unit's QID; a
    QID that two units of the country share is not used). Each matching key goes to one province: the province
    whose display name it is; else the one whose Wikidata label it is; else the one whose Natural Earth name it is;
    else the only province that has it. A key two or more provinces have (and none of these rules settles) is
    dropped, except a name that is every holder's own Natural Earth name (Cork county and Cork city): it stays with
    all of them. The country's own name and a region name shared by two or more provinces are never aliases."""
    n = len(plist)
    ckey = key(country_name)
    qn = Counter(p.get("wikidataid") for p in plist if p.get("wikidataid"))
    items = [wd.get(p["wikidataid"]) if p.get("wikidataid") and qn[p["wikidataid"]] == 1 else None for p in plist]
    t1 = [clean(core_names(p) + [p.get(f"name_{l}") for l in NAME_LANGS]) for p in plist]
    t2 = [clean(wd_strings(it) + EXTRA_ALIASES.get(p["adm1_code"], [])) for p, it in zip(plist, items)]
    labels = [key(wd_label(it)) if wd_label(it) else None for it in items]
    lab_n = Counter(k for k in labels if k)
    used1 = Counter(k for c in t1 for k in {key(s) for s in c})
    region_n = Counter(key(p["region"]) for p in plist if p.get("region"))
    region_amb = {k for k, m in region_n.items() if m >= 2}
    amb = {k for k, m in used1.items() if m >= 2} | region_amb | {ckey}
    en_count = Counter(key(p["name_en"]) for p in plist if p.get("name_en"))
    ne_names = [(p.get("name") or p.get("name_en") or "").strip() for p in plist]
    # display names: Natural Earth's English name unless ambiguous; Wikidata's English label where Natural Earth's is
    # cut short ("Federal" -> "Federal District") or ambiguous ("Moskva" -> "Moscow", "Kiev" -> "Kyiv Oblast")
    bases = []
    for p, nm in zip(plist, ne_names):
        en = (p.get("name_en") or "").strip()
        k_en = key(en)
        use_en = bool(en) and (k_en == key(nm) or (k_en not in amb and en_count[k_en] == 1))
        bases.append((en if use_en else nm, use_en))
    base_n = Counter(key(b) for b, _ in bases if b)
    disp = []
    for i, (p, (base, use_en)) in enumerate(zip(plist, bases)):
        name = p.get("_display") or base
        lab, kl = wd_label(items[i]), labels[i]
        if (not p.get("_display") and lab and "," not in lab and kl != ckey and key(base) != ckey and lab_n[kl] == 1
                and kl not in region_amb and (base_n[kl] == 0 or kl == key(base))):
            kb = key(base)
            related = any(len(k) >= 4 and k in kl for k in {key(s) for s in t1[i]})
            generic_only = GENERIC.sub("", kl) == kb or GENERIC.sub("", GENERIC.sub("", kl)) == kb
            if (not generic_only and kb and kb != kl and kl.startswith(kb)) or (not use_en and related):
                name = lab
        disp.append(name or f"{country_name} (unnamed area)")
    # a name repeated within the country: the Wikidata labels when they tell the units apart, else the unit type
    groups = defaultdict(list)
    for i, nm in enumerate(disp):
        groups[key(nm)].append(i)
    for idx in groups.values():
        if len(idx) < 2:
            continue
        labs = [wd_label(items[i]) for i in idx]
        types = [plist[i].get("type_en") for i in idx]
        if all(labs) and len({key(x) for x in labs}) == len(idx):
            for i, x in zip(idx, labs):
                disp[i] = x
        elif all(types) and len({key(t) for t in types}) == len(idx):
            for i, t in zip(idx, types):
                disp[i] = f"{disp[i]} ({t})"
        else:
            for i in idx:
                disp[i] = f"{disp[i]} ({plist[i]['adm1_code']})"
    # who owns each matching key
    owner = {}
    for i, x in enumerate(disp):
        owner.setdefault(key(x), set()).add(i)
    for i, k in enumerate(labels):
        if k and lab_n[k] == 1 and k not in owner and k != ckey:
            owner[k] = {i}
    ne_n = Counter(key(x) for x in ne_names if x)
    for i, x in enumerate(ne_names):
        k = key(x)
        if k and ne_n[k] == 1 and k not in owner and k != ckey and k not in region_amb:
            owner[k] = {i}
    holders = defaultdict(set)
    for i in range(n):
        for s in t1[i] + t2[i]:
            holders[key(s)].add(i)
    for k, h in holders.items():
        if not k or k in owner or k == ckey or k in region_amb:
            continue
        if len(h) == 1 or all(key(ne_names[j]) == k for j in h):
            owner[k] = h
    out = []
    for i, p in enumerate(plist):
        seen = {key(disp[i])}
        aliases = []
        for s in [ne_names[i]] + t1[i] + t2[i]:
            k = key(s)
            if not s or k in seen or i not in owner.get(k, ()):
                continue
            seen.add(k)
            aliases.append(s)
        core = {key(s) for s in core_names(p) + t2[i] if s}
        out.append((disp[i], aliases, [s for s in aliases if key(s) in core and is_latin(s)]))
    return out


# ---------------------------------------------------------------- fire

def load_cells(con, monthly, countries):
    con.execute("CREATE TABLE ctry (ci INTEGER, country VARCHAR)")
    con.executemany("INSERT INTO ctry VALUES (?, ?)", list(enumerate(countries)))
    con.execute(f"""CREATE TABLE cells AS
        SELECT (row_number() OVER (ORDER BY ci, la, lo) - 1)::INTEGER AS cid, ci, la, lo
          FROM (SELECT DISTINCT country, la, lo FROM read_parquet('{monthly}')) JOIN ctry USING (country)""")
    missing = con.execute(f"""SELECT count(*) FROM (SELECT DISTINCT country FROM read_parquet('{monthly}'))
                               WHERE country NOT IN (SELECT country FROM ctry)""").fetchone()[0]
    if missing:
        raise SystemExit(f"{missing} countries in the monthly table are not in summary/v3")
    c = con.execute("SELECT cid, ci, la, lo FROM cells ORDER BY cid").fetchnumpy()
    assert (c["cid"] == np.arange(len(c["cid"]))).all()
    return c["ci"].astype(np.int32), c["la"].astype(np.int32), c["lo"].astype(np.int32)


def assign_cells(cci, la, lo, geoms_by_country, countries):
    """global province index per cell (-1 = unassigned) and how each cell was placed (0 inside, 1 snapped, 2 none)"""
    pid = np.full(len(cci), -1, np.int64)
    how = np.full(len(cci), 2, np.int8)
    dist = np.full(len(cci), np.inf)
    overlaps = 0
    xs = (lo + 0.5) * CELL
    ys = (la + 0.5) * CELL
    bounds = np.searchsorted(cci, np.arange(len(countries) + 1))
    for ci in range(len(countries)):
        a, b = bounds[ci], bounds[ci + 1]
        plist = geoms_by_country.get(ci)
        if a == b or not plist:
            continue
        x, y = xs[a:b], ys[a:b]
        local = np.full(b - a, -1, np.int64)
        for gidx, g in plist:
            w, s, e, n = g.bounds
            sel = np.nonzero((x >= w) & (x <= e) & (y >= s) & (y <= n))[0]
            if not len(sel):
                continue
            inside = sel[shapely.contains_xy(g, x[sel], y[sel])]
            overlaps += int((local[inside] >= 0).sum())
            local[inside[local[inside] < 0]] = gidx
        hit = local >= 0
        how[a:b][hit] = 0
        miss = np.nonzero(~hit)[0]
        if len(miss):
            tree = shapely.STRtree([g for _, g in plist])
            pts = shapely.points(x[miss], y[miss])
            (ii, jj), d = tree.query_nearest(pts, return_distance=True, all_matches=False)
            dd = np.full(len(miss), np.inf)
            dd[ii] = d
            near = np.full(len(miss), -1, np.int64)
            near[ii] = np.array([plist[j][0] for j in jj], np.int64)
            dist[a:b][miss] = dd
            ok = dd <= SNAP
            local[miss[ok]] = near[ok]
            how[a:b][miss[ok]] = 1
        pid[a:b] = local
    return pid, how, dist, overlaps


def largest_remainder(exact, target):
    """round each column of exact (rows = parts) to integer tenths that add up to target (tenths) per column"""
    e = exact * 10
    fl = np.floor(e + 1e-6)  # float noise of the sums is far below 1e-6 tenths
    need = (target - fl.sum(0)).astype(np.int64)
    frac = np.maximum(np.round(e - fl, 6), 0)  # ties go to the earlier row (provinces by name, unassigned last)
    order = np.argsort(-frac, axis=0, kind="stable")
    rank = np.empty_like(order)
    np.put_along_axis(rank, order, np.arange(e.shape[0])[:, None].repeat(e.shape[1], 1), axis=0)
    if (need < 0).any() or (need > e.shape[0]).any():
        raise SystemExit("largest remainder: impossible column")
    return (fl + (rank < need[None, :])).astype(np.int64)


def watch_years(m, partial_i):
    """the ten latest years with calendar month m complete (as src/acells.ts watchYears)"""
    last_full = partial_i - 1
    cy = Y0 + (NM - 1) // 12
    yb = Y0 + (last_full + 1) // 12 - 1
    cy_last = last_full - (cy - Y0) * 12
    last_y = cy if (m <= cy_last and cy > yb) else yb
    return list(range(last_y - 9, last_y + 1)), yb


def outlook(series_tenths, partial_i):
    """usual (median 2001..yb per calendar month) and watch (0.6 median of the last ten + 0.4 mean of the last three)"""
    s = series_tenths / 10
    usual, watch, wy = [], [], []
    for m in range(12):
        years, yb = watch_years(m, partial_i)
        hist = [s[(y - Y0) * 12 + m] for y in range(Y0, yb + 1)]
        usual.append(r1(np.median(hist)))
        vals = [s[(y - Y0) * 12 + m] for y in years]
        watch.append(r1(0.6 * np.median(vals) + 0.4 * np.mean(vals[-3:])))
        wy.append([years[0], years[-1]])
    return usual, watch, wy


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ne", type=Path, required=True)
    ap.add_argument("--monthly", type=Path, required=True)
    ap.add_argument("--cells-v1", type=Path, required=True)
    ap.add_argument("--fine-v1", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--gb", type=Path, default=None, help="folder with the geoBoundaries ADM1 files (default: --ne)")
    ap.add_argument("--wikidata", type=Path, default=None,
                    help="Wikidata names cache (default: --ne/wikidata_names.json; fetched when missing)")
    a = ap.parse_args()
    a.gb = a.gb or a.ne
    a.wikidata = a.wikidata or a.ne / "wikidata_names.json"
    t0 = time.time()
    v3i = json.load(open(V3 / "index.json"))
    countries = [c["country"] for c in v3i["countries"]]
    cname = {c["country"]: c["name"] for c in v3i["countries"]}
    first = json.load(open(V3 / f"{countries[0]}.json"))
    partial, last_date = first["partial"], first["last_date"]
    assert v3i["n_months"] == NM == first["n_months"] and partial["i"] == NM - 1

    # fire cells and their monthly rows
    con = duckdb.connect()
    con.execute("SET threads TO 6")
    cci, la, lo = load_cells(con, a.monthly, countries)
    xs, ys = (lo + 0.5) * CELL, (la + 0.5) * CELL
    # ordered, so that every float sum below adds in the same order on every run
    m = con.execute(f"""SELECT c.cid, m.i, m.v FROM read_parquet('{a.monthly}') m
                        JOIN ctry USING (country) JOIN cells c ON c.ci = ctry.ci AND c.la = m.la AND c.lo = m.lo
                        ORDER BY c.cid, m.i""").fetchnumpy()
    cid, mi, mv = m["cid"].astype(np.int64), m["i"].astype(np.int64), m["v"].astype(float)
    del m
    if len(cid) != con.execute(f"SELECT count(*) FROM read_parquet('{a.monthly}')").fetchone()[0]:
        raise SystemExit("rows lost in the join")
    cell_v = np.bincount(cid, weights=mv, minlength=len(cci))
    print(f"[{time.time() - t0:.0f}s] {len(cci)} fire cells, {len(cid)} cell-months", flush=True)

    # boundaries: owner by map unit, overridden where FIRMS files nearly all of a province's fire elsewhere
    feats, nearest, ne_sha = map_unit_owners(countries, a.ne)
    feats = [(fix_props(props), g, owner) for props, g, owner in feats]
    unknown = {o for _, _, o in feats if o is not None and o not in cname}
    if unknown:
        raise SystemExit(f"provinces given to unknown countries: {unknown}")
    fire = fire_by_country(feats, cci, xs, ys, cell_v, len(countries))
    moved, left_out, by_country = [], [], defaultdict(list)
    for (props, g, owner), fc in zip(feats, fire):
        tot = float(fc.sum())
        top = int(np.argmax(fc)) if tot > 0 else -1
        if top >= 0 and countries[top] != owner and fc[top] >= MOVE_MIN and fc[top] >= MOVE_SHARE * tot:
            moved.append({"id": props["adm1_code"], "name": props["name"], "from": owner, "to": countries[top],
                          "share": round(float(fc[top] / tot), 3), "fire": round(float(fc[top]), 1),
                          "fire_of_from": round(float(fc[countries.index(owner)]), 1) if owner else 0})
            owner = countries[top]
            props = dict(props, region=None)  # Natural Earth's region is the other country's grouping
        if owner is None:
            left_out.append({"id": props["adm1_code"], "name": props["name"], "admin": props["admin"],
                             "fire": round(tot, 1)})
            continue
        by_country[owner].append((props, g))
    stats = {"ne_features": len(feats), "ne_left_out": left_out, "ne_by_nearest_map_unit": nearest,
             "moved_by_fire": moved}
    if sum(len(v) for v in by_country.values()) + len(left_out) != len(feats):
        raise SystemExit("a Natural Earth province was lost or doubled")
    for c in REGION_NULL:
        by_country[c] = [(dict(props, region=None), g) for props, g in by_country.get(c, [])]

    # names from Wikidata (CC0); current units from geoBoundaries where Natural Earth's are years out of date
    qids = {p["wikidataid"] for v in by_country.values() for p, _ in v if p.get("wikidataid")} | set(GB_QID.values())
    wd, wd_prefix, wd_date = wikidata_names(a.wikidata, qids, sorted({v[1] for v in GB.values()}))
    gb_sha, gb_report = {}, {}
    for c in GB:
        gb_feats, gb_sha[c] = load_gb(a.gb, c)
        ne_items = by_country.get(c, [])
        units, rep = gb_units(c, gb_feats, ne_items, wd, wd_prefix)
        gb_report[c] = {"ne_replaced": [p["adm1_code"] for p, _ in ne_items], "units": rep}
        by_country[c] = units
        print(f"[{time.time() - t0:.0f}s] {c}: {len(ne_items)} Natural Earth units replaced by {len(units)} from "
              f"geoBoundaries; no Wikidata item for {[r['gb'] for r in rep if not r['qid']]}", flush=True)
    stats["geoboundaries"] = gb_report
    P = []  # global province list: dict with ci, props, geom
    geoms_by_country = defaultdict(list)
    for ci, c in enumerate(countries):
        items = by_country.get(c, [])
        named = names_for([p for p, _ in items], cname[c], wd)
        order = sorted(range(len(items)), key=lambda k: (key(named[k][0]), items[k][0]["adm1_code"]))
        for k in order:
            props, g = items[k]
            gi = len(P)
            P.append({"ci": ci, "props": props, "geom": g, "name": named[k][0], "aliases": named[k][1],
                      "core": named[k][2]})
            geoms_by_country[ci].append((gi, g))
    NP = len(P)
    print(f"[{time.time() - t0:.0f}s] {NP} provinces in {len(geoms_by_country)} countries; "
          f"{len(left_out)} left out: {[x['name'] for x in left_out]}; moved by fire: "
          f"{[(x['name'], x['from'], x['to'], x['share']) for x in moved]}", flush=True)

    # fire cells -> provinces
    pid, how, dist, overlaps = assign_cells(cci, la, lo, geoms_by_country, countries)
    print(f"[{time.time() - t0:.0f}s] cells placed: inside {int((how == 0).sum())}, snapped "
          f"{int((how == 1).sum())}, unassigned {int((how == 2).sum())}; overlapping hits {overlaps}", flush=True)
    stats["overlapping_province_hits"] = overlaps

    # monthly sums per slot: provinces 0..NP-1, then one unassigned slot per country
    slot = np.where(pid >= 0, pid, NP + cci.astype(np.int64))
    S = np.bincount(slot[cid] * NM + mi, weights=mv, minlength=(NP + len(countries)) * NM).reshape(-1, NM)
    C = np.bincount(cci[cid].astype(np.int64) * NM + mi, weights=mv, minlength=len(countries) * NM).reshape(-1, NM)
    # value-weighted placement shares
    tot_v = cell_v.sum()
    stats["share_inside"] = float(cell_v[how == 0].sum() / tot_v)
    stats["share_snapped"] = float(cell_v[how == 1].sum() / tot_v)
    stats["share_unassigned"] = float(cell_v[how == 2].sum() / tot_v)
    fin = np.isfinite(dist)
    stats["snap_distance_shares"] = {str(t): float(cell_v[fin & (dist > t)].sum() / tot_v)
                                     for t in (0.05, 0.1, 0.25, 0.5, 1.0)}
    del cid, mi, mv
    print(f"[{time.time() - t0:.0f}s] shares of fire: inside {stats['share_inside']:.5f}, snapped "
          f"{stats['share_snapped']:.5f}, unassigned {stats['share_unassigned']:.5f}; beyond distance: "
          f"{stats['snap_distance_shares']}", flush=True)
    if stats["share_unassigned"] > MAX_UNASSIGNED:
        raise SystemExit(f"unassigned share {stats['share_unassigned']:.4f} over {MAX_UNASSIGNED}")

    # cross-checks of the exact sums
    pc = np.array([p["ci"] for p in P], np.int64)
    back = np.zeros_like(C)
    np.add.at(back, pc, S[:NP])
    back += S[NP:]
    if np.abs(back - C).max() > 1e-6 * max(1.0, C.max()):
        raise SystemExit(f"slot sums differ from the country sums by {np.abs(back - C).max()}")
    stats["slot_vs_country_max_abs"] = float(np.abs(back - C).max())

    # the rounded country months: the published cells/v1 month sums, which are the exact sums rounded to 0.1
    cv = np.zeros((len(countries), NM))
    for ci, c in enumerate(countries):
        d = json.load(open(a.cells_v1 / f"{c}.json"))
        r = np.array(d["rows"], float).reshape(-1, 3)
        np.add.at(cv[ci], r[:, 1].astype(int), r[:, 2])
    CV = np.round(cv * 10).astype(np.int64)
    md = np.abs(CV / 10 - C)
    k, i = np.unravel_index(np.argmax(md), md.shape)
    stats["cells_v1_vs_exact_month_max_abs"] = float(md.max())
    stats["cells_v1_vs_exact_month_worst"] = [countries[k], int(i), float(C[k, i]), float(CV[k, i] / 10)]
    stats["cells_v1_months_not_half_up"] = int((CV != np.floor(C * 10 + 0.5 + 1e-9)).sum())
    if md.max() > 0.05 + 1e-6:
        raise SystemExit(f"{countries[k]} month {i}: exact {C[k, i]} vs cells/v1 {cv[k, i]}")

    # rounding per country-month: largest remainder to the cells/v1 month total
    T = np.zeros((NP + len(countries), NM), np.int64)
    members = defaultdict(list)
    for gi, p in enumerate(P):
        members[p["ci"]].append(gi)
    for ci in range(len(countries)):
        rows = members[ci] + [NP + ci]
        T[rows] = largest_remainder(S[rows], CV[ci])
        if (T[rows].sum(0) != CV[ci]).any():
            raise SystemExit(f"{countries[ci]}: rounded sums do not add up")
    if (T < 0).any():
        raise SystemExit("negative rounded value")
    if np.abs(T / 10 - S).max() >= 0.1 + 1e-6:
        raise SystemExit(f"a rounded value moved by {np.abs(T / 10 - S).max()}")
    stats["rounding_max_move"] = float(np.abs(T / 10 - S).max())
    CT = CV
    # against fine/v1 year totals
    fy = np.zeros((len(countries), NY))
    for ci, c in enumerate(countries):
        fy[ci] = json.load(open(a.fine_v1 / c / "index.json"))["year_totals"]
    py = np.stack([CT[:, y * 12:min(NM, y * 12 + 12)].sum(1) for y in range(NY)], 1) / 10
    yd = np.abs(py - fy)
    k, y = np.unravel_index(np.argmax(yd), yd.shape)
    stats["fine_v1_year_max_abs"] = float(yd.max())
    stats["fine_v1_year_worst"] = [countries[k], Y0 + int(y), float(py[k, y]), float(fy[k, y])]
    if yd.max() > 0.65:
        raise SystemExit(f"{countries[k]} {Y0 + y}: provinces {py[k, y]} vs fine/v1 {fy[k, y]}")
    print(f"[{time.time() - t0:.0f}s] sums checked: exact vs cells/v1 month max {md.max():.3f}, rounded province "
          f"moves under {stats['rounding_max_move']:.3f}, fine/v1 year max {yd.max():.3f}", flush=True)

    # per-cell counts per province
    n_cells = np.bincount(slot, minlength=NP + len(countries))

    # write
    a.out.mkdir(parents=True, exist_ok=True)
    source = {
        "boundaries": "Natural Earth 1:10m Admin 1 - States, Provinces (ne_10m_admin_1_states_provinces), "
                      "github.com/nvkelso/natural-earth-vector master (VERSION 5.2.0-pre), downloaded 2026-11-15",
        "boundaries_licence": "public domain (naturalearthdata.com/about/terms-of-use)",
        "boundaries_sha256": ne_sha,
        "fire": "fine/v1 monthly values (0.05 degree cells), harmonized as summary/v3 and cells/v1",
        "names": f"Natural Earth name fields, plus Wikidata English and language-neutral labels and aliases by each "
                 f"unit's QID (CC0, fetched {wd_date})",
        "geoboundaries": {c: f"{v[2]} {v[0]} ADM1, {v[7]}: {v[5]} ({v[6]}), {v[4]}" for c, v in GB.items()},
    }
    rule = (f"cell centre in the province (full-resolution outline, before simplification); a centre in no province "
            f"of its country goes to the nearest one within {SNAP} degrees, else to 'unassigned'")
    watch_y = outlook(np.zeros(NM), partial["i"])[2]
    index_c, index_p, rank_rows, geo_stats = [], [], [], []
    for ci, c in enumerate(countries):
        gis = members[ci]
        geoms = [P[g]["geom"] for g in gis]
        if geoms:
            gjs, tol, dec, gbytes, valid = simplify_country(geoms)
        else:
            gjs, tol, dec, gbytes, valid = [], None, None, 0, True
        geo_stats.append({"country": c, "tol": tol, "dec": dec, "bytes": gbytes, "coverage_valid": valid})
        provs = []
        all_bounds = []
        for g, gj in zip(gis, gjs):
            p, props = P[g], P[g]["props"]
            series = T[g]
            per_year = [int(series[y * 12:min(NM, y * 12 + 12)].sum()) for y in range(NY)]
            usual, watch, wy = outlook(series, partial["i"])
            # bbox around both the Natural Earth outline and the published (simplified, rounded) one
            pb = [q.bounds for q in bws.polygons(p["geom"])] + [q.bounds for q in bws.polygons(shape(gj))]
            all_bounds += pb
            iso = props.get("iso_3166_2") or ""
            iso = iso if re.fullmatch(r"[A-Z]{2}-[A-Z0-9]{1,3}", iso) else None
            provs.append({
                "id": props["adm1_code"],
                "iso": iso,
                "name": p["name"],
                "aliases": p["aliases"],
                "type": props.get("type_en"),
                "region": props.get("region"),
                "wikidata": props.get("wikidataid"),
                "bbox": bbox_of(pb),
                "label": label_point(props, p["geom"], gj),
                "area_km2": int(round(area_km2(p["geom"]))),
                "cells": int(n_cells[g]),
                "total": t2n(series.sum()),
                "per_year": [t2n(t) for t in per_year],
                "usual": usual,
                "watch": watch,
                "monthly": [t2n(t) for t in series],
                "geometry": gj,
            })
        # an ISO code two units share stays with the one whose Wikidata item has it (New South Wales, not Lord Howe)
        isos = Counter(q["iso"] for q in provs if q["iso"])
        for code in [k for k, m in isos.items() if m > 1]:
            has = [q for q in provs if q["iso"] == code and code in wd.get(q["wikidata"] or "", {}).get("iso", [])]
            for q in provs:
                if q["iso"] == code and not (len(has) == 1 and q is has[0]):
                    q["iso"] = None
        if c in GB:
            g3, _, rel, _, lic, gsrc, gyear, gunits = GB[c]
            src_c = dict(source, boundaries=f"geoBoundaries {rel} {g3} ADM1 ({gsrc}, {gyear}), "
                                            f"github.com/wmgeolab/geoBoundaries commit {GB_COMMIT}",
                         boundaries_licence=lic, boundaries_sha256=gb_sha[c])
            lic_c = (f"Province boundaries: geoBoundaries (Runfola et al. 2020, geoboundaries.org), from {gsrc}, "
                     f"{lic}. Names: geoBoundaries, Wikidata (CC0) and Natural Earth (public domain). Fire values: "
                     f"derived from NASA FIRMS (see the dataset card).")
            bnd = {"source": "geoBoundaries", "units": gunits, "outdated": c in GB_OUTDATED,
                   "note": " ".join(x for x in [f"geoBoundaries {gyear} ({gsrc}): {gunits}, replacing Natural "
                                                f"Earth's older units.", GB_NOTES.get(c)] if x)}
        else:
            src_c, lic_c = source, LICENCE
            bnd = {"source": "Natural Earth", "units": None, "outdated": c in BOUNDARY_NOTES,
                   "note": BOUNDARY_NOTES.get(c)}
        U = T[NP + ci]
        ctot = int(CT[ci].sum())
        cells_c = int((cci == ci).sum())
        doc = {
            "v": 1,
            "country": c,
            "name": cname[c],
            "y0": Y0,
            "n_months": NM,
            "partial": partial,
            "last_date": last_date,
            "cell": CELL,
            "assign": rule,
            "boundaries": bnd,
            "unit_types": dict(Counter(P[g]["props"].get("type_en") or "unknown" for g in gis).most_common()),
            "watch_years": watch_y,
            "moved_in": [x for x in moved if x["to"] == c],
            "moved_out": [x for x in moved if x["from"] == c],
            "bbox": bbox_of(all_bounds) if all_bounds else None,
            "total": t2n(ctot),
            "country_monthly": [t2n(t) for t in CT[ci]],
            "unassigned": {"cells": int(n_cells[NP + ci]), "total": t2n(U.sum()),
                           "share": round(float(U.sum() / ctot), 5) if ctot else 0,
                           "monthly": [t2n(t) for t in U]},
            "fire_cells": cells_c,
            "geometry_simplify": {"method": "GEOS coverage simplification (shared borders kept)" if valid else
                                  "per-shape topology-preserving simplification", "tolerance_deg": tol,
                                  "decimals": dec},
            "source": src_c,
            "licence": lic_c,
            "provinces": provs,
        }
        body = dumps(doc)
        (a.out / f"{c}.json").write_text(body, encoding="utf-8")
        nbytes = len(body.encode("utf-8"))
        if nbytes >= MAX_FILE:
            raise SystemExit(f"{c}.json is {nbytes} bytes")
        index_c.append({"country": c, "name": cname[c], "file": f"{c}.json", "bytes": nbytes,
                        "provinces": len(provs), "bbox": doc["bbox"], "total": doc["total"],
                        "unassigned_share": doc["unassigned"]["share"], "boundaries": bnd["source"],
                        "outdated": bnd["outdated"], "boundary_note": bnd["note"]})
        for g, q in zip(gis, provs):
            b = q["bbox"]
            index_p.append([ci, q["id"], q["name"], P[g]["core"], q["region"],
                            [math.floor(b[0] * 100) / 100, math.floor(b[1] * 100) / 100,
                             math.ceil(b[2] * 100) / 100, math.ceil(b[3] * 100) / 100],
                            [round(q["label"][0], 2), round(q["label"][1], 2)],
                            q["total"], r1(sum(T[g][15 * 12:25 * 12]) / 100)])
            rank_rows.append([ci, q["id"], q["usual"], q["watch"]])
    index = {"v": 1, "y0": Y0, "n_months": NM, "partial": partial, "last_date": last_date, "cell": CELL,
             "files": "provinces/v1/<country>.json (countries[].file)", "source": source, "licence": LICENCE,
             "columns": ["c", "id", "name", "aliases", "region", "bbox", "label", "total", "mean_10y"],
             "column_notes": {"c": "index into countries", "aliases": "Latin-script aliases: Natural Earth's own "
                              "name fields and Wikidata's English labels and aliases (the country file has all, in "
                              "every script)",
                              "bbox": "[west, south, east, north] rounded outward to 0.01 degree; west > east when "
                              "the province crosses 180 degrees", "total": "harmonized hotspots 2001 to the last "
                              "date", "mean_10y": "mean harmonized hotspots per year, 2016-2025"},
             "countries": index_c, "provinces": index_p}
    (a.out / "index.json").write_text(dumps(index), encoding="utf-8")
    rank = {"v": 1, "y0": Y0, "n_months": NM, "partial": partial, "last_date": last_date, "watch_years": watch_y,
            "columns": ["c", "id", "usual", "watch"],
            "note": "c = index into index.json countries; usual[m] = median of calendar month m over 2001-2025; "
                    "watch[m] = 0.6 x median of month m in the ten latest years with it complete (watch_years[m]) "
                    "+ 0.4 x mean of the last three of those; both rounded to 0.1",
            "rows": rank_rows}
    (a.out / "rank.json").write_text(dumps(rank), encoding="utf-8")
    stats["geometry"] = geo_stats
    stats["elapsed_s"] = round(time.time() - t0, 1)
    stats["n_provinces"] = NP
    stats["unassigned_by_country"] = sorted(
        [{"country": c, "share": index_c[ci]["unassigned_share"], "total": t2n(T[NP + ci].sum())}
         for ci, c in enumerate(countries) if T[NP + ci].sum() > 0], key=lambda r: -r["total"])
    a.report.write_text(json.dumps(stats, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"[{time.time() - t0:.0f}s] wrote {len(countries)} country files, index "
          f"{(a.out / 'index.json').stat().st_size:,} bytes, rank {(a.out / 'rank.json').stat().st_size:,} bytes",
          flush=True)


if __name__ == "__main__":
    main()
