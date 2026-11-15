"""Download 2026 MODIS world detections from the FIRMS area API, one day per request.
Writes <OUT>/<SOURCE>/<YYYY-MM-DD>.csv.gz. Skips files present. Throttles on the key's transaction counter.
Reuses the fetch task's client (reads the key from ~/.firms_map_key, never prints it)."""
import datetime as dt, gzip, os, sys, time
sys.path.insert(0, os.environ["Y2026_FETCH_SCRIPTS"])  # the fetch task's FIRMS client (firms.py)
import firms

OUT = sys.argv[1]
CEIL = int(os.environ.get("CEIL", "3000"))
JOBS = [("MODIS_SP", "2026-01-01", "2026-08-31"), ("MODIS_NRT", "2026-09-01", "2026-11-15")]
if len(sys.argv) > 2:
    JOBS = [tuple(sys.argv[2:5])]

def days(a, b):
    d, e = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    while d <= e:
        yield d.isoformat(); d += dt.timedelta(days=1)

def wait_budget():
    while True:
        s = firms.status()
        cur = int(s.get("current_transactions", 0))
        if cur < CEIL:
            return cur
        print(f"  budget {cur} >= {CEIL}; waiting 60s", flush=True)
        time.sleep(60)

n, cur = 0, 0
for src, a, b in JOBS:
    os.makedirs(f"{OUT}/{src}", exist_ok=True)
    for d in days(a, b):
        path = f"{OUT}/{src}/{d}.csv.gz"
        if os.path.exists(path) and d != "2026-11-15":
            continue
        if n % 5 == 0:
            cur = wait_budget()
        t = time.time()
        body = firms.get(f"/api/area/csv/{{KEY}}/{src}/world/1/{d}")
        if not body.startswith(b"latitude,"):
            print(f"{src} {d}: unexpected response {firms.redact(body[:200].decode(errors='replace'))!r}", flush=True)
            time.sleep(60)
            continue
        tmp = path + ".tmp"
        with gzip.open(tmp, "wb", compresslevel=6) as f:
            f.write(body)
        os.replace(tmp, path)
        n += 1
        print(f"{src} {d}: {body.count(b'\n') - 1} rows, {len(body)/1e6:.1f} MB, {time.time()-t:.1f}s, tx~{cur}", flush=True)
print("DONE", n, "files", flush=True)
