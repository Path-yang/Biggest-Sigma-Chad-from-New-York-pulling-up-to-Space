"""Which satellite each 2026 day of one place (a country or a state) comes from. Shared by build_v3.py (countries)
and scripts/extend_data_2026.py (New York and California), so both kinds of page use one rule.

Each place-day takes one source, never two added together:
  obs     Suomi NPP as observed;
  conv    NOAA-20 times the place's NOAA-20-to-S-NPP rate for the month. Used when S-NPP missed the day (outages,
          and every day after 1 November 2026), and on S-NPP days that are complete for the world but short
          (fewer than 22 UTC hours or ending before 22:30) when this place's overpasses fall in the missing hours,
          or S-NPP saw under 40% of NOAA-20's converted count here;
  interp  both satellites are partial on the day (NOAA-20 under 20 UTC hours on a day S-NPP also missed:
          12 October 2026) and neither covered this place's overpasses: the mean of the nearest usable day
          before and after, in S-NPP terms, with a range from what was seen to the larger neighbour.

A place's coverage on a partial day is 1 minus the share of its detections, on the nearby complete days of the
same satellite, that fall in the UTC hours the satellite lacks that day (an hour is lacking when the world count
in it is under 10% of its mean on the complete days within 3 days). A satellite passes over a place at about
the same UTC hours every day, so this says whether the missing hours are the ones that see the place.
"""
import csv
import datetime as dt
from collections import defaultdict

SHORT_HOURS, SHORT_LAST = 22, 2230
BOTH_SHORT_HOURS = 20
GAP_HOUR, NEAR, MIN_COVER, MIN_EVIDENCE, SHORT_SHARE, MIN_DAY = 0.1, 3, 0.75, 20, 0.4, 20
WHY = {"missing": "S-NPP missing", "low": "S-NPP low (partial day)", "partial_day": "S-NPP partial day",
       "low_vs_other_sensor": "S-NPP low against NOAA-20", None: "S-NPP stopped"}
SENSOR_FILES = (("V", "viirs-snpp"), ("N", "viirs-noaa20"))


class Days:
    def __init__(self, raw, first, last, con):
        self.status, self.hours, self.last_t = {"viirs-snpp": {}, "viirs-noaa20": {}}, {}, {}
        for r in csv.DictReader(open(f"{raw}/coverage_days.csv")):
            d = dt.date.fromisoformat(r["date"])
            self.status[r["sensor"]][d] = r["status"]
            self.hours[(r["sensor"], d)] = int(r["utc_hours_with_data"] or 0)
            self.last_t[(r["sensor"], d)] = int(r["last_acq_time"] or 0)
        self.days = [first + dt.timedelta(k) for k in range((last - first).days + 1)]
        bad = [d for d in self.days if self.status["viirs-noaa20"].get(d) != "ok"]
        if bad:
            raise SystemExit(f"NOAA-20 not complete on {bad}: these days would have no source")
        st = self.status["viirs-snpp"]
        self.snpp_ok = {d for d in self.days if st.get(d) == "ok"}
        self.snpp_short = {d for d in self.snpp_ok
                           if self.hours[("viirs-snpp", d)] < SHORT_HOURS or self.last_t[("viirs-snpp", d)] < SHORT_LAST}
        self.both_short = sorted(d for d in self.days
                                 if d not in self.snpp_ok and self.hours[("viirs-noaa20", d)] < BOTH_SHORT_HOURS)
        self.check = sorted(self.snpp_short | set(self.both_short))
        self.window = sorted({d + dt.timedelta(k) for d in self.check for k in range(-NEAR, NEAR + 1)})
        # world detections per sensor, day and UTC hour, on the days around the partial ones
        self.world = defaultdict(int)
        for s, f in SENSOR_FILES:
            q = con.execute(f"""SELECT acq_date, CAST(substr(acq_time, 1, 2) AS INTEGER) h, count(*) n
                FROM read_parquet('{raw}/{f}_2026.parquet') WHERE acq_date IN ({self.window_sql()}) GROUP BY ALL""").fetchall()
            for d, h, n in q:
                self.world[(s, d, h)] += n
        self.miss = {(s, d): self._missing(s, d) for s, _ in SENSOR_FILES for d in self.check}

    def window_sql(self):
        return ",".join(f"DATE '{d}'" for d in self.window) or "NULL"

    def snpp_status(self, d):
        return self.status["viirs-snpp"].get(d)

    def complete(self, s, d):
        st = self.status["viirs-snpp" if s == "V" else "viirs-noaa20"].get(d)
        return st == "ok" and d not in self.snpp_short and d not in self.both_short

    def _missing(self, s, d):
        ref = [x for x in (d + dt.timedelta(k) for k in range(-NEAR, NEAR + 1)) if x != d and self.complete(s, x)]
        hrs = {h for h in range(24)
               if self.world[(s, d, h)] < GAP_HOUR * sum(self.world[(s, x, h)] for x in ref) / max(len(ref), 1)}
        return hrs, ref

    def cover(self, s, hourly, d):
        """hourly: (sensor, day, hour) -> the place's detections. None when the place has too few to tell."""
        miss, ref = self.miss[(s, d)]
        tot = sum(hourly.get((s, x, h), 0) for x in ref for h in range(24))
        if tot < MIN_EVIDENCE:
            return None
        return 1 - sum(hourly.get((s, x, h), 0) for x in ref for h in miss) / tot

    def classify(self, daily, hourly, r):
        """daily: day -> (S-NPP, NOAA-20) detections; hourly as in cover(); r: 12 monthly NOAA-20 -> S-NPP rates.
        Returns cls {day: obs|conv|interp}, why {day: reason}, src {day: [(day, weight)]}, rng {day: (lo, value, hi)}."""
        cls, why, src, rng = {}, {}, {}, {}
        for d in self.days:
            s, n = daily.get(d, (0, 0))
            nc = n * r[d.month - 1]
            if d in self.snpp_ok:
                k = "obs"
                if d in self.snpp_short:
                    cv, cn = self.cover("V", hourly, d), self.cover("N", hourly, d)
                    if cv is not None and cv < MIN_COVER and (cn is None or cn >= MIN_COVER):
                        k, why[d] = "conv", "S-NPP missed this place's overpasses that day"
                    elif nc >= MIN_DAY and s < SHORT_SHARE * nc:  # e.g. part of a swath missing within an hour
                        k, why[d] = "conv", "S-NPP saw under 40% of NOAA-20's count here on a partial day"
            else:
                k, why[d] = "conv", WHY.get(self.snpp_status(d), self.snpp_status(d))
                if d in self.both_short:
                    cv = self.cover("V", hourly, d) if self.snpp_status(d) is not None else 0.0
                    cn = self.cover("N", hourly, d)
                    if cv is not None and cn is not None and max(cv, cn) < MIN_COVER:
                        k, why[d] = "interp", "both satellites missed this place's overpasses that day"
                    elif cv is not None and (cn is None or cv > cn):
                        k, why[d] = "obs", "NOAA-20 partial; S-NPP covered this place better that day"
            cls[d] = k

        def value(d):
            s, n = daily.get(d, (0, 0))
            return s if cls[d] == "obs" else n * r[d.month - 1]

        for d in self.both_short:
            if cls[d] != "interp":
                continue
            sd = [x for x in self.days if x < d and x not in self.both_short][-1:] + \
                 [x for x in self.days if x > d and x not in self.both_short][:1]
            s, n = daily.get(d, (0, 0))
            seen = max(s if self.snpp_status(d) is not None else 0, n * r[d.month - 1])
            e = sum(value(x) for x in sd) / len(sd)
            rng[d] = (min(seen, e), e, max([e] + [value(x) for x in sd]))
            src[d] = [(x, 1 / len(sd)) for x in sd]
        return cls, why, src, rng
