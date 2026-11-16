#!/usr/bin/env python3
"""Build stations/v1: OpenStreetMap fire stations near every FIRMS fire grid cell, per country.

Output, added to the Hugging Face dataset mirror (build/hf/stations/v1/):

    <Country>.json  stations, nearest-station rows for every fire grid cell of summary/v2/<Country>.json,
                    gap cells, a station ranking, a mapping-completeness flag and a method note
    index.json      per-country station count, completeness and gap count

The exact format is documented in the "Fire stations (OpenStreetMap)" section of dataset/README.md.

Method:

  * Stations: every OpenStreetMap object tagged amenity=fire_station (nodes, ways and relations; the
    centroid of ways and relations), with its OSM type and id, name and operator.
    --source qlever (default): one query to the QLever SPARQL endpoint over the whole OSM planet
    (osm2rdf, University of Freiburg), which states its planet file date in its stats.
    --source overpass: the Overpass API in large tiles, one query at a time with PAUSE_S between,
    exponential backoff and alternative instances. On 15 November 2026 every public Overpass instance
    tried was at capacity (HTTP 502 or no answer), so the published files come from QLever. Both
    serve the same OpenStreetMap data; only the snapshot date can differ.
    Objects are deduplicated by OSM type and id, then objects within MERGE_M of each other are merged
    into one site (a station mapped as a node and as a building, or as several buildings: about 4% of
    objects), keeping the named one, else the node.
  * Country: point in polygon against the world.js outlines (Natural Earth admin-0, simplified to
    0.05 degrees, keyed by FIRMS country name). Where outlines overlap (enclaves: world.js keeps outer
    rings only) the smallest polygon wins. A station outside every outline (coast, islands, the
    simplification) goes to the nearest outline within OFFSHORE_KM; beyond that it is dropped.
  * Fire cells: the cells of summary/v2/<Country>.json, decoded exactly as the site does
    (src/country.ts cellIndexes): cells[2c] = floor(lat / cell), cells[2c + 1] = floor(lon / cell),
    undoing the legacy west-of-Greenwich packing if present; centre ((la + .5) * cell, (lo + .5) * cell).
  * Distance: great-circle km from the cell centre to the 3 nearest stations of the same country
    (KD-tree on 3-D unit vectors, chord converted to arc length). Only the country's own stations are
    searched, so near a border the true nearest station may be closer, across the border.
  * Burn share: the share of the 14 years 2012-2025 in which the cell has any detection (any row in
    cell_rows for that year: harmonized, MODIS or VIIRS count above 0).
  * Gap: burn share >= GAP_SHARE (at least 4 of 14 years) and nearest mapped station > GAP_KM.
    It says no station is MAPPED within GAP_KM, not that none exists.
  * Persistent heat sources: VIIRS (Suomi NPP, type 0, confidence n/h) detections 2012-2025 on the
    0.05 degree base grid; a base cell seen in >= PERSIST_MONTHS distinct months of a year in >=
    PERSIST_YEARS years, and holding >= PERSIST_ISOLATION of its 3 x 3 neighbourhood's detections, is
    a persistent point source (gas flares, industry, solar plants such as Ivanpah; FIRMS does not type
    them all as static). A fire cell with >= PERSIST_SHARE of its detections from such spots is listed in
    "persistent" and is never a gap or credited in the ranking.
  * Ranking: every other cell's mean yearly harmonized count over 2012-2025 is credited to its nearest
    station; stations are ranked by the total ("most fire nearby"); the top RANK_N are kept.
  * Completeness: OSM stations per million people (Natural Earth POP_EST) divided by the median of the
    country's income-group peers (Natural Earth INCOME_GRP; peers with at least PEER_MIN_POP people).
    Stations follow people more than land, so this is the flag; stations per 10,000 km2 of land
    (outline area minus enclaves) against the same peers is reported beside it. Because a whole income
    group can be under-mapped (the low-income median is under 0.5 per million), there are also absolute
    floors: national fire services almost everywhere run more than THIN_ABS stations per million
    people (India about 2.4, with about 3,400 stations). Levels: "thin" (ratio < THIN, or < THIN_ABS per
    million, or fewer than MIN_STATIONS stations with POP_EST >= MIN_STATIONS_POP); "patchy" (ratio <
    FAIR or < FAIR_ABS per million); "fair" (the rest); "unpopulated" (POP_EST < UNPOP); "no_data" (no
    population figure). "fair" means "mapped about as densely as its peers", not complete.
    Checked by hand against national station counts (see the dataset card).

--version 2 (stations/v2) keeps the stations, distances, completeness and gap distance of v1 and changes
what counts as fire (v1 is kept as published; run with --version 1 to rebuild it):

  * Fire: only VIIRS Suomi NPP detections, FIRMS type 0 (presumed vegetation fire), confidence n or h,
    2012-2025, read from the archive (build/hf/viirs-snpp). MODIS no longer adds burn years.
  * Static sources are removed detection by detection before anything is counted:
      - FIRMS static flag: a 0.01 degree spot where FIRMS typed detections 1 (volcano), 2 (other static
        land source: flares, industry) or 3 (offshore) in >= STATIC_SPOT_YEARS years, any sensor
        (MODIS, Suomi NPP, NOAA-20). Type 0 detections in that spot or the 8 spots around it (about
        1 km) are static too: FIRMS flags the pixel, and the flare's neighbouring pixels stay type 0.
      - Recurrent night spots: a 0.01 degree spot with type 0 detections in >= RECUR_YEARS years, in >=
        RECUR_MONTHS different calendar months, at least RECUR_NIGHT of them at night; or the same test
        on the spot pooled with its 8 neighbours (about 3 km: a flare's detections scatter over
        neighbouring spots), which also needs >= RECUR_POOL_WEAK weak night detections, and passes with
        >= RECUR_NIGHT_MONTHS months when >= RECUR_NIGHT_ONLY are at night (flares FIRMS has not typed;
        a field or a savanna patch burns in its season, and by day; the daytime all-year spots are sugar
        estates and shifting farms near the equator, which are fire).
      - The v1 persistent 0.05 degree squares, and (as in summary/v2) a 0.05 degree square for a whole year
        when any sensor has a type 1-3 detection in it that year.
  * Mask (cell listed in "persistent", never a gap, never credited in the ranking). Seasonal means at least
    SEASONAL_TOP6 of the remaining detections fall in the busiest 6 calendar months (vegetation fire has
    one or two burning seasons; a flare burns all year) and at least MASK_MIN_N remain. The static share
    leaves out the typed square-years, which remove fire too. Any of:
      1. static: >= PERSIST_SHARE of the cell's Suomi NPP n/h detections are static (above), unless what
         is left is seasonal and >= BIG_PER_YEAR a year (a boreal or savanna cell with a flare in it);
         or >= STATIC_SHARE are static and what is left is not seasonal; or v1 listed it as persistent;
      2. flare_field: FIRMS typed 1-3 detections in >= MASK_STATIC_YEARS of the 14 years inside the cell
         or within one 0.05 degree square of its edge, and what is left is sparse (< SPARSE_PER_YEAR a
         year: spill-over around typed flares, such as Shaybah), or what is left is under BIG_PER_YEAR a
         year with >= FLARE_WEAK_NIGHT weak night detections and is not seasonal (Hassi Messaoud); or FIRMS
         typed detections there in >= FLARE_LONG_YEARS years, they outnumber what is left (FLARE_LONG_RATIO;
         Berkine flares in Algeria: 200-460 times; a sugar mill, mine or rice mill typed beside its fields
         in Senegal, Mali, Java or Arnhem Land: 0.05-0.4) and what is left is under BIG_PER_YEAR a year,
         seasonal or not (the seasonal exemption does not apply); or the same within FLARE_WIDE_RING
         squares (about 20 km) with FLARE_WIDE_RATIO times as many typed detections and under
         FLARE_WIDE_TOP6 in the busiest 6 months, in cells up to FLARE_WIDE_MAX_CELL degrees (desert oil
         fields around Hassi Messaoud; a 0.5-1 degree cell is wider than the ring);
      3. night_all_season: in >= NIGHT_MIN_YEARS years and >= NIGHT_MIN_MONTHS calendar months, and either
         >= NIGHT_WEAK_SHARE of what is left are weak night detections (FRP < WEAK_FRP_MW; vegetation
         fire at night has a median near 3 MW, flares near 1 MW) or >= NIGHT_SHARE are at night, with
         under NIGHT_MAX_TOP6 in the busiest 6 months; or >= NIGHT_SHARE_LOW at night with under
         NIGHT_LOW_MAX_TOP6 (flare fields FIRMS has not typed: the Bakken in North Dakota, the Eagle Ford
         in Texas, Ghawar in Saudi Arabia). Dry-forest fires in India and Thailand also burn weakly at
         night, but in one season, so the top-6 limit spares them;
      4. night_weak: in >= NIGHT_ONLY_YEARS burn years (every gap), >= NIGHT_ONLY_WEAK of what is left
         weak night detections, and >= NIGHT_ONLY_SHARE at night whatever the months, or >=
         NIGHT_SPREAD_SHARE at night over >= NIGHT_SPREAD_MONTHS calendar months with >= MASK_MIN_N left
         (flares, brick kilns and mines seen in a few campaigns a year, such as Tavan Tolgoi in Mongolia
         and Bab in Abu Dhabi; vegetation fire burns mostly by day, and night burning in one dry season,
         as in Nepal's forests, rarely reaches these shares).
  * burn years: years 2012-2025 with >= 1 remaining detection in the cell. Gap: >= 4 burn years, not
    masked, nearest mapped station > GAP_KM. Gaps are ordered in two groups, >= GAP_OFTEN_YEARS burn years
    (at least half the years) first, then 4 to 6; within each by remaining detections per year (as
    published in fire_per_year), then by distance, so a lone hot pixel seen in many years does not head
    the list.
  * Ranking: remaining mean yearly detections of unmasked cells credited to the nearest station.

--version 3 (stations/v3) is v2 (same fire, mask, gap rule and completeness thresholds) with a second station
source, Overture Maps Places (release OVERTURE_RELEASE), because OpenStreetMap maps no or few stations in many
countries:

  * Overture stations: every place whose taxonomy.primary is OVERTURE_CATEGORY ("fire_station"), read remotely from
    the release on S3 with DuckDB (only the matching rows and a few columns; cached as a 6 MB parquet), with
    confidence >= OVERTURE_MIN_CONF and operating_status not closed. "fire_protection_service" is left out: most of
    it is extinguisher, alarm and sprinkler firms (5-22% within 250 m of an OSM station, against 60-71% for
    fire_station).
  * Not every fire_station place is a station, and confidence does not sort them out (Foursquare, AllThePlaces
    and Microsoft places all score 0.77 or more). A name filter drops: names that are never a station
    (NOT_STATION: extinguisher, sprinkler and equipment firms, shops, union locals, schools, academies and training
    grounds, museums, ...); security firms, police, Red Cross posts, churches and the like unless the name also
    names a fire service (FIRE_WORDS, in many languages); places that only business directories list
    (OVERTURE_DIRECTORIES: Foursquare, Microsoft, BrightQuery, PinMeTo) unless the name names a fire service;
    places at whole-degree coordinates (geocoded to the middle of a region); and, among the Overture-only stations,
    a name repeated OVERTURE_REPEAT or more times without a fire word (a chain: tyre shops, convenience stores).
  * Same station: Overture places within SAME_M of each other, within SAME_NAME_M with similar names (the
    distinctive words of one name, generic fire words and abbreviations aside, all in the other, or one name inside
    the other, and no different station numbers), or within SAME_EXACT_M with the same name, are merged first,
    keeping the most confident; a merged place that close to an OSM site, by the same three tests, is that OSM
    station, which is kept and marked "both". The rest are added as Overture-only stations, assigned to countries
    exactly like the OSM ones.
  * Each station row gets a fifth element, its source: "osm", "both" or "overture"; "osm" is "" for an
    Overture-only station and a parallel "overture" list holds the Overture id ("" for OSM-only stations).
  * Completeness levels use the merged count, with the same thresholds; the income-group medians are recomputed.
  * Overture Places is under CDLA-Permissive-2.0, its Foursquare-sourced places under Apache-2.0: their licence
    texts and Foursquare's NOTICE are written next to the files (OVERTURE_LICENCE_FILES).

OpenStreetMap data (c) OpenStreetMap contributors, available under the Open Database License (ODbL)
1.0, https://www.openstreetmap.org/copyright. The output files are a derived database under the ODbL.

Usage:
    .venv/bin/python scripts/build_world_stations.py [--version 1|2|3] [--cache DIR]
        [--source qlever|overpass] [--ne DIR] [--out build/hf/stations/v<version>]

Needs numpy, scipy, shapely and duckdb (through scripts/build_world_shapes.py).
"""
from __future__ import annotations

import argparse
import functools
import importlib.util
import json
import math
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parent.parent
HF = ROOT / "build" / "hf"
USER_AGENT = "burn-calendar-build/1.0 (static site build script)"

QLEVER_URL = "https://qlever.dev/api/osm-planet"
QLEVER_QUERY = """PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm (geof:centroid(?wkt) AS ?c) ?name ?op WHERE {
  ?osm osmkey:amenity "fire_station" .
  ?osm geo:hasGeometry/geo:asWKT ?wkt .
  OPTIONAL { ?osm osmkey:name ?name }
  OPTIONAL { ?osm osmkey:operator ?op }
}"""
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
PAUSE_S = 10
QUERY_TIMEOUT_S = 900
LAT_BANDS = [(-90, 0), (0, 45), (45, 90)]
LON_BANDS = [(-180, -120), (-120, -60), (-60, 0), (0, 60), (60, 120), (120, 180)]

R_KM = 6371.0088
OFFSHORE_KM = 10.0
PERSIST_MONTHS, PERSIST_YEARS, PERSIST_SHARE = 8, 3, 0.5
PERSIST_ISOLATION = 0.4  # share of the 3 x 3 neighbourhood's detections: a point source, not a burning landscape
MERGE_M = 60  # objects closer than this are one site (a station node and its building, or several buildings)
Y_FROM, Y_TO = 2012, 2025
GAP_SHARE = 0.25
GAP_KM = 15.0
RANK_N = 25
K_NEAR = 3
PEER_MIN_POP = 1_000_000
FAIR, THIN = 0.3, 0.15  # ratio to the income-group median
FAIR_ABS, THIN_ABS = 8.0, 2.0  # stations per million people; real services almost everywhere exceed 2
MIN_STATIONS, MIN_STATIONS_POP = 5, 200_000
UNPOP = 5_000
MAX_STATIONS = 8_000  # above this, a file lists only the stations some fire cell or the ranking uses
COORD_DECIMALS = 4  # about 11 m
# v2 static-source mask (see the module docstring)
STATIC_SPOT_YEARS = 2  # a 0.01 degree spot FIRMS typed 1-3 in this many years is a static site
RECUR_YEARS, RECUR_MONTHS = 6, 10  # an untyped 0.01 degree spot burning this regularly is a static site too
RECUR_NIGHT = 0.5  # if most of its detections are at night (daytime ones: sugar estates, shifting farms)
RECUR_POOL_WEAK = 0.5  # the same test on a spot's 3 x 3 neighbourhood also needs this share of weak night detections
RECUR_NIGHT_ONLY, RECUR_NIGHT_MONTHS = 0.85, 6  # or, pooled, this share at night (and weak) in this many months
STATIC_SHARE = 0.2  # share of a cell's detections from static sources that makes it suspect
MASK_STATIC_YEARS = 3  # years with FIRMS type 1-3 detections in or next to a cell: a flare field
SPARSE_PER_YEAR = 5  # remaining detections per year below this, next to a flare field: flare spill-over
FLARE_WEAK_NIGHT = 0.25  # or not seasonal with this share of weak night detections: the flare field itself
MASK_MIN_N = 20  # fewer remaining detections than this: too few to call the cell seasonal
SEASONAL_TOP6 = 0.75  # share of detections in the busiest 6 calendar months: vegetation fire (one or two
                      # burning seasons) is above; flares, spread over the year, are near 0.5-0.7
BIG_PER_YEAR = 50  # a seasonal cell with this many remaining detections a year is real fire, even next to flares
WEAK_FRP_MW = 2.0  # night detections under this FRP: a flare's signature (vegetation fire at night: about 3 MW)
NIGHT_WEAK_SHARE = 0.5  # share of remaining detections that are weak night ones: a flare field
NIGHT_SHARE = 0.75  # or this share at night, any FRP (Ghawar, Saudi Arabia; Chiquitania fires: 0.72)
NIGHT_SHARE_LOW, NIGHT_LOW_MAX_TOP6 = 0.7, 0.8  # or this share at night with a weak season (Haradh)
NIGHT_MIN_YEARS, NIGHT_MIN_MONTHS = 6, 10  # and burning in 6+ years (new flares: Algeria, Oman, Syria), nearly every month
NIGHT_MAX_TOP6 = 0.9  # and not in one short season (dry-forest surface fires in India smoulder at night)
NIGHT_ONLY_SHARE, NIGHT_ONLY_WEAK = 0.85, 0.5  # nearly all at night and half weak: a flare, kiln or mine, in any
NIGHT_ONLY_YEARS = 4                           # month pattern, in this many burn years: every gap (Tavan Tolgoi, Bab)
NIGHT_SPREAD_SHARE, NIGHT_SPREAD_MONTHS = 0.8, 7  # or this share at night, half weak, over this many months
FLARE_LONG_YEARS = 10  # FIRMS typed static detections next to the cell in this many years: a season is no exemption,
FLARE_LONG_RATIO = 1.0  # if the typed detections there outnumber the remaining ones (not a mill beside its cane fields)
FLARE_WIDE_RING, FLARE_WIDE_RATIO = 4, 50.0  # or within 4 squares (about 20 km) and 50 times as many, with
FLARE_WIDE_TOP6 = 0.9                        # no short season (Saharan oil fields; Kirkuk's crop burning has one),
FLARE_WIDE_MAX_CELL = 0.25                   # in cells up to 0.25 degrees (a 0.5-1 degree cell is wider than the ring)
GAP_OFTEN_YEARS = 7  # v2 gaps: cells burned in at least half the years first, then the rest; by fire a year in each
MASK_WHY = {1: "static", 2: "flare_field", 3: "night_all_season", 4: "night_weak"}
# v3: Overture Maps Places fire stations added to OpenStreetMap's (see the module docstring)
OVERTURE_RELEASE = "2026-10-21.0"
OVERTURE_PLACES = f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=places/type=place/*"
OVERTURE_CATEGORY = "fire_station"  # taxonomy.primary; fire_protection_service is extinguisher and alarm firms
OVERTURE_MIN_CONF = 0.5  # Overture's existence confidence; below it most fire_station places are not stations
OVERTURE_DROP_STATUS = ("permanently_closed", "temporarily_closed")
SAME_M, SAME_NAME_M = 250, 1000  # this close to an OSM station (or with a similar name, this close): the same station
SAME_EXACT_M = 2000  # ... or with the very same name (with a distinctive word), this close
OVERTURE_DIRECTORIES = {"Foursquare", "Microsoft", "BrightQuery", "PinMeTo"}  # business directories among the sources
OVERTURE_REPEAT = 5  # a name this frequent among Overture-only stations, with no fire word, is a chain (shops, offices)
ATTRIBUTION ="© OpenStreetMap contributors, ODbL"
LICENCE = ("Fire station locations, names and operators are from OpenStreetMap, © OpenStreetMap contributors, "
           "available under the Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright. "
           "This file is a derived database and is shared under the ODbL 1.0; if you publicly use or adapt it you "
           "must credit OpenStreetMap contributors and keep the result open under the ODbL. Fire grid cells are "
           "derived from NASA FIRMS (see the dataset card).")
SOURCE_CODES = {"osm": "OpenStreetMap only", "both": "OpenStreetMap, also listed in Overture (OSM record kept)",
                "overture": "Overture Maps Places only"}
ATTRIBUTION_V3 = ("© OpenStreetMap contributors, ODbL; Overture Maps Foundation, overturemaps.org, "
                  "CDLA Permissive 2.0 (includes data from Meta, Microsoft, Foursquare (Apache 2.0) and others)")
OVERTURE_LICENCE_FILES = {  # shipped next to the data: CDLA-Permissive-2.0 s. 2.1 and Apache-2.0 s. 4 ask for them
    "LICENSE-CDLA-Permissive-2.0.txt": "https://raw.githubusercontent.com/spdx/license-list-data/main/text/"
                                       "CDLA-Permissive-2.0.txt",
    "LICENSE-Apache-2.0.txt": "https://www.apache.org/licenses/LICENSE-2.0.txt",
    "NOTICE-Foursquare.txt": "https://opensource.foursquare.com/places-notice-txt/",
}
LICENCE_V3 = (
    "Fire station locations, names and operators are from OpenStreetMap, © OpenStreetMap contributors, available "
    "under the Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright; and from Overture Maps "
    f"Places (release {OVERTURE_RELEASE}), Overture Maps Foundation, overturemaps.org, available under the "
    "Community Data License Agreement Permissive 2.0 (https://cdla.dev/permissive-2-0/; text in "
    "LICENSE-CDLA-Permissive-2.0.txt beside this file). Overture places sourced from Foursquare are Copyright "
    "Foursquare Labs, Inc., available under the Apache License 2.0 (LICENSE-Apache-2.0.txt, NOTICE-Foursquare.txt), "
    "transformed to the Overture schema by Overture and reduced to a point, a name and an id here. This file is a "
    "derived database and is shared under the ODbL 1.0; if you publicly use or adapt it you must credit "
    "OpenStreetMap contributors and the Overture Maps Foundation and keep the result open under the ODbL. Fire grid "
    "cells are derived from NASA FIRMS (see the dataset card).")
GAP_NOTE_V3 = {
    "fair": "OpenStreetMap and Overture together map about as many stations here as in peer countries, but neither "
            "is complete: a gap means no station is mapped within %g km, not that none exists." % GAP_KM,
    "patchy": "Fire stations look patchy in OpenStreetMap and Overture here (fewer than peer countries per person): "
              "many gaps may be unmapped stations. Show them as 'no mapped station within %g km'." % GAP_KM,
    "thin": "Fire stations look thin in OpenStreetMap and Overture here: distances and gaps mostly reflect the "
            "maps, not real fire cover. Do not present gaps as places without a station.",
    "unpopulated": "Few or no people live here; station distances are shown for completeness only.",
    "no_data": "No population figure to judge how completely stations are mapped; treat gaps as unverified.",
}


# ---------------------------------------------------------------- download
def http(url, data=None, timeout=600, accept=None):
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def fetch_qlever(cache: Path):
    f = cache / "qlever_fire_stations.tsv"
    meta = cache / "qlever_stats.json"
    if not f.exists():
        body = urllib.parse.urlencode({"query": QLEVER_QUERY}).encode()
        txt = http(QLEVER_URL, body, accept="text/tab-separated-values")
        if not txt.startswith("?osm"):
            raise SystemExit("unexpected QLever answer: " + txt[:300])
        f.write_text(txt, "utf-8")
        meta.write_text(http(QLEVER_URL + "?cmd=stats", timeout=60), "utf-8")
    snapshot = ""
    if meta.exists():
        name = json.loads(meta.read_text("utf-8")).get("name-index", "")
        m = re.search(r"planet-(\d{2})(\d{2})(\d{2})\.osm\.pbf", name)
        snapshot = f"20{m[1]}-{m[2]}-{m[3]}" if m else name
    out = []
    unq = lambda s: s[1:-1].replace('\\"', '"').replace("\\\\", "\\") if s.startswith('"') else s
    for ln in f.read_text("utf-8").split("\n")[1:]:
        if not ln:
            continue
        p = ln.split("\t")
        m = re.match(r"<https://www\.openstreetmap\.org/(node|way|relation)/(\d+)>", p[0])
        c = re.match(r"POINT\(([-\d.eE]+) ([-\d.eE]+)\)", p[1] if len(p) > 1 else "")
        if not m or not c:
            continue
        out.append((m[1][0], int(m[2]), float(c[2]), float(c[1]),
                    unq(p[2]) if len(p) > 2 else "", unq(p[3]) if len(p) > 3 else ""))
    return out, f"QLever OSM planet (osm2rdf), planet file of {snapshot}", snapshot


def tiles():
    out = []
    for s, n in LAT_BANDS:
        for w, e in LON_BANDS:
            if (s, n) == (45, 90) and (w, e) == (0, 60):  # central and northern Europe: very dense
                out += [(s, w2, n, w2 + 15) for w2 in range(0, 60, 15)]
            elif (s, n) == (0, 45) and (w, e) == (-120, -60):  # contiguous US
                out += [(s, w2, n, w2 + 20) for w2 in range(-120, -60, 20)]
            else:
                out.append((s, w, n, e))
    return out


def fetch_overpass_tile(bbox, cache: Path):
    f = cache / ("tile_%d_%d_%d_%d.tsv" % bbox)
    if f.exists() and f.stat().st_size > 0:
        return f
    s, w, n, e = bbox
    q = (f'[out:csv(::type,::id,::lat,::lon,name,operator;true;"\\t")][timeout:{QUERY_TIMEOUT_S}]'
         f'[maxsize:1073741824];nwr["amenity"="fire_station"]({s},{w},{n},{e});out center;')
    body = urllib.parse.urlencode({"data": q}).encode()
    wait = 30
    for attempt in range(12):
        url = OVERPASS[attempt % len(OVERPASS)]
        t0 = time.time()
        try:
            txt = http(url, body, timeout=QUERY_TIMEOUT_S + 60)
            if not txt.startswith("@type"):
                raise ValueError("unexpected response: " + txt[:200])
            f.write_text(txt, "utf-8")
            print(f"tile {bbox}: {txt.count(chr(10)) - 1} rows from {url} in {time.time() - t0:.0f}s", flush=True)
            time.sleep(PAUSE_S)
            return f
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as ex:
            print(f"tile {bbox}: {url} failed after {time.time() - t0:.0f}s ({str(ex)[:100]}); wait {wait}s", flush=True)
            time.sleep(wait)
            wait = min(wait * 2, 300)
    raise SystemExit(f"tile {bbox}: all attempts failed")


def fetch_overpass(cache: Path):
    out = []
    for b in tiles():
        for ln in fetch_overpass_tile(b, cache).read_text("utf-8").split("\n")[1:]:
            p = ln.split("\t")
            if len(p) < 4 or not p[2] or not p[3]:
                continue
            p += [""] * (6 - len(p))
            out.append((p[0][0], int(p[1]), float(p[2]), float(p[3]), p[4], p[5]))
    return out, "Overpass API", time.strftime("%Y-%m-%d")


def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        if (r[0], r[1]) in seen:
            continue
        seen.add((r[0], r[1]))
        out.append((r[0], r[1], r[2], r[3], " ".join(r[4].split()), " ".join(r[5].split())))
    return out


def merge_sites(rows):
    """One station per site: objects within MERGE_M of each other (single linkage) are merged. Kept: the
    one with a name, then a node before a way before a relation, then the lowest id."""
    lon = np.array([r[3] for r in rows])
    lat = np.array([r[2] for r in rows])
    pairs = cKDTree(unit(lon, lat)).query_pairs(MERGE_M / 1000 / R_KM, output_type="ndarray")
    parent = np.arange(len(rows))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in pairs:
        a, b = find(i), find(j)
        if a != b:
            parent[max(a, b)] = min(a, b)
    groups = defaultdict(list)
    for i in range(len(rows)):
        groups[find(i)].append(i)
    rank = {"n": 0, "w": 1, "r": 2}
    out = [rows[min(g, key=lambda i: (not rows[i][4], rank[rows[i][0]], rows[i][1]))] for g in groups.values()]
    return out, len(rows) - len(out)


# ---------------------------------------------------------------- v3: Overture Maps Places
def fetch_overture(cache: Path):
    """Every Overture place whose primary category is OVERTURE_CATEGORY, any confidence, read remotely from the
    release's GeoParquet on S3 (anonymous, us-west-2): only these rows and columns are fetched, about 87,000 rows
    and 10 MB. Returns rows (id, lat, lon, name, confidence, operating_status, [source datasets])."""
    import duckdb
    f = cache / f"overture_{OVERTURE_CATEGORY}_{OVERTURE_RELEASE}.parquet"
    con = duckdb.connect()
    if not f.exists():
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region = 'us-west-2'")
        con.execute(f"""COPY (SELECT id, names.primary AS name, confidence, operating_status AS status,
                (bbox.xmin + bbox.xmax) / 2 AS lon, (bbox.ymin + bbox.ymax) / 2 AS lat,
                addresses[1].country AS cc, list_transform(sources, lambda s: s.dataset) AS datasets,
                list_transform(sources, lambda s: s.license) AS licenses
            FROM read_parquet('{OVERTURE_PLACES}', hive_partitioning = 1)
            WHERE taxonomy.primary = '{OVERTURE_CATEGORY}' ORDER BY id) TO '{f}' (FORMAT parquet)""")
    r = con.execute(f"SELECT id, lat, lon, coalesce(name, ''), confidence, coalesce(status, ''), datasets "
                    f"FROM '{f}' ORDER BY id").fetchall()
    return [(i, float(la), float(lo), " ".join(nm.split()), float(c), s, list(ds or [])) for i, la, lo, nm, c, s, ds in r]


def page_text(body):
    """A licence text: plain text as is; an HTML page (Foursquare's NOTICE) reduced to the text of its <main>."""
    if "<html" not in body[:2000].lower():
        return body
    import html
    m = re.search(r"<main.*?</main>", body, flags=re.S)
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", m.group(0) if m else body, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>|</p>|</h\d>|</li>", "\n", t)))
    return "\n\n".join(" ".join(p.split()) for p in re.split(r"\n\s*\n", t) if p.strip()) + "\n"


def fold(s):
    """A name casefolded, then again without accents: Latin patterns are written without accents, and other scripts
    (where dropping combining marks would damage the word) match the first form."""
    s = " ".join((s or "").split()).casefold()
    return s + " | " + "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))


# a name that says fire service, in the languages Overture's fire_station places use
FIRE_WORDS = re.compile("|".join([
    # English and its abbreviations (VFD, FD, FPD, CFS, RFS, CFA, BFP, ...)
    r"\bfire(?!stone|place|works|arm|wood|ball|fly|side)", r"\bv?fd\b", r"\bfdny\b", r"\bfpd\b", r"\bv?f\.?d\.",
    r"\bvfc\b", r"\bv?frs?\b", r"\bcfs\b", r"\brfs\b", r"\bcfa\b", r"\bqfes\b", r"\bdfes\b", r"\bfenz\b", r"\brfb\b",
    r"\bvfb\b", r"\bbfp\b", r"\bhose\b", r"\bladder\b", r"\bengine (co|company|house)\b",
    r"\b(engine|truck|squad|battalion|medic|tower|station|estacion|wache|kazerne|caserne) ?(no\.? ?)?#? ?\d",
    r"\brescue\b", r"\bcivil (defen[cs]e|protection)\b",
    # German, Dutch, Nordic, Baltic
    r"feuerwehr", r"feuerwache", r"\bffw?\b", r"\bbfw?\b", r"geratehaus", r"\blosch", r"brandweer", r"brandwacht",
    r"brann", r"brandst", r"brandk[ao]", r"brandv", r"raddningstj", r"raddningsvarn", r"beredskab", r"paloasema",
    r"palokunta", r"\bvpk\b", r"redning", r"\bfbk\b", r"pelastus", r"priesgaisr", r"ugniagesi", r"ugunsdzes",
    r"paastekomando", r"paasteamet", r"tuletorje", r"slokkvi",
    # Romance languages
    r"pompier", r"sapeurs?\b", r"\bsdis\b", r"\bcis\b", r"centre de secours", r"incendi", r"\bcaserne", r"bomber",
    r"bombeir", r"\bcbv?m?\b", r"defensa civil", r"defesa civil", r"proteccion civil", r"protezione civile",
    r"protection civile", r"securite civile", r"civil security", r"\bdgsc\b", r"vigili del fuoco", r"\bvv\.?ff?\b",
    r"distaccamento", r"\bisu\b", r"situatii de urgenta", r"\bsvsu\b", r"extincion", r"extincio", r"\bsei\b",
    r"\bspeis\b",
    # Central and Eastern Europe, Turkey, the Caucasus, Central Asia
    r"straz", r"\bosp\b", r"\bpsp\b", r"\bjrg\b", r"pozarn", r"poziarn", r"hasic", r"\bsdh\b", r"\bhzs\b", r"\bdhz\b",
    r"tuzolto", r"\bote\b", r"katasztrofavedelem", r"vatrogas", r"\bdvd\b", r"\bjvp\b", r"gasil", r"\bpgd\b",
    r"zjarrfik", r"itfaiye", r"yangin", r"suhiltzaile", r"doitea", r"gorsaf [dt]an", r"пожар", r"пожеж", r"пажар",
    r"ватрогас", r"\bмчс\b", r"\bдснс\b", r"\bпч\b", r"\bпсч\b", r"\bдпрч\b", r"\bдпрп\b", r"рятувальн", r"спасат",
    r"пбзн", r"өрт", r"гал унтраах", r"სახანძრო", r"მაშველ", r"հրշեջ", r"փրկարար",
    # Greek, the Middle East, South Asia
    r"πυροσβεστ", r"دفاع مدني", r"الدفاع المدني", r"الدفاع المدنى", r"إطفاء", r"اطفاء", r"مطافئ", r"مطافي",
    r"الحماية المدنية", r"الوقاية المدنية", r"حماية مدنية", r"تش[\s\u200c]*نشان", r"כבאות", r"כיבוי", r"מכבי אש",
    r"فائر", r"ریسکیو", r"अग्नि", r"दमकल", r"फायर", r"অগ্নি", r"দমকল", r"ফায়ার", r"தீயணை", r"అగ్ని", r"ఫైర్", r"ಅಗ್ನಿ",
    r"ಫೈರ್", r"അഗ്നി", r"ഫയർ", r"ફાયર", r"અગ્નિ", r"ਫਾਇਰ", r"ଅଗ୍ନି", r"ගිනි",
    # East and Southeast Asia, Africa
    r"消防", r"分団", r"소방", r"119", r"안전센터", r"ดับเพลิง", r"สาธารณภัย", r"ດັບເພີງ", r"ກູ້ໄພ", r"ពន្លត់",
    r"អគ្គិភ័យ", r"မီးသတ်", r"chua chay", r"\bpccc\b", r"cuu nan", r"cuu ho", r"pemadam", r"damkar", r"kebakaran",
    r"\bbomba\b", r"\bpbk\b", r"bumbero", r"zimamoto", r"እሳት",
]))
# never a fire station, whatever else the name says: extinguisher, sprinkler and equipment firms, shops, union
# locals, research and quarantine offices, companies
NOT_STATION = re.compile("|".join([
    r"\bequip", r"\bextin(?!c)", r"extincteur", r"extinguish", r"estintor", r"feuerloscher", r"sprinkler",
    r"\bsuppl(y|ies)\b(?! v?fd| fire)", r"suministro", r"fornitur", r"fourniture", r"ingrosso", r"wholesale",
    r"\bsales\b", r"\bventas?\b", r"\bvendas?\b", r"materia(l|is|le|les)\b", r"\bmateriel", r"\blocal (no\.? ?)?#? ?\d",
    r"\biaff\b", r"firefighters? union", r"polytechni", r"poly techni", r"instituto?\b", r"quarantin", r"karantin",
    r"\bafad\b", r"research", r"supermar", r"minimar", r"minimerc", r"магазин", r"\btires?\b", r"\btyres?\b",
    r"llanta", r"\bpneu", r"\breifen", r"boutique", r"\bcafeteria", r"kaffee", r"restaurant", r"\bpizz", r"\bgrill\b",
    r"\bsubs\b", r"\bbbq\b", r"\bbrew(ery|ing|pub)", r"saloon", r"\bpub\b", r"telecom", r"leasing", r"insurance",
    r"seguros\b", r"assurance", r"versicherung", r"\bshop\b", r"tienda", r"\bloja\b", r"\bltda?\b", r"\bllc\b",
    r"\bgmbh\b", r"\bs\.? ?r\.? ?l\b", r"\bpvt\b", r"sdn\.? bhd", r"\bs\.? ?a\.? de c\.? ?v\b", r"\bco\.?,? ltd",
    r"\bplc\b", r"\bkft\b", r"engineering", r"consult", r"solution", r"\bsystems?\b", r"sistema", r"sistemi",
    r"technolog", r"tecnolog", r"impiant", r"installat", r"\bhotel", r"\bmotel", r"hostel", r"apartment", r"\blofts?\b",
    r"pharmac", r"farmacia", r"\bsalon", r"\bfitness", r"crossfit", r"\bgym\b", r"fotocop", r"photocop", r"\bprinting",
    r"post office", r"desentup", r"plumb", r"car wash", r"auto (repair|parts|care)", r"\brental", r"real estate",
    r"realty", r"inmobiliar", r"hagyomanyorzo", r"make ?up\b", r"cosmetic", r"beauty", r"private limited",
    r"\blimited\b", r"有限公司", r"工程", r"hidraulic", r"terceiriz", r"vistoria", r"\blaudo", r"fire ?(&|and) ?security",
    r"\btrading\b", r"festival", r"negozio", r"مقهى", r"كافيه", r"مطعم", r"ศักดิ์สยาม", r"saksiam",
]))
# schools, academies, training grounds and museums, unless the name also numbers a station ("Station 6 & Training
# Center")
NOT_STATION_UNLESS_NUMBERED = re.compile("|".join([
    r"academ", r"akadem", r"training", r"treinamento", r"entrenamiento", r"formacion\b", r"capacitacion",
    r"ausbildung", r"\bschools?\b", r"schule", r"escuela", r"escola", r"\becole", r"museum", r"\bmuseo", r"\bmusee",
    r"muzeum", r"музей", r"\bcolegio", r"تدريب", r"مركز اعداد",
]))
NUMBERED = re.compile(r"\b(station|estacion|estacao|wache|kazerne|caserne|compan(y|ia)|cia) ?(no\.? ?)?#? ?\d")
# firms ("Triangle Fire Inc", "Phoenix Fire Apparatus"), unless the name says department, station, district, ...
NOT_STATION_UNLESS_SERVICE = re.compile(
    r"\binc\b|\bcorp(oration)?\b|logistic|\btools?\b|apparatus|\baware\b|\bstop\b")
SERVICE = re.compile(
    r"depart|\bdept|station|district|\bdist\b|compan|\bco\b|\bv?fd\b|brigade|rescue|squad|\bhall\b|house|authority|"
    r"bureau|feuerwehr|bomber|bombeir|pompier|vigili|civil|\bv?fc\b|\bass(oc|n)|battalion|emergency|township|\btwp\b|"
    r"county|rural|\bcity\b|\btown\b|village|borough")
# security firms, police, hospitals, Red Cross posts, churches, shops in a place name ..., unless the name also says
# fire service ("Market Drayton Fire Station", "Coffee City Fire Department")
NOT_STATION_UNLESS_FIRE = re.compile("|".join([
    r"securit", r"seguridad", r"sicurezza", r"seguranca", r"sicherheit",
    r"(?<!public )safety(?! cent| build| complex| bldg| facilit)", r"\bpower\b", r"\bpolic", r"policia", r"polizia",
    r"polizei", r"hospital", r"clinic", r"ambulanc", r"red cross", r"cruz roja", r"croix.rouge", r"cruz vermelha",
    r"croce rossa", r"rotes kreuz", r"crveni kri", r"красн\w* крест", r"الهلال الأحمر", r"\bafet\b", r"church",
    r"iglesia", r"igreja", r"chiesa", r"\bkirche", r"mosque", r"masjid", r"temple", r"\bwind\b", r"\bsolar\b",
    r"electric", r"\bradio\b", r"pack shack", r"market", r"маркет", r"mercado", r"college", r"universit", r"\bbank\b",
    r"coffee", r"burger", r"\balarm", r"\banimal", r"polgaror", r"\bcafe\b", r"tavern", r"\bstore\b", r"\bstudio",
    r"florist", r"\bpets?\b", r"\bvet(erinar|s)?\b",
]))
# in business directories, mostly sprinkler and extinguisher contractors ("Superior Fire Protection")
DIRECTORY_FIRM = re.compile(r"fire protection(?=\s*(\||$))|fire safety|\bsafety\b")


def fire_word(name):
    return bool(FIRE_WORDS.search(fold(name)))


def not_station(name, directory_only=False):
    """True when an Overture fire_station place's name says it is not a fire station. directory_only: the place
    comes only from business directories, so its name must say fire service."""
    f = fold(name)
    if directory_only and (not FIRE_WORDS.search(f) or (DIRECTORY_FIRM.search(f) and not SERVICE.search(f))):
        return True
    return bool(NOT_STATION.search(f) or (NOT_STATION_UNLESS_NUMBERED.search(f) and not NUMBERED.search(f))
                or (NOT_STATION_UNLESS_SERVICE.search(f) and not SERVICE.search(f))
                or (NOT_STATION_UNLESS_FIRE.search(f) and not FIRE_WORDS.search(f)))


def overture_drop(r, min_conf=OVERTURE_MIN_CONF):
    """Why an Overture place (a fetch_overture row) is not taken as a fire station; '' if it is."""
    _, lat, lon, name, conf, status, datasets = r
    if conf < min_conf:
        return "low_confidence"
    if status in OVERTURE_DROP_STATUS:
        return "closed"
    if lat == round(lat) and lon == round(lon):
        return "whole_degree"  # geocoded to the middle of a region ("Glencoe CFS" at -30, 135)
    src = set(datasets) - {"Overture", "Overture-signals"}
    if not_station(name, bool(src) and src <= OVERTURE_DIRECTORIES):
        return "name"
    return ""


def name_key(s):
    """Names compared for 'the same station': accents, case, punctuation and spacing ignored (any script)."""
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch)).casefold()
    return " ".join(re.sub(r"[\W_]+", " ", s).split())


# words that do not tell two stations apart, and abbreviations expanded before comparing
GENERIC_WORDS = set("""
fire fires station stations department volunteer volunteers company rescue service services district protection
emergency brigade brigades hall house engine ladder truck no number of the and at for on in de del la le les des du di
da do dos das el los las en et y e i a und der die das im am an zu city town township county village municipal
municipality regional region area central main sub substation headquarters office satellite unit post feuerwehr
freiwillige ff ffw feuerwache geratehaus feuerwehrgeratehaus feuerwehrhaus loschzug loschgruppe wache bf bomberos
bombeiros bombeiro bombero cuerpo corpo voluntarios voluntaria estacion estacao compania companhia cia pompiers sapeurs
pompier caserne centre secours incendie sdis cis vigili fuoco distaccamento comando straz pozarna osp ochotnicza
panstwowa psp jrg itfaiye itfaiyesi mudurlugu tuzolto tuzoltosag onkentes egyesulet egyesulete ote cfs rfs vfb rfb cfa
vfc vfr frs amt brandweer kazerne pompieri stazione volontari civil defense defence civile proteccion proteccao
protezione defensa defesa firehouse firestation firefighters ems rural metro metropolitan national state provincial
general base sector zone zona sous cuartel division divisao ortsfeuerwehr berufsfeuerwehr stadt gemeinde abteilung abt
firemen firemens fireman community ambulance corps marshal marshals prevention bureau police public safety admin
administration administrative""".split())
NAME_ABBREV = {"dept": "department", "twp": "township", "fd": "fire department", "vfd": "volunteer fire department",
               "co": "company", "vol": "volunteer", "sta": "station", "stn": "station", "mt": "mount", "ft": "fort",
               "st": "saint", "ste": "sainte", "hq": "headquarters", "cs": "centre secours"}
NAME_ORDINAL = {w: i % 12 + 1 for i, w in enumerate(
    "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth "
    "primera segunda tercera cuarta quinta sexta septima octava novena decima undecima duodecima "
    "primer segundo tercero cuarto quinto sexto septimo octavo noveno decimo undecimo duodecimo".split())}


def name_words(s):
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(ch)).casefold()
    return [w for t in re.split(r"[\W_]+", s) for w in NAME_ABBREV.get(t, t).split()]


def name_tokens(s):
    """(distinctive words, station numbers) of a station name."""
    dist, nums = set(), set()
    for t in name_words(s):
        digits = re.findall(r"\d+", t)
        if digits:
            nums.update(int(x) for x in digits)
            rest = re.sub(r"\d+", "", t)
            if len(rest) > 3 and rest not in GENERIC_WORDS:  # a name written without spaces keeps its text
                dist.add(rest)
        elif t in NAME_ORDINAL:
            nums.add(NAME_ORDINAL[t])
        elif len(t) > 1 and t not in GENERIC_WORDS:
            dist.add(t)
    return dist, nums


@functools.lru_cache(maxsize=None)
def name_signature(s):
    return name_tokens(s) + (" " + " ".join(name_words(s)) + " ",)


def similar_names(a, b, strict_numbers=False):
    """Probably one station: the distinctive words (generic fire words aside) of one name are all in the other
    ("Feuerwehr Rohrbach", "Feuerwehrgeratehaus Rohrbach"; not "Ternitz-Doppling", "Ternitz-Rohrbach"), or one name
    is contained in the other ("Fire Station" in "Central Police and Fire Station"), and they carry no different
    station numbers. strict_numbers: a number on one side only also counts as different."""
    if not a or not b:
        return False
    (da, na, wa), (db, nb, wb) = name_signature(a), name_signature(b)
    if (na or nb) and not (na & nb) and (strict_numbers or (na and nb)):
        return False
    return bool(da and db and (da <= db or db <= da)) or (len(wa) > 2 and len(wb) > 2 and (wa in wb or wb in wa))


def union_find(n, pairs):
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in pairs:
        a, b = find(i), find(j)
        if a != b:
            parent[max(a, b)] = min(a, b)
    return np.array([find(i) for i in range(n)])


def same_pairs(lon_a, lat_a, names_a, lon_b=None, lat_b=None, names_b=None, near_m=SAME_M, name_m=SAME_NAME_M,
               exact_m=SAME_EXACT_M):
    """Pairs (i in a, j in b) that are one station: within near_m, within name_m with similar names, or within
    exact_m with the same name (one with a distinctive word). Without b: pairs within a (i < j), where a station
    number on one name only keeps two places apart (so that "X Fire Department" does not chain "X Fire Station 4"
    and "X Fire Station 7" into one)."""
    ta = cKDTree(unit(lon_a, lat_a))
    tb = ta if lon_b is None else cKDTree(unit(lon_b, lat_b))
    nb = names_a if lon_b is None else names_b

    def within(m):
        if lon_b is None:
            return ta.query_pairs(m / 1000 / R_KM, output_type="ndarray")
        return np.array([(i, j) for i, js in enumerate(ta.query_ball_tree(tb, m / 1000 / R_KM)) for j in js],
                        int).reshape(-1, 2)
    near, far, farther = within(near_m), within(name_m), within(exact_m)
    strict = lon_b is None
    far = far[[similar_names(names_a[i], nb[j], strict) for i, j in far]] if len(far) else far
    farther = farther[[bool(name_tokens(names_a[i])[0]) and name_key(names_a[i]) == name_key(nb[j])
                       for i, j in farther]] if len(farther) else farther
    return np.unique(np.concatenate([near, far, farther]).reshape(-1, 2), axis=0)


def add_overture(osm, ov, min_conf=OVERTURE_MIN_CONF, near_m=SAME_M):
    """osm: merged OSM sites (type, id, lat, lon, name, operator). ov: fetch_overture rows. Overture places kept
    (confidence >= min_conf, not closed, a name that may be a fire station: overture_drop) are first merged among
    themselves (Overture often lists one station twice, from two sources), keeping the most confident; a group with
    any place within near_m of an OSM site, within SAME_NAME_M with a similar name, or within SAME_EXACT_M with the
    same name, is that station: the OSM record is kept and marked 'both'. Of the rest, names repeated OVERTURE_REPEAT
    or more times with no fire word are dropped (chains). Returns rows (type, id, lat, lon, name, operator, source,
    overture id), with type 'o' and id = Overture id for the Overture-only stations, and counts."""
    why = Counter(overture_drop(r, min_conf) for r in ov)
    keep = [r for r in ov if not overture_drop(r, min_conf)]
    stats = {"overture_places": len(ov), "kept": len(keep),
             "dropped": {k: why[k] for k in ("low_confidence", "closed", "whole_degree", "name")}}
    keep.sort(key=lambda r: (-r[4], r[0]))  # the first of a group is the most confident
    olon, olat = np.array([r[2] for r in keep]), np.array([r[1] for r in keep])
    oname = [r[3] for r in keep]
    root = union_find(len(keep), same_pairs(olon, olat, oname, near_m=near_m))
    groups = defaultdict(list)
    for i, g in enumerate(root):
        groups[g].append(i)
    stats["overture_sites"] = len(groups)
    slon, slat = np.array([s[3] for s in osm]), np.array([s[2] for s in osm])
    hit = same_pairs(olon, olat, oname, slon, slat, [s[4] for s in osm], near_m=near_m)
    match = {}  # Overture place -> nearest matched OSM site
    if len(hit):
        dkm = haversine_km(olon[hit[:, 0]], olat[hit[:, 0]], slon[hit[:, 1]], slat[hit[:, 1]])
        for (i, j), d in sorted(zip(map(tuple, hit), dkm), key=lambda t: t[1], reverse=True):
            match[i] = j
    both = {}  # OSM site -> Overture id of its most confident match
    out_ov = []
    for g, members in groups.items():
        hits = [match[i] for i in members if i in match]
        if hits:
            for i in members:
                if i in match:
                    both.setdefault(match[i], keep[i][0])
            continue
        r = keep[members[0]]
        out_ov.append(("o", r[0], r[1], r[2], r[3], "", "overture", r[0]))
    stats["matched_sites"] = len(groups) - len(out_ov)
    rep = Counter(name_key(r[4]) for r in out_ov if not fire_word(r[4]))
    chain = {k for k, n in rep.items() if k and n >= OVERTURE_REPEAT}
    stats["dropped_repeated_names"] = {k: rep[k] for k in sorted(chain)}
    out_ov = [r for r in out_ov if name_key(r[4]) not in chain or fire_word(r[4])]
    out = [s + (("both", both[i]) if i in both else ("osm", "")) for i, s in enumerate(osm)]
    stats["osm_also_in_overture"] = len(both)
    stats["overture_only"] = len(out_ov)
    return out + out_ov, stats


# ---------------------------------------------------------------- geometry
def load_world():
    t = (ROOT / "world.js").read_text("utf-8")
    return json.loads(t[t.index("{"): t.rindex("}") + 1])["countries"]


def ring_area_km2(xs, ys):
    """Area of a lon/lat ring on the sphere (exact for great-circle-free trapezoids; fine at 0.05 degrees)."""
    lam, phi = np.radians(xs), np.radians(ys)
    a = np.sum((np.roll(lam, -1) - lam) * (2 + np.sin(phi) + np.sin(np.roll(phi, -1))))
    return abs(a) * R_KM ** 2 / 2


def unit(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def haversine_km(lon1, lat1, lon2, lat2):
    lo1, la1, lo2, la2 = map(np.radians, (lon1, lat1, lon2, lat2))
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_KM * np.arcsin(np.sqrt(np.minimum(h, 1)))


def assign_countries(world, lon, lat):
    """FIRMS key per station ('' if dropped), and per-country land area in km2."""
    polys, owner, areas = [], [], []
    for ci, c in enumerate(world):
        for r in c["r"]:
            xs, ys = np.array(r[0::2]), np.array(r[1::2])
            if len(xs) < 4:
                continue
            p = shapely.make_valid(Polygon(np.column_stack([xs, ys])))
            polys.append(p)
            owner.append(ci)
            areas.append(ring_area_km2(xs, ys))
    owner, areas = np.array(owner), np.array(areas)
    tree = shapely.STRtree(polys)
    # land area: own polygons minus other countries' polygons lying inside them (enclaves)
    land = np.zeros(len(world))
    np.add.at(land, owner, areas)
    pi, pj = tree.query(polys, predicate="contains_properly")
    for i, j in zip(pi, pj):
        if owner[i] != owner[j]:
            land[owner[i]] -= areas[j]
    pts = shapely.points(lon, lat)
    key = np.full(len(lon), -1)
    best = np.full(len(lon), np.inf)
    si, gi = tree.query(pts, predicate="within")
    for s, g in zip(si, gi):
        if areas[g] < best[s]:
            best[s], key[s] = areas[g], owner[g]
    miss = np.nonzero(key < 0)[0]
    off = np.full(len(lon), np.nan)
    if miss.size:
        si, gi = tree.query_nearest(pts[miss], max_distance=0.25, all_matches=False)
        for s, g in zip(si, gi):
            line = shapely.shortest_line(pts[miss[s]], polys[g])
            (x0, y0), (x1, y1) = shapely.get_coordinates(line)
            km = float(haversine_km(x0, y0, x1, y1))
            st = miss[s]
            if km <= OFFSHORE_KM and (np.isnan(off[st]) or km < off[st]):
                key[st], off[st] = owner[g], km
    return key, land, off


# ---------------------------------------------------------------- population / income peers
def load_shapes_module():
    spec = importlib.util.spec_from_file_location("bws", ROOT / "scripts" / "build_world_shapes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def population_and_income(ne_dir: Path, names):
    bws = load_shapes_module()
    lookup = {bws.norm(n): n for n in names}
    for firms, alts in bws.ALIASES.items():
        for alt in alts:
            lookup[bws.norm(alt)] = firms
    c50, _ = bws.match_features(bws.load_layer(ne_dir, bws.NE50), lookup)
    c10, _ = bws.match_features(bws.load_layer(ne_dir, bws.NE10), lookup)
    out = {}
    for n in names:
        feats = c50.get(n) or c10.get(n) or []
        pops = [(f["properties"].get("POP_EST") or 0, f["properties"]) for f in feats]
        if not pops:
            out[n] = (None, None, None)
            continue
        pop = sum(max(0, p) for p, _ in pops)
        top = max(pops, key=lambda t: t[0])[1]
        out[n] = (float(pop), top.get("INCOME_GRP"), top.get("REGION_WB"))
    return out


def completeness(names, n_st, land, popinc):
    per_m = {n: n_st[n] / (popinc[n][0] / 1e6) if popinc[n][0] else None for n in names}
    per_a = {n: n_st[n] / (land[n] / 1e4) if land[n] > 0 else None for n in names}
    groups = defaultdict(list)
    for n in names:
        pop, inc, _ = popinc[n]
        if pop and pop >= PEER_MIN_POP and inc:
            groups[inc].append(n)
    med_m = {g: statistics.median(per_m[n] for n in v) for g, v in groups.items()}
    med_a = {g: statistics.median(per_a[n] for n in v if per_a[n] is not None) for g, v in groups.items()}
    out = {}
    for n in names:
        pop, inc, reg = popinc[n]
        rec = {"stations": n_st[n], "land_km2": round(land[n]), "population": int(pop) if pop else None,
               "income_group": inc, "region": reg, "peers": len(groups.get(inc, [])),
               "per_million": r3(per_m[n]), "peer_median_per_million": r3(med_m.get(inc)),
               "per_10k_km2": r3(per_a[n]), "peer_median_per_10k_km2": r3(med_a.get(inc))}
        ratio = per_m[n] / med_m[inc] if per_m[n] is not None and med_m.get(inc) else None
        rec["ratio"] = r3(ratio)
        rec["ratio_area"] = r3(per_a[n] / med_a[inc]) if per_a[n] is not None and med_a.get(inc) else None
        if pop is None or ratio is None:
            level = "unpopulated" if pop is not None and pop < UNPOP else "no_data"
        elif pop < UNPOP:
            level = "unpopulated"
        elif ratio < THIN or per_m[n] < THIN_ABS or (n_st[n] < MIN_STATIONS and pop >= MIN_STATIONS_POP):
            level = "thin"
        elif ratio < FAIR or per_m[n] < FAIR_ABS:
            level = "patchy"
        else:
            level = "fair"
        rec["level"] = level
        rec["thin"] = level in ("thin", "patchy", "no_data")
        out[n] = rec
    return out


def r3(x):
    if x is None:
        return None
    return float(f"{x:.3g}")


# ---------------------------------------------------------------- per country
def decode_cells(d):
    """Cell centres (lon, lat), exactly as src/country.ts cellIndexes + drawMap."""
    cells = np.array(d["cells"], np.int64).reshape(-1, 2)
    la, lo = cells[:, 0].copy(), cells[:, 1].copy()
    lim = 180 / d["cell"] + 1
    fix = lo > lim
    lo[fix] -= 100000
    la[fix] += 1
    return (lo + 0.5) * d["cell"], (la + 0.5) * d["cell"], la, lo


def persistent_base_cells(cache: Path):
    """0.05 degree base cells (keys la * 100000 + lo, as the summary build) with their VIIRS detections
    2012-2025 and the part from persistent cells: detections in >= PERSIST_MONTHS distinct months of a
    year, in >= PERSIST_YEARS years, holding >= PERSIST_ISOLATION of the detections of its 3 x 3
    neighbourhood. Gas flares, mills and solar plants behave like that. Equatorial crop and savanna
    burning can also be seen in 8+ months a year, but it is spread over the landscape, so the isolation
    test leaves it alone (Democratic Republic of the Congo: 6,940 base cells pass the month test, 10
    pass both)."""
    import duckdb
    f = cache / "viirs_base_cell_year.parquet"
    con = duckdb.connect()
    if not f.exists():
        con.execute(f"""COPY (
            SELECT CAST(floor(round(latitude * 100000) / 5000) AS INTEGER) la,
                   CAST(floor(round(longitude * 100000) / 5000) AS INTEGER) lo,
                   CAST(year(acq_date) AS SMALLINT) y, CAST(count(DISTINCT month(acq_date)) AS TINYINT) nm,
                   CAST(count(*) AS INTEGER) n
            FROM read_parquet('{HF / "viirs-snpp"}/*/*.parquet', union_by_name = true)
            WHERE type = 0 AND confidence IN ('n', 'h') AND acq_date >= DATE '{Y_FROM}-01-01'
              AND acq_date < DATE '{Y_TO + 1}-01-01'
            GROUP BY ALL) TO '{f}' (FORMAT parquet)""")
    r = con.execute(f"""SELECT la, lo, sum(n) AS n, count(*) FILTER (WHERE nm >= {PERSIST_MONTHS}) AS yp
                        FROM '{f}' GROUP BY la, lo""").fetchnumpy()
    la, lo = np.asarray(r["la"], np.int64), np.asarray(r["lo"], np.int64)
    n = np.asarray(r["n"], float)
    key = la * 100000 + lo
    order = np.argsort(key)
    sk, sn = key[order], n[order]
    hood = np.zeros(n.size)  # detections in the 3 x 3 base cells around each cell, itself included
    for dla in (-1, 0, 1):
        for dlo in (-1, 0, 1):
            k = key + dla * 100000 + dlo
            pos = np.minimum(np.searchsorted(sk, k), sk.size - 1)
            hood += np.where(sk[pos] == k, sn[pos], 0.0)
    pers = (np.asarray(r["yp"]) >= PERSIST_YEARS) & (n >= PERSIST_ISOLATION * hood)
    return la, lo, n, np.where(pers, n, 0.0)


def persistent_share(base, d, la_c, lo_c):
    """Per summary cell: share of its VIIRS detections 2012-2025 from persistent base cells."""
    bla, blo, bn, bp = base
    step = round(d["cell"] * 100000) // 5000
    k = np.floor_divide(bla, step) * 100000 + np.floor_divide(blo, step)
    want = la_c.astype(np.int64) * 100000 + lo_c
    order = np.argsort(want)
    pos = np.searchsorted(want[order], k)
    pos[pos >= want.size] = 0
    hit = want.size > 0
    hit = (want[order][pos] == k) if hit else np.zeros(k.size, bool)
    tot = np.zeros(want.size)
    per = np.zeros(want.size)
    np.add.at(tot, order[pos[hit]], bn[hit])
    np.add.at(per, order[pos[hit]], bp[hit])
    return np.divide(per, tot, out=np.zeros_like(tot), where=tot > 0)


def burn_stats(d, nc):
    rows = np.array(d["cell_rows"], float).reshape(-1, 5)
    y = d["y0"] + rows[:, 1].astype(int)
    keep = (y >= Y_FROM) & (y <= Y_TO) & ((rows[:, 2] > 0) | (rows[:, 3] > 0) | (rows[:, 4] > 0))
    c = rows[keep, 0].astype(int)
    years = np.zeros(nc, int)
    np.add.at(years, c, 1)  # one row per cell and year, so this counts years
    harm = np.zeros(nc)
    np.add.at(harm, rows[keep, 0].astype(int), rows[keep, 2])
    return years, harm / (Y_TO - Y_FROM + 1)


def v1_fire(d, nc, base, la_c, lo_c):
    years, mean_h = burn_stats(d, nc)
    pshare = persistent_share(base, d, la_c, lo_c) if nc else np.zeros(0)
    persistent = pshare >= PERSIST_SHARE
    return {"years": years, "credit": np.where(persistent, 0.0, mean_h), "masked": persistent,
            "why": np.where(persistent, 1, 0), "order": None}


# ---------------------------------------------------------------- v2 fire and static-source mask
def v2_cache(cache: Path):
    """Two parquet files from the FIRMS archive (read only):
    v2_static_typed.parquet: per 0.05 degree square, a bitmask of the years 2012-2025 with FIRMS type 1-3
        detections from any sensor, and their number;
    v2_snpp_pooled.parquet: Suomi NPP n/h detections 2012-2025 per country file, 0.05 degree square, year,
        calendar month and day/night, with a flag: 0 type 0, 1 type 0 near a FIRMS static spot, 2 type 0
        in a recurrent all-season spot (tested with its 8 neighbours), 3 typed 1-3 by FIRMS. Sorted by country."""
    import duckdb
    fb, fs = cache / "v2_static_typed.parquet", cache / "v2_snpp_pooled.parquet"
    if fb.exists() and fs.exists():
        return fb, fs
    con = duckdb.connect()
    (cache / "duckdb_tmp").mkdir(exist_ok=True)  # spill files next to the cache, not in the working directory
    con.execute(f"SET temp_directory = '{cache / 'duckdb_tmp'}'")
    con.execute("SET preserve_insertion_order = false")
    when = f"acq_date >= DATE '{Y_FROM}-01-01' AND acq_date < DATE '{Y_TO + 1}-01-01'"
    allsens = ", ".join(f"'{HF / s}/*/*.parquet'" for s in ("modis", "viirs-snpp", "viirs-jpss1"))
    snpp = f"'{HF / 'viirs-snpp'}/*/*.parquet'"
    base = ("CAST(floor(round(latitude * 100000) / 5000) AS INTEGER) AS la, "
            "CAST(floor(round(longitude * 100000) / 5000) AS INTEGER) AS lo")
    spot = "CAST(floor(latitude * 100) AS INTEGER) AS sa, CAST(floor(longitude * 100) AS INTEGER) AS so"
    con.execute(f"""CREATE TEMP TABLE typed AS SELECT {base}, {spot}, CAST(year(acq_date) AS INTEGER) y
        FROM read_parquet([{allsens}], union_by_name = true) WHERE type BETWEEN 1 AND 3 AND {when}""")
    con.execute(f"""COPY (SELECT la, lo, CAST(bit_or(1 << (y - {Y_FROM})) AS INTEGER) AS yrs,
        CAST(count(*) AS INTEGER) AS n FROM typed
        GROUP BY la, lo) TO '{fb}' (FORMAT parquet)""")
    con.execute(f"""CREATE TEMP TABLE near AS SELECT DISTINCT s.sa + a.d AS sa, s.so + b.d AS so FROM
        (SELECT sa, so FROM typed GROUP BY sa, so HAVING count(DISTINCT y) >= {STATIC_SPOT_YEARS}) s,
        (VALUES (-1), (0), (1)) a(d), (VALUES (-1), (0), (1)) b(d)""")
    con.execute(f"""CREATE TEMP VIEW det AS SELECT
        regexp_extract(filename, 'viirs-snpp_[0-9]{{4}}_(.*)[.]parquet', 1) AS k, {base}, {spot},
        CAST(year(acq_date) AS SMALLINT) y, CAST(month(acq_date) AS TINYINT) m, daynight = 'N' AS night,
        daynight = 'N' AND frp < {WEAK_FRP_MW} AS weak, type <> 0 AS typed
        FROM read_parquet({snpp}, union_by_name = true, filename = true)
        WHERE confidence IN ('n', 'h') AND {when}""")
    # each spot is tested on the detections of its 3 x 3 spot neighbourhood (about 3 km): a flare's
    # detections scatter over neighbouring 0.01 degree spots, so one spot alone can miss the year or month counts
    con.execute(f"""CREATE TEMP TABLE spot AS SELECT sa, so, bit_or(1 << (y::INTEGER - {Y_FROM})) AS ys,
        bit_or(1 << (m::INTEGER - 1)) AS ms, sum(night::INTEGER) AS nn, sum(weak::INTEGER) AS nw,
        count(*) AS n FROM det WHERE NOT typed GROUP BY sa, so""")
    con.execute(f"""CREATE TEMP TABLE pooled AS SELECT t.sa + a.d AS sa, t.so + b.d AS so,
        bit_count(bit_or(t.ys)) AS py, bit_count(bit_or(t.ms)) AS pm, sum(t.nn) AS pnn, sum(t.nw) AS pnw,
        sum(t.n) AS pn FROM spot t, (VALUES (-1), (0), (1)) a(d), (VALUES (-1), (0), (1)) b(d) GROUP BY 1, 2""")
    con.execute(f"""CREATE TEMP TABLE recur AS SELECT s.sa, s.so FROM spot s JOIN pooled p USING (sa, so)
        WHERE (bit_count(s.ys) >= {RECUR_YEARS} AND bit_count(s.ms) >= {RECUR_MONTHS} AND s.nn >= {RECUR_NIGHT} * s.n)
           OR (p.py >= {RECUR_YEARS} AND p.pm >= {RECUR_MONTHS} AND p.pnn >= {RECUR_NIGHT} * p.pn
               AND p.pnw >= {RECUR_POOL_WEAK} * p.pn)
           OR (p.py >= {RECUR_YEARS} AND p.pm >= {RECUR_NIGHT_MONTHS} AND p.pnn >= {RECUR_NIGHT_ONLY} * p.pn
               AND p.pnw >= {RECUR_POOL_WEAK} * p.pn)""")
    con.execute(f"""COPY (SELECT det.k, det.la, det.lo, det.y, det.m, det.night, det.weak,
            CAST(CASE WHEN det.typed THEN 3 WHEN near.sa IS NOT NULL THEN 1 WHEN recur.sa IS NOT NULL THEN 2
                      ELSE 0 END AS TINYINT) AS flag, CAST(count(*) AS INTEGER) AS n
        FROM det LEFT JOIN near ON near.sa = det.sa AND near.so = det.so
                 LEFT JOIN recur ON recur.sa = det.sa AND recur.so = det.so
        GROUP BY ALL ORDER BY det.k) TO '{fs}' (FORMAT parquet, ROW_GROUP_SIZE 100000)""")
    return fb, fs


class V2Fire:
    """Per-country fire and mask from the v2 cache."""

    def __init__(self, cache: Path, base):
        import duckdb
        self.fb, self.fs = v2_cache(cache)
        self.con = duckdb.connect()
        r = self.con.execute(f"SELECT la, lo, yrs, n FROM '{self.fb}'").fetchnumpy()
        self.s_la = np.asarray(r["la"], np.int64)
        self.s_lo = np.asarray(r["lo"], np.int64)
        self.s_years = np.asarray(r["yrs"], np.int64)
        self.s_n = np.asarray(r["n"], float)
        self.base = base
        bla, blo, _, bp = base  # v1 persistent squares
        self.pers = np.sort(bla[bp > 0].astype(np.int64) * 100000 + blo[bp > 0])
        sk = self.s_la * 100000 + self.s_lo  # squares with FIRMS type 1-3 detections, and in which years
        o = np.argsort(sk)
        self.s_key, self.s_key_years = sk[o], self.s_years[o]
        t = self.con.execute(f"SELECT flag, sum(n) FROM '{self.fs}' GROUP BY 1 ORDER BY 1").fetchall()
        self.flag_totals = {int(f): int(n) for f, n in t}

    def country(self, key, d, la_c, lo_c):
        nc = la_c.size
        ny = Y_TO - Y_FROM + 1
        r = self.con.execute(f"SELECT la, lo, y, m, night, weak, flag, n FROM '{self.fs}' WHERE k = ?",
                             [key]).fetchnumpy()
        la, lo = np.asarray(r["la"], np.int64), np.asarray(r["lo"], np.int64)
        y, mo = np.asarray(r["y"], int), np.asarray(r["m"], int)
        night, weak = np.asarray(r["night"], bool), np.asarray(r["weak"], bool)
        flag, n = np.asarray(r["flag"], int), np.asarray(r["n"], float)
        step = round(d["cell"] * 100000) // 5000
        want = la_c.astype(np.int64) * 100000 + lo_c
        order = np.argsort(want)
        sw = want[order]

        def cell_of(bla, blo):
            k = np.floor_divide(bla, step) * 100000 + np.floor_divide(blo, step)
            if not sw.size:
                return np.full(k.size, -1)
            p = np.minimum(np.searchsorted(sw, k), sw.size - 1)
            return np.where(sw[p] == k, order[p], -1)
        c = cell_of(la, lo)
        bk = la * 100000 + lo
        if self.pers.size:
            p = np.minimum(np.searchsorted(self.pers, bk), self.pers.size - 1)
            flag = np.where((flag == 0) & (self.pers[p] == bk), 4, flag)
        if self.s_key.size:  # as summary/v2: a square is dropped for a year in which FIRMS typed 1-3 there
            p = np.minimum(np.searchsorted(self.s_key, bk), self.s_key.size - 1)
            typed_year = (self.s_key[p] == bk) & ((self.s_key_years[p] >> (y - Y_FROM)) & 1 == 1)
            flag = np.where((flag == 0) & typed_year, 5, flag)
        ok = c >= 0
        c, y, mo, night, weak, flag, n = c[ok], y[ok], mo[ok], night[ok], weak[ok], flag[ok], n[ok]
        clean = flag == 0
        tot, bad, cn, cweak, cnight = (np.zeros(nc) for _ in range(5))
        months = np.zeros((nc, 12))
        yrs = np.zeros((nc, ny), bool)
        evid = flag != 5  # a typed square-year removes all its detections, fire too: not evidence of a static site
        np.add.at(tot, c[evid], n[evid])
        np.add.at(bad, c[~clean & evid], n[~clean & evid])
        np.add.at(cn, c[clean], n[clean])
        np.add.at(cweak, c[clean & weak], n[clean & weak])
        np.add.at(cnight, c[clean & night], n[clean & night])
        np.add.at(months, (c[clean], mo[clean] - 1), n[clean])
        yrs[c[clean], y[clean] - Y_FROM] = True
        years = yrs.sum(1)
        top6 = np.divide(np.sort(months, 1)[:, 6:].sum(1), cn, out=np.zeros(nc), where=cn > 0)

        def typed_around(r):
            """FIRMS type 1-3 years and detections in each cell or within r 0.05 degree squares of its edge."""
            ring = np.zeros(nc, np.int64)
            pairs = []  # (typed square, cell), each pair counted once
            for dla in range(-r, r + 1):
                for dlo in range(-r, r + 1):
                    cc = cell_of(self.s_la + dla, self.s_lo + dlo)
                    m = cc >= 0
                    np.bitwise_or.at(ring, cc[m], self.s_years[m])
                    pairs.append(np.stack([np.nonzero(m)[0], cc[m]]))
            count = np.zeros(nc)
            if nc and pairs:
                sq, cl = np.unique(np.concatenate(pairs, 1), axis=1)
                np.add.at(count, cl, self.s_n[sq])
            return np.array([bin(int(v)).count("1") for v in ring], int), count
        static_years, typed_n = typed_around(1)
        wide_years, wide_n = typed_around(FLARE_WIDE_RING)
        seasonal = (cn >= MASK_MIN_N) & (top6 >= SEASONAL_TOP6)
        big = cn >= BIG_PER_YEAR * ny
        share = np.divide(bad, tot, out=np.zeros(nc), where=tot > 0)
        weak_share = np.divide(cweak, cn, out=np.zeros(nc), where=cn > 0)
        night_share = np.divide(cnight, cn, out=np.zeros(nc), where=cn > 0)
        nmonths = (months > 0).sum(1)
        why = np.zeros(nc, int)
        night_flare = (((weak_share >= NIGHT_WEAK_SHARE) | (night_share >= NIGHT_SHARE)) & (top6 < NIGHT_MAX_TOP6)
                       | (night_share >= NIGHT_SHARE_LOW) & (top6 < NIGHT_LOW_MAX_TOP6))
        why[(weak_share >= NIGHT_ONLY_WEAK) & (years >= NIGHT_ONLY_YEARS)
            & ((night_share >= NIGHT_ONLY_SHARE)
               | (night_share >= NIGHT_SPREAD_SHARE) & (nmonths >= NIGHT_SPREAD_MONTHS) & (cn >= MASK_MIN_N))] = 4
        why[(cn >= MASK_MIN_N) & night_flare & (years >= NIGHT_MIN_YEARS) & (nmonths >= NIGHT_MIN_MONTHS)] = 3
        spill = (static_years >= MASK_STATIC_YEARS) & (
            (cn < SPARSE_PER_YEAR * ny) | (~seasonal & (weak_share >= FLARE_WEAK_NIGHT) & (cn < BIG_PER_YEAR * ny)))
        outnumbered = (cn < BIG_PER_YEAR * ny) & (  # long-typed flares outnumber the rest: no seasonal exemption
            (static_years >= FLARE_LONG_YEARS) & (typed_n >= FLARE_LONG_RATIO * cn)
            | (wide_years >= FLARE_LONG_YEARS) & (wide_n >= FLARE_WIDE_RATIO * cn) & (top6 < FLARE_WIDE_TOP6)
            & (d["cell"] <= FLARE_WIDE_MAX_CELL))
        why[spill | outnumbered] = 2
        why[((share >= PERSIST_SHARE) & ~(seasonal & big)) | ((share >= STATIC_SHARE) & ~seasonal)] = 1
        if nc:  # everything v1 listed as persistent stays masked
            why[persistent_share(self.base, d, la_c, lo_c) >= PERSIST_SHARE] = 1
        masked = why > 0
        mean = cn / ny
        credit = np.where(masked, 0.0, mean)
        return {"years": years, "credit": credit, "masked": masked, "why": why, "mean": mean,
                "static_years": static_years,
                "order": ((years < GAP_OFTEN_YEARS).astype(int), -np.round(mean, 1)),
                "features": {"static_share": share, "top6": top6, "weak_night": weak_share, "night": night_share, "months": nmonths, "typed_n": typed_n,
                             "wide_years": wide_years, "wide_n": wide_n,
                             "static_years": static_years, "remaining": cn}}


def build_country(key, name, d, st, comp, source_note, base, v2=None, ver=None):
    """st: list of (type, id, lat, lon, name, operator) in this country, plus (source, Overture id) in v3.
    v2: a V2Fire (v2 and v3), or None for v1."""
    nc = len(d["cells"]) // 2
    clon, clat, la_c, lo_c = decode_cells(d)
    fire = v2.country(key, d, la_c, lo_c) if v2 else v1_fire(d, nc, base, la_c, lo_c)
    ver = ver or (2 if v2 else 1)
    years, persistent = fire["years"], fire["masked"]
    ny = Y_TO - Y_FROM + 1
    n = len(st)
    k = min(K_NEAR, n)
    idx = np.full((nc, K_NEAR), -1)
    km = np.full((nc, K_NEAR), -1.0)
    if n and nc:
        slon = np.array([s[3] for s in st])
        slat = np.array([s[2] for s in st])
        tree = cKDTree(unit(slon, slat))
        dist, ii = tree.query(unit(clon, clat), k=k)
        dist, ii = dist.reshape(nc, k), ii.reshape(nc, k)
        idx[:, :k] = ii
        km[:, :k] = 2 * R_KM * np.arcsin(np.minimum(dist / 2, 1))
    share = years / ny
    gap = (share >= GAP_SHARE) & ~persistent & ((km[:, 0] > GAP_KM) if n else True)
    # ranking: credit each cell's mean yearly harmonized count to its nearest station
    credit = np.zeros(n)
    ncell = np.zeros(n, int)
    if n and nc:
        fire_h = fire["credit"]
        np.add.at(credit, idx[:, 0], fire_h)
        np.add.at(ncell, idx[:, 0], (fire_h > 0).astype(int))
    order = [int(i) for i in np.argsort(-credit, kind="stable")[:RANK_N] if credit[i] > 0]
    # station list: all, or (big countries) only those used by a cell row or the ranking
    used = np.arange(n)
    subset = n > MAX_STATIONS
    if subset:
        used = np.unique(np.concatenate([idx[idx >= 0].ravel(), np.array(order, int)]))
    remap = np.full(n, -1)
    remap[used] = np.arange(used.size)
    ops = Counter(st[i][5] for i in used if st[i][5])
    op_list = [o for o, _ in ops.most_common()]
    op_ix = {o: i for i, o in enumerate(op_list)}
    stations, osm, overture = [], [], []
    for i in used:
        t, oid, la_, lo_, nm, op = st[i][:6]
        stations.append([round(lo_, COORD_DECIMALS), round(la_, COORD_DECIMALS), nm, op_ix.get(op, -1)])
        osm.append("" if t == "o" else f"{t}{oid}")
        if ver >= 3:
            stations[-1].append(st[i][6])
            overture.append(st[i][7])
    rows = []
    for c in range(nc):
        r = [c] + [int(remap[i]) if i >= 0 else -1 for i in idx[c]]
        r += [round(float(x), 1) if x >= 0 else -1 for x in km[c]] + [int(years[c])]
        rows += r
    if fire["order"] is None:
        gap_cells = sorted(np.nonzero(gap)[0].tolist(), key=lambda c: (-years[c], -km[c, 0]))
    else:
        o1, o2 = fire["order"]
        gap_cells = sorted(np.nonzero(gap)[0].tolist(), key=lambda c: (o1[c], o2[c], -km[c, 0]))
    ranking = [[int(remap[i]), round(float(credit[i]), 1), int(ncell[i])] for i in order]
    level = comp["level"]
    gap_note = GAP_NOTE_V3[level] if ver >= 3 else {
        "fair": "OpenStreetMap is mapped about as densely here as in peer countries, but it is never complete: "
                "a gap means no station is mapped within %g km, not that none exists." % GAP_KM,
        "patchy": "OpenStreetMap fire stations look patchy here (fewer than peer countries per person): many "
                  "gaps may be unmapped stations. Show them as 'no mapped station within %g km'." % GAP_KM,
        "thin": "OpenStreetMap fire stations look thin here: distances and gaps mostly reflect the map, not "
                "real fire cover. Do not present gaps as places without a station.",
        "unpopulated": "Few or no people live here; station distances are shown for completeness only.",
        "no_data": "No population figure to judge OpenStreetMap coverage; treat gaps as unverified.",
    }[level]
    head = (
        f"Fire stations: every OpenStreetMap object tagged amenity=fire_station (nodes; centroids of ways and "
        f"relations), {source_note}, objects within {MERGE_M} m merged into one site, assigned to this country by its simplified Natural Earth outline (stations "
        f"up to {OFFSHORE_KM:g} km offshore go to the nearest outline). Fire cells: the {d['cell']:g} degree "
        f"cells of summary/v2/{key}.json. km: great-circle distance from the cell centre to the {K_NEAR} "
        f"nearest stations in this country (stations across a border are not searched). ")
    mapped = ("OSM stations" if ver < 3 else
              "mapped stations (OpenStreetMap and Overture, a station in both counted once)")
    tail = (
        f"Straight-line distance "
        f"is not drive time, and a detection is not a fire. Mapping completeness ({level}): {mapped} per "
        f"million people, against the median of countries in the same income group and against fixed floors "
        f"({THIN_ABS:g} and {FAIR_ABS:g} per million); 'fair' does not mean complete. {gap_note}")
    if ver == 1:
        method = head + (
            f"burn years: years "
            f"{Y_FROM}-{Y_TO} with any detection in the cell. Gap: burned in at least {GAP_SHARE:.0%} of those "
            f"{ny} years and no mapped station within {GAP_KM:g} km of the cell centre. Cells where most VIIRS "
            f"detections come from persistent point sources (isolated 0.05 degree spots seen in {PERSIST_MONTHS}+ "
            f"months of a year in {PERSIST_YEARS}+ years: gas flares, plants, mills) are listed as persistent and are never gaps "
            f"or ranked. Ranking: each other cell's mean yearly harmonized detections {Y_FROM}-{Y_TO} credited to "
            f"its nearest station. ") + tail
    else:
        if ver >= 3:
            head = (
                f"Fire stations: every OpenStreetMap object tagged amenity=fire_station (nodes; centroids of ways and "
                f"relations), {source_note.split('; ')[0]}, objects within {MERGE_M} m merged into one site; plus every "
                f"Overture Maps Places place (release {OVERTURE_RELEASE}) whose primary category is "
                f"{OVERTURE_CATEGORY}, with confidence {OVERTURE_MIN_CONF:g} or more and not marked closed, less "
                f"names that are not a station (extinguisher, sprinkler and equipment firms, shops, union locals, "
                f"schools, academies and training grounds, museums; security firms, police and Red Cross posts unless "
                f"the name also says fire service), places only business directories list whose name does not say "
                f"fire service, places at whole-degree coordinates, and names repeated {OVERTURE_REPEAT}+ times among "
                f"the added stations without a fire word. Overture places within {SAME_M} m of each other, within "
                f"{SAME_NAME_M / 1000:g} km with similar names (the distinctive words of one name all in the other, or "
                f"one name inside the other, and no different station numbers), or within {SAME_EXACT_M / 1000:g} km "
                f"with the same name, are one station; one that close to an OpenStreetMap station, by the same tests, "
                f"is that station, and the OpenStreetMap record is kept (source 'both'). Overture places come partly "
                f"from business listings and web pages, so some may be misplaced, closed or not a station. Stations "
                f"are assigned to this country by its simplified Natural Earth outline (stations up to "
                f"{OFFSHORE_KM:g} km offshore go to the nearest outline). Fire cells: the "
                f"{d['cell']:g} degree cells of summary/v2/{key}.json. km: great-circle distance from the cell centre "
                f"to the {K_NEAR} nearest stations in this country (stations across a border are not searched). ")
        method = head + (
            f"Fire: VIIRS Suomi NPP detections that FIRMS types as presumed vegetation fire (type 0), nominal or "
            f"high confidence, {Y_FROM}-{Y_TO}, after removing static sources: detections within about 1 km of a "
            f"spot FIRMS typed as volcano, static land source (flares, industry) or offshore in {STATIC_SPOT_YEARS}+ "
            f"years; 0.01 degree spots with detections in {RECUR_YEARS}+ years and {RECUR_MONTHS}+ calendar months, "
            f"mostly at night, alone or pooled with the 8 spots around them (pooled, at least "
            f"{RECUR_POOL_WEAK:.0%} must be weak night detections, and {RECUR_NIGHT_MONTHS}+ months are enough when "
            f"{RECUR_NIGHT_ONLY:.0%} are at night): flares FIRMS did not type; the persistent 0.05 degree squares of v1; and, as in "
            f"summary/v2, a 0.05 degree square for any year in which FIRMS typed a detection there. burn years: "
            f"years with at least one remaining detection in the cell. Masked cells (listed in persistent, never "
            f"gaps, never ranked), where seasonal means at least {SEASONAL_TOP6:.0%} of the remaining detections "
            f"fall in the busiest 6 calendar months: static (at least {PERSIST_SHARE:.0%} of the cell's detections "
            f"are static, unless the rest is seasonal and {BIG_PER_YEAR}+ a year; or at least {STATIC_SHARE:.0%} "
            f"and the rest is not seasonal; or persistent in v1); flare_field (FIRMS typed static detections in or "
            f"within about 5 km of the cell in {MASK_STATIC_YEARS}+ years, and the rest is under {SPARSE_PER_YEAR} "
            f"a year, or not seasonal, under {BIG_PER_YEAR} a year with many weak night detections; or typed in "
            f"{FLARE_LONG_YEARS}+ years with more typed detections than remaining ones (or, within about 20 km, "
            f"{FLARE_WIDE_RATIO:g} times as many and no short season, in cells up to {FLARE_WIDE_MAX_CELL:g} "
            f"degrees), and the rest under {BIG_PER_YEAR} a year, seasonal or not: oil fields such as Berkine and "
            f"Hassi Messaoud); night_all_season (detections in "
            f"{NIGHT_MIN_YEARS}+ years and {NIGHT_MIN_MONTHS}+ calendar months, mostly at night or weak at night "
            f"(FRP under {WEAK_FRP_MW:g} MW), without one short season: untyped flare fields such as the Bakken); "
            f"night_weak (at least {NIGHT_ONLY_WEAK:.0%} of the rest are weak night detections and at least "
            f"{NIGHT_ONLY_SHARE:.0%} are at night in any months, or {NIGHT_SPREAD_SHARE:.0%} over "
            f"{NIGHT_SPREAD_MONTHS}+ calendar months: flares, kilns and mines). "
            f"Gap: burned in at least "
            f"{math.ceil(GAP_SHARE * ny)} of the {ny} years, not masked, and no mapped station within {GAP_KM:g} km "
            f"of the cell centre. Gaps are listed in two groups, cells that burned in at least {GAP_OFTEN_YEARS} "
            f"of the {ny} years first, then the rest, and within each by detections per year. Ranking: each "
            f"unmasked cell's remaining detections per year credited to its "
            f"nearest station. ") + tail
    if d["cell"] >= 0.5:
        method += (f" Cells here are {d['cell']:g} degrees wide, so the distance from a cell centre says "
                   f"little about any one place inside the cell.")
    if subset:
        method += (f" This file lists {used.size:,} of the {n:,} mapped stations: only those that are among "
                   f"the {K_NEAR} nearest to some fire cell or in the ranking.")
    out = {
        "v": ver, "country": key, "name": name,
        "attribution": ATTRIBUTION, "licence": LICENCE,
        "source": source_note, "summary": f"summary/v2/{key}.json", "cell": d["cell"],
        "years": [Y_FROM, Y_TO], "gap_rule": {"min_share": GAP_SHARE, "min_years": int(math.ceil(GAP_SHARE * ny)),
                                              "km": GAP_KM},
        "stations_total": n, "stations_subset": bool(subset),
        "stations": stations, "osm": osm, "operators": op_list,
        "cell_rows": rows, "gaps": [int(c) for c in gap_cells], "ranking": ranking,
        "persistent": [int(c) for c in np.nonzero(persistent)[0]],
        "completeness": comp, "gap_note": gap_note, "method": method,
    }
    if ver >= 3:
        out["attribution"], out["licence"] = ATTRIBUTION_V3, LICENCE_V3
        out["overture"] = overture
        srcs = Counter(st[i][6] for i in range(n))
        out["station_sources"] = {"osm": srcs["osm"], "both": srcs["both"], "overture": srcs["overture"]}
        out["source_codes"] = SOURCE_CODES
    if ver >= 2:
        out["fire"] = ("VIIRS Suomi NPP type 0, confidence n/h, static sources removed")
        out["persistent_why"] = [int(fire["why"][c]) for c in np.nonzero(persistent)[0]]
        out["why_codes"] = {str(k): v for k, v in MASK_WHY.items()}
        out["fire_per_year"] = [round(float(x), 1) for x in fire["mean"]]
    stats = {"cells": nc, "burn_cells": int((share >= GAP_SHARE).sum()), "gaps": len(gap_cells),
             "persistent": int(persistent.sum()),
             "why": [int((fire["why"] == w).sum()) for w in MASK_WHY],
             "median_km_burn": r3(float(np.median(km[share >= GAP_SHARE, 0]))) if n and (share >= GAP_SHARE).any() else None}
    return out, stats


def dumps(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", type=Path, default=ROOT / "build" / "stations_cache")
    ap.add_argument("--ne", type=Path, default=ROOT / "build" / "ne", help="Natural Earth download folder")
    ap.add_argument("--source", choices=["qlever", "overpass"], default="qlever")
    ap.add_argument("--version", type=int, choices=[1, 2, 3], default=2,
                    help="1: the published v1 method; 2: FIRMS-typed static-source mask (default); "
                         "3: v2 with Overture Maps Places fire stations added")
    ap.add_argument("--out", type=Path, default=None, help="default build/hf/stations/v<version>")
    ap.add_argument("--report", type=Path, default=None, help="optional per-country CSV report")
    args = ap.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    ver = args.version
    args.out = args.out or HF / "stations" / f"v{ver}"

    raw, source_note, snapshot = (fetch_qlever if args.source == "qlever" else fetch_overpass)(args.cache)
    st = dedupe(raw)
    by_type = Counter(s[0] for s in st)
    print(f"{len(st):,} fire station objects ({by_type['n']:,} nodes, {by_type['w']:,} ways, {by_type['r']:,} "
          f"relations) from {source_note}")
    n_obj = len(st)
    st, merged = merge_sites(st)
    print(f"{len(st):,} sites after merging {merged:,} objects within {MERGE_M} m of another")
    n_osm_sites = len(st)
    if ver >= 3:
        ov = fetch_overture(args.cache)
        st, ov_stats = add_overture(st, ov)
        print(f"Overture {OVERTURE_RELEASE}: {ov_stats['overture_places']:,} {OVERTURE_CATEGORY} places, "
              f"{ov_stats['kept']:,} kept (dropped: {ov_stats['dropped']}), "
              f"{ov_stats['overture_sites']:,} sites; {ov_stats['matched_sites']:,} are OSM stations "
              f"({ov_stats['osm_also_in_overture']:,} OSM sites marked both), {ov_stats['overture_only']:,} added; "
              f"chain names dropped: {ov_stats['dropped_repeated_names']}")
        source_note = f"{source_note}; Overture Maps Places release {OVERTURE_RELEASE}"

    world = load_world()
    keys = [c["k"] for c in world]
    lon = np.array([s[3] for s in st])
    lat = np.array([s[2] for s in st])
    owner, land_arr, off = assign_countries(world, lon, lat)
    print(f"assigned: {(owner >= 0).sum():,} ({np.isfinite(off).sum():,} offshore within {OFFSHORE_KM:g} km), "
          f"dropped {(owner < 0).sum():,}")
    per = defaultdict(list)
    for s, o in zip(st, owner):
        if o >= 0:
            per[keys[o]].append(s)
    for k in per:  # stable order: by OSM type and id (v3: then the Overture-only stations by Overture id)
        per[k].sort(key=lambda s: (s[0], s[1]) if ver < 3 else (s[0] == "o", s[0], s[1]))
    n_st = {k: len(per[k]) for k in keys}
    land = {k: float(land_arr[i]) for i, k in enumerate(keys)}
    popinc = population_and_income(args.ne, keys)
    comp = completeness(keys, n_st, land, popinc)
    base = persistent_base_cells(args.cache)
    print(f"persistent base cells: {(base[3] > 0).sum():,}, {base[3].sum() / base[2].sum():.1%} of VIIRS detections")
    v2 = V2Fire(args.cache, base) if ver >= 2 else None
    if v2:
        ft = v2.flag_totals
        print("Suomi NPP n/h detections 2012-2025: " + ", ".join(
            f"{lab} {ft.get(f, 0):,}" for f, lab in [(0, "type 0"), (1, "type 0 near FIRMS static spots"),
                                                     (2, "type 0 in recurrent night spots"), (3, "typed 1-3")]))

    args.out.mkdir(parents=True, exist_ok=True)
    index, report = [], []
    names = {c["k"]: c["n"] for c in world}
    for k in keys:
        sf = HF / "summary" / "v2" / f"{k}.json"
        d = json.loads(sf.read_text("utf-8"))
        o, stats = build_country(k, d.get("name") or names[k], d, per[k], comp[k], source_note, base, v2, ver)
        body = dumps(o)
        (args.out / f"{k}.json").write_text(body, "utf-8")
        c = comp[k]
        index.append({"country": k, "name": o["name"], "file": f"stations/v{ver}/{k}.json", "bytes": len(body.encode()),
                      "stations": n_st[k], "listed": len(o["stations"]), "per_million": c["per_million"],
                      "per_10k_km2": c["per_10k_km2"], "ratio": c["ratio"], "level": c["level"], "thin": c["thin"],
                      "cells": stats["cells"], "burn_cells": stats["burn_cells"], "gaps": stats["gaps"],
                      "persistent": stats["persistent"],
                      "median_km_burn": stats["median_km_burn"]})
        if ver >= 2:
            index[-1]["persistent_why"] = stats["why"]
        if ver >= 3:
            ss = o["station_sources"]
            index[-1]["stations_osm"] = ss["osm"] + ss["both"]
            index[-1]["stations_overture_only"] = ss["overture"]
            index[-1]["stations_both"] = ss["both"]
    idx = {"v": ver, "attribution": ATTRIBUTION if ver < 3 else ATTRIBUTION_V3,
           "licence": LICENCE if ver < 3 else LICENCE_V3, "source": source_note, "snapshot": snapshot,
           "built": time.strftime("%Y-%m-%d"), "objects": n_obj, "merged_within_m": MERGE_M,
           "stations": int((owner >= 0).sum()),
           "stations_dropped": int((owner < 0).sum()), "years": [Y_FROM, Y_TO],
           "gap_rule": {"min_share": GAP_SHARE, "km": GAP_KM},
           "levels": {"fair": f"ratio >= {FAIR} and >= {FAIR_ABS:g} stations per million people",
                      "patchy": f"not fair and not thin",
                      "thin": f"ratio < {THIN}, or < {THIN_ABS:g} stations per million people, or under "
                              f"{MIN_STATIONS} stations with {MIN_STATIONS_POP:,}+ people",
                      "unpopulated": f"population under {UNPOP:,}", "no_data": "no population figure"},
           "countries": index}
    if ver >= 3:
        idx["objects_osm"] = idx.pop("objects")
        idx["sites_osm"] = n_osm_sites
        idx["overture"] = {
            "release": OVERTURE_RELEASE, "theme": "places", "type": "place", "category": OVERTURE_CATEGORY,
            "category_field": "taxonomy.primary", "min_confidence": OVERTURE_MIN_CONF,
            "dropped_status": list(OVERTURE_DROP_STATUS), "same_station_m": SAME_M,
            "same_name_m": SAME_NAME_M, "same_name_rule": "similar names: the distinctive words of one name (generic "
            "fire words and abbreviations aside) all in the other, or one name inside the other, and no different "
            "station numbers", "same_exact_name_m": SAME_EXACT_M,
            "name_filter": "dropped: names that are never a station (extinguisher, sprinkler and equipment firms, "
            "shops, union locals, schools, academies, training grounds, museums, ...); security firms, police, Red "
            "Cross posts and similar unless the name also says fire service; places only business directories "
            f"({', '.join(sorted(OVERTURE_DIRECTORIES))}) list unless the name says fire service; whole-degree "
            f"coordinates; names repeated {OVERTURE_REPEAT}+ times among the Overture-only stations without a fire "
            "word", "directories": sorted(OVERTURE_DIRECTORIES), "repeat_limit": OVERTURE_REPEAT,
            "licence": "CDLA-Permissive-2.0 (Foursquare-sourced places: Apache-2.0)",
            "licence_files": OVERTURE_LICENCE_FILES, **ov_stats}
        idx["source_codes"] = SOURCE_CODES
        idx["levels_note"] = ("Same thresholds as v1 and v2, applied to the merged count (OpenStreetMap plus "
                              "Overture-only stations); peer medians are recomputed from the merged counts.")
    if ver >= 2:
        idx["fire"] = "VIIRS Suomi NPP type 0, confidence n/h, static sources removed (see method)"
        idx["why_codes"] = {str(k): v for k, v in MASK_WHY.items()}
        idx["mask"] = {"static_spot_years": STATIC_SPOT_YEARS, "recur_years": RECUR_YEARS,
                       "recur_months": RECUR_MONTHS, "recur_night": RECUR_NIGHT, "static_share": PERSIST_SHARE,
                       "flare_field_static_years": MASK_STATIC_YEARS, "min_detections": MASK_MIN_N,
                       "seasonal_top6": SEASONAL_TOP6, "big_per_year": BIG_PER_YEAR,
                       "sparse_per_year": SPARSE_PER_YEAR, "static_share_any": STATIC_SHARE,
                       "weak_frp_mw": WEAK_FRP_MW, "night_weak_share": NIGHT_WEAK_SHARE,
                       "night_min_years": NIGHT_MIN_YEARS, "night_min_months": NIGHT_MIN_MONTHS,
                       "night_max_top6": NIGHT_MAX_TOP6, "flare_weak_night": FLARE_WEAK_NIGHT,
                       "night_share": NIGHT_SHARE, "night_share_low": NIGHT_SHARE_LOW,
                       "night_low_max_top6": NIGHT_LOW_MAX_TOP6, "recur_pool_weak": RECUR_POOL_WEAK,
                       "recur_night_only": RECUR_NIGHT_ONLY, "recur_night_months": RECUR_NIGHT_MONTHS,
                       "night_only_share": NIGHT_ONLY_SHARE, "night_only_weak": NIGHT_ONLY_WEAK,
                       "night_only_years": NIGHT_ONLY_YEARS, "night_spread_share": NIGHT_SPREAD_SHARE,
                       "night_spread_months": NIGHT_SPREAD_MONTHS, "flare_long_years": FLARE_LONG_YEARS,
                       "flare_long_ratio": FLARE_LONG_RATIO, "flare_wide_ring": FLARE_WIDE_RING,
                       "flare_wide_ratio": FLARE_WIDE_RATIO, "flare_wide_top6": FLARE_WIDE_TOP6,
                       "flare_wide_max_cell": FLARE_WIDE_MAX_CELL, "gap_often_years": GAP_OFTEN_YEARS}
        idx["countries"] = [dict(r, persistent_why=dict(zip(MASK_WHY.values(), r["persistent_why"])))
                            for r in index]
    if ver >= 3:
        for name_, url in OVERTURE_LICENCE_FILES.items():
            f = args.cache / name_
            if not f.exists():
                f.write_text(page_text(http(url, timeout=60)), "utf-8")
            (args.out / name_).write_bytes(f.read_bytes())
    (args.out / "index.json").write_text(dumps(idx), "utf-8")
    if args.report:
        import csv
        with open(args.report, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(index[0]) + ["population", "income_group", "land_km2",
                                                                   "peer_median_per_million"])
            w.writeheader()
            for r in index:
                c = comp[r["country"]]
                w.writerow(dict(r, population=c["population"], income_group=c["income_group"],
                                land_km2=c["land_km2"], peer_median_per_million=c["peer_median_per_million"]))
    big = sorted(index, key=lambda r: -r["bytes"])[:5]
    print("largest files:", ", ".join(f"{r['country']} {r['bytes'] / 1e6:.2f} MB" for r in big))
    print(f"total {sum(r['bytes'] for r in index) / 1e6:.1f} MB in {len(index)} files; "
          f"gaps {sum(r['gaps'] for r in index):,}")


if __name__ == "__main__":
    main()
