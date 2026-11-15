#!/usr/bin/env python3
"""Merge downloaded FIRMS pieces into one CSV per sensor.

Usage: merge_firms.py SENSOR [SENSOR ...]     (modis, viirs_snpp, viirs_noaa20, viirs_noaa21)

Sources, in date order:
  data/zips/<prefix>_<year>_all_countries.zip   yearly bulk files (per-country CSVs)
  data/archive/DL_FIRE_<code>_<id>.zip          FIRMS archive requests (world)
Archive rows are kept only for dates after the last bulk date, so nothing is double-counted.
Output: data/<sensor>.csv plus a line of stats.

Column notes:
  - Archive VIIRS files call the two brightness columns brightness/bright_t31; the bulk files
    call them bright_ti4/bright_ti5. Output uses the bulk names.
  - Near-real-time archive files have no `type` column; it is left blank for those rows.
  - acq_time is zero-padded to 4 digits (HHMM) everywhere.
"""
import io
import sys
import zipfile
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

MODIS_COLS = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type"
VIIRS_COLS = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type"
VIIRS_ALIASES = {"bright_ti4": "brightness", "bright_ti5": "bright_t31"}

SENSORS = {
    "modis": dict(cols=MODIS_COLS, aliases={}, bulk="modis", years=range(2000, 2026), code="M-C61"),
    "viirs_snpp": dict(cols=VIIRS_COLS, aliases=VIIRS_ALIASES, bulk="viirs-snpp", years=range(2012, 2026), code="SV-C2"),
    "viirs_noaa20": dict(cols=VIIRS_COLS, aliases=VIIRS_ALIASES, bulk="viirs-jpss1", years=range(2018, 2026), code="J1V-C2"),
    "viirs_noaa21": dict(cols=VIIRS_COLS, aliases=VIIRS_ALIASES, bulk=None, years=(), code="J2V-C2"),
}


class Stats:
    def __init__(self):
        self.rows, self.lo, self.hi = 0, None, None

    def add(self, n, a, b):
        self.rows += n
        if n and a:
            self.lo = a if self.lo is None or a < self.lo else self.lo
            self.hi = b if self.hi is None or b > self.hi else self.hi


def remap_stream(src, out, cols, aliases, after_date):
    """Copy one CSV (binary file object) to out in target column order.
    Keeps only acq_date > after_date. Returns (rows, min_date, max_date)."""
    text = io.TextIOWrapper(src, encoding="utf-8", newline="")
    header = text.readline().strip().split(",")
    idx = []
    for c in cols:
        if c in header:
            idx.append(header.index(c))
        elif aliases.get(c) in header:
            idx.append(header.index(aliases[c]))
        else:
            idx.append(-1)
    di, ti = cols.index("acq_date"), cols.index("acq_time")
    n, lo, hi, buf = 0, None, None, []
    for line in text:
        f = line.rstrip("\r\n").split(",")
        if len(f) < 2:
            continue
        row = [f[i] if i >= 0 else "" for i in idx]
        d = row[di]
        if after_date and d <= after_date:
            continue
        row[ti] = row[ti].replace(":", "").zfill(4)
        if lo is None or d < lo:
            lo = d
        if hi is None or d > hi:
            hi = d
        buf.append(",".join(row))
        n += 1
        if len(buf) >= 200_000:
            out.write(("\n".join(buf) + "\n").encode())
            buf = []
    if buf:
        out.write(("\n".join(buf) + "\n").encode())
    return n, lo, hi


def first_date(z, name):
    with z.open(name) as f:
        header = f.readline().decode().strip().split(",")
        row = f.readline().decode().strip().split(",")
    return row[header.index("acq_date")] if len(row) > 1 else None


def merge(sensor):
    cfg = SENSORS[sensor]
    cols = cfg["cols"].split(",")
    header = (cfg["cols"] + "\n").encode()
    out_path = DATA / f"{sensor}.csv"
    st = Stats()

    with open(out_path, "wb") as out:
        out.write(header)
        years = list(cfg["years"])
        for year in years:
            z = zipfile.ZipFile(DATA / "zips" / f"{cfg['bulk']}_{year}_all_countries.zip")
            for name in sorted(n for n in z.namelist() if n.endswith(".csv")):
                with z.open(name) as f:
                    first = f.readline()
                    if first.replace(b"\r", b"") == header and year != years[-1]:
                        # same layout: copy bytes straight through
                        body = f.read()
                        if body and not body.endswith(b"\n"):
                            body += b"\n"
                        out.write(body)
                        st.add(body.count(b"\n"), f"{year}-01-01", f"{year}-12-31")
                        continue
                with z.open(name) as f:  # other layout, or last year (need its real max date)
                    st.add(*remap_stream(f, out, cols, cfg["aliases"], None))
            print(f"  {sensor} bulk {year}: {st.rows:,} rows so far", flush=True)

        bulk_max = st.hi
        pieces = []
        for p in DATA.glob(f"archive/DL_FIRE_{cfg['code']}_*.zip"):
            z = zipfile.ZipFile(p)
            for name in z.namelist():
                if name.endswith(".csv"):
                    d = first_date(z, name)
                    if d:
                        pieces.append((d, p, name))
        for d, p, name in sorted(pieces):
            with zipfile.ZipFile(p).open(name) as f:
                n, a, b = remap_stream(f, out, cols, cfg["aliases"], bulk_max)
            st.add(n, a, b)
            print(f"  {sensor} archive {name}: {n:,} rows {a}..{b}", flush=True)

    size = out_path.stat().st_size / 1e9
    print(f"RESULT {sensor}: {st.rows:,} rows, {st.lo}..{st.hi}, bulk ends {bulk_max}, {size:.2f} GB -> {out_path.name}", flush=True)


if __name__ == "__main__":
    for s in sys.argv[1:]:
        merge(s)
