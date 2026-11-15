#!/usr/bin/env python3
"""Download FIRMS hotspots for the whole world through the Area API.

Usage: fetch_firms_api.py SOURCE START END
  e.g. fetch_firms_api.py MODIS_SP 2000-11-01 2011-12-31

Writes one CSV per 5-day chunk to data/raw/SOURCE/START_DATE.csv.
Resumable: chunks already on disk are skipped.
Reads FIRMS_MAP_KEY from .env in the repo root.
"""
import json
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://firms.modaps.eosdis.nasa.gov"
CHUNK_DAYS = 5          # API maximum
LIMIT = 5000            # transactions per 10 minutes
COST = 200              # a 5-day world request costs about 180


def load_key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("FIRMS_MAP_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("FIRMS_MAP_KEY missing from .env")


def get(url, timeout=300):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def wait_for_quota(key):
    while True:
        try:
            used = json.loads(get(f"{BASE}/mapserver/mapkey_status/?MAP_KEY={key}", 60))
            if int(used["current_transactions"]) + COST <= LIMIT:
                return
        except Exception as e:  # status endpoint hiccup: back off and retry
            print(f"  status check failed: {e}", flush=True)
        time.sleep(20)


def main():
    source, start, end = sys.argv[1], date.fromisoformat(sys.argv[2]), date.fromisoformat(sys.argv[3])
    key = load_key()
    out = ROOT / "data" / "raw" / source
    out.mkdir(parents=True, exist_ok=True)

    d = start
    while d <= end:
        days = min(CHUNK_DAYS, (end - d).days + 1)
        target = out / f"{d.isoformat()}.csv"
        if not target.exists():
            url = f"{BASE}/api/area/csv/{key}/{source}/world/{days}/{d.isoformat()}"
            for attempt in range(1, 9):
                wait_for_quota(key)
                try:
                    body = get(url)
                    if body.startswith(b"latitude,"):
                        tmp = target.with_suffix(".part")
                        tmp.write_bytes(body)
                        tmp.rename(target)
                        print(f"{source} {d} +{days}d  {body.count(10) - 1} rows", flush=True)
                        break
                    print(f"  {d} unexpected reply: {body[:120]!r}", flush=True)
                except Exception as e:
                    print(f"  {d} attempt {attempt} failed: {e}", flush=True)
                time.sleep(30 * attempt)
            else:
                print(f"GAVE UP on {source} {d}", flush=True)
        d += timedelta(days=days)
    print(f"DONE {source} {start}..{end}", flush=True)


if __name__ == "__main__":
    main()
