"use strict";
(() => {
  // src/data.ts
  var D = window.BURN_DATA;
  var Y0 = D.meta.y0;
  var Y1 = D.meta.y1;
  var NYR = Y1 - Y0 + 1;
  var NM = NYR * 12;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONL = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  var STS = ["NY", "CA"];
  var NAME = { NY: "New York", CA: "California" };
  var SLUG = { NY: "new-york", CA: "california" };
  var LAND_KM2 = { NY: 122057, CA: 403466 };
  var STC = { NY: "#6fa8ff", CA: "#ff8a3d" };
  var LAST_I = D.meta.last_i ?? NM - 1;
  var NMD = LAST_I + 1;
  var PART = D.meta.partial ? { i: D.meta.partial.i, y: D.meta.partial.y, m: D.meta.partial.m - 1, day: D.meta.partial.day_to, days: D.meta.partial.days_in_month } : null;
  var FULL_I = PART ? PART.i - 1 : LAST_I;
  var FULL_Y1 = Y0 + Math.floor((FULL_I + 1) / 12) - 1;
  var LAST_DATE = D.meta.last_date ?? `${Y1}-12-31`;
  var lastDay = LAST_DATE.split("-").map(Number);
  var LAST_WORDS = `${lastDay[2]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][lastDay[1] - 1]} ${lastDay[0]}`;
  var FOCUS0 = [Y0 + Math.floor(FULL_I / 12), FULL_I % 12];
  var span = (a, b) => b > FULL_Y1 ? a === b ? `${b} to ${LAST_WORDS.replace(/ \d+$/, "")}` : `${a}\u2013${LAST_WORDS}` : a === b ? String(a) : `${a}\u2013${b}`;
  var isPartYear = (y) => y > FULL_Y1;
  var SAT_RULE = "Suomi NPP only from 2012; NOAA-20 is not added (that would count the same fires twice). It stands in, converted to Suomi NPP terms, only on days Suomi NPP missed: every day from 2 November 2026, when Suomi NPP stopped, its outage days in March to October 2026 and in 2018\u20132025, and 2026 days on which its partial data missed this place's overpasses. On 12 October 2026 both satellites missed many places; there the day is the mean of the days either side.";
  var FILL_SRC = "VIIRS Suomi NPP + NOAA-20 on days Suomi NPP missed, converted";
  var dayRun = (days, m) => (days.length > 1 && days[days.length - 1] - days[0] === days.length - 1 ? `${days[0]}\u2013${days[days.length - 1]}` : days.join(", ")) + ` ${MON[m]}`;
  function fillDays(i, st) {
    const s2 = D.states[st], y = Y0 + Math.floor(i / 12), pre = `${y}-${String(i % 12 + 1).padStart(2, "0")}-`, pick2 = (a) => (a ?? []).filter((d) => d.startsWith(pre)).map((d) => +d.slice(8));
    if (y >= 2026)
      return { n20: pick2(s2.y2026?.n20_dates ?? D.meta.viirs_2026?.n20_dates), interp: pick2(s2.y2026?.interp_dates) };
    const g = s2.hist_gaps?.find((x) => x.i === i);
    return { n20: g ? g.days : [], interp: [] };
  }
  function n20Days(i, st) {
    const d = fillDays(i, st).n20;
    return d.length ? `${d.length} ${d.length === 1 ? "day" : "days"} (${dayRun(d, i % 12)})` : "";
  }
  function fillNote(i, st) {
    const f = fillDays(i, st), a = n20Days(i, st), past = Y0 + Math.floor(i / 12) < 2026;
    return [
      a && `${a} from NOAA-20 converted to Suomi NPP terms${past ? " (Suomi NPP outage)" : ""}`,
      f.interp.length ? `${dayRun(f.interp, i % 12)} estimated from the days either side (both satellites missed this area)` : ""
    ].filter(Boolean).join("; ");
  }
  var VI0 = (D.meta.viirs_from[0] - Y0) * 12 + D.meta.viirs_from[1] - 1;
  var AQ0 = (D.meta.aqua_from[0] - Y0) * 12 + D.meta.aqua_from[1] - 1;
  var PRESET = {
    NY: { name: "Try the Jennings Creek fire area, November 2024", lat: 41.2, lon: -74.35, rad: 20, focus: [2024, 10] },
    CA: { name: "Try Paradise and the Camp Fire, November 2018", lat: 39.76, lon: -121.62, rad: 25, focus: [2018, 10] }
  };
  var NBR = {
    NY: [
      ["Pennsylvania", 41.45, -77.3],
      ["Vermont", 44, -72.75],
      ["Massachusetts", 42.35, -72.55],
      ["Connecticut", 41.55, -72.75],
      ["New Jersey", 40.85, -74.85],
      ["Ontario", 44.8, -76.7],
      ["Quebec", 45.5, -73.9],
      ["Lake Ontario", 43.62, -77.6],
      ["Atlantic Ocean", 40.5, -72]
    ],
    CA: [
      ["Oregon", 42.45, -118.3],
      ["Nevada", 39.3, -117.3],
      ["Arizona", 34.3, -113.5],
      ["Mexico", 32.3, -115.6],
      ["Pacific Ocean", 35.4, -124.3]
    ]
  };

  // src/state.ts
  var S = {
    st: null,
    sel: { type: "state" },
    yFrom: Y0,
    yTo: Y1,
    focus: FOCUS0.slice(),
    mode: "count",
    pal: "fire",
    stn: true,
    show: { t: "all" },
    draw: false,
    sheet: null,
    layer: "count",
    rm: (/* @__PURE__ */ new Date()).getMonth(),
    odds: "past",
    fire: "any"
  };
  var RT = { tool: null, pin: null, gapMin: 0.25, planN: 5, planT: 15, focusStn: -1 };

  // src/util.ts
  var $ = ((id) => document.getElementById(id));
  var fmt = (v) => v >= 100 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? String(Math.round(v)) : v === 0 ? "0" : String(Math.round(v * 10) / 10);
  var short = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e4 ? Math.round(v / 1e3) + "k" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1).replace(".0", "") + "k" : Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  var times = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1)) + "\xD7";
  var css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  // src/world.ts
  var WORLD = window.WORLD ? window.WORLD.countries : [];
  var BY_KEY = new Map(WORLD.map((c) => [c.k, c]));
  var slugOf = (k) => k.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  var shapeOf = (k) => BY_KEY.get(k);
  var nameOf = (k) => BY_KEY.get(k)?.n ?? k.replace(/_/g, " ");
  function theName(name) {
    return /^(United|Republic|Democratic|Dominican|Central African|Czech|Federated|Russian|Holy)|Islands$|^(Netherlands|Philippines|Bahamas|Gambia|Maldives|Comoros|Seychelles|Gaza Strip|West Bank)$/.test(
      name
    ) ? "the " + name : name;
  }
  function inRing(r, lon, lat) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > lat !== yj > lat && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  var boxArea = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  function countryAt(lon, lat) {
    let best = null;
    for (const c of WORLD) {
      const b = c.b;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (best && boxArea(b) >= boxArea(best.b)) continue;
      if (c.r.some((r) => inRing(r, lon, lat))) best = c;
    }
    return best;
  }
  var cutEdge = (k, a0, b0, a1, b1) => a0 === a1 && (Math.abs(a0) === 180 || k === "Antarctica" && a0 % 60 === 0) || b0 < -89.9 && b1 < -89.9;
  var near = (lon, lon02) => lon - 360 * Math.round((lon - lon02) / 360);
  function lonSpan(c) {
    let a = Infinity, z = -Infinity;
    for (const r of c.r) {
      const off = near(r[0], c.c[0]) - r[0];
      for (let i = 0; i < r.length; i += 2) {
        const lon = r[i] + off;
        if (lon < a) a = lon;
        if (lon > z) z = lon;
      }
    }
    return Math.min(360, z - a);
  }

  // src/model.ts
  var STATE_EPOCHS = { vi0: VI0, aq0: AQ0, bins: D.meta.bins };
  function harmWith(s2, e, i, T, A2, V5) {
    const m = i % 12;
    if (i >= e.vi0) return { h: V5, lo: V5, hi: V5, src: "VIIRS observed" };
    const terraOnly = i < e.aq0, h2 = terraOnly ? T * s2.r_t[m] : (T + A2) * s2.r_ta[m], src = terraOnly ? "MODIS Terra, converted" : "MODIS Terra+Aqua, converted";
    if (h2 === 0) return { h: 0, lo: 0, hi: s2.zero_hi, src };
    let b = 0;
    while (b < e.bins.length && h2 > e.bins[b]) b++;
    return { h: h2, lo: h2 * s2.pi[b][0], hi: h2 * s2.pi[b][1], src };
  }
  var harm = (st, i, T, A2, V5) => harmWith(D.states[st], STATE_EPOCHS, i, T, A2, V5);
  var HX = {};
  function hexState(st) {
    if (HX[st]) return HX[st];
    const s2 = D.states[st], n = s2.hexes.length / 3, R = s2.hex_r, K = s2.hex_k, S3 = Math.sqrt(3);
    const o = {
      n,
      R,
      K,
      q: new Int32Array(n),
      r: new Int32Array(n),
      c: new Int32Array(n),
      X: new Float64Array(n),
      Y: new Float64Array(n),
      H: new Float32Array(n * NM),
      key: /* @__PURE__ */ new Map()
    };
    for (let k = 0; k < n; k++) {
      const q = s2.hexes[3 * k], r = s2.hexes[3 * k + 1];
      o.q[k] = q;
      o.r[k] = r;
      o.c[k] = s2.hexes[3 * k + 2];
      o.X[k] = R * S3 * (q + r / 2);
      o.Y[k] = R * 1.5 * r;
      o.key.set(q + "," + r, k);
    }
    const rows = s2.hex_rows;
    for (let p = 0; p < rows.length; p += 5) o.H[rows[p] * NM + rows[p + 1]] = harm(st, rows[p + 1], rows[p + 2], rows[p + 3], rows[p + 4]).h;
    const g = s2.gap_hex_rows ?? [];
    for (let p = 0; p < g.length; p += 3) o.H[g[p] * NM + g[p + 1]] = Math.max(0, o.H[g[p] * NM + g[p + 1]] + g[p + 2]);
    o.x0 = Math.min(...o.X) - R;
    o.x1 = Math.max(...o.X) + R;
    o.y0 = Math.min(...o.Y) - R;
    o.y1 = Math.max(...o.Y) + R;
    o.geo = D.geo[st];
    o.geoByFips = {};
    o.geo.forEach((g2) => o.geoByFips[g2.f] = g2);
    const dt = D.detail[st], cn = dt.ctx.length / 3;
    o.cn = cn;
    o.cX = new Float32Array(cn);
    o.cY = new Float32Array(cn);
    o.cB = new Uint8Array(cn);
    for (let j = 0; j < cn; j++) {
      const q = dt.ctx[3 * j], r = dt.ctx[3 * j + 1];
      o.cX[j] = R * S3 * (q + r / 2);
      o.cY[j] = R * 1.5 * r;
      o.cB[j] = dt.ctx[3 * j + 2];
    }
    const fr = dt.fine_r, fn = dt.fine.length / 5, f = o.f = {
      R: fr,
      n: fn,
      X: new Float32Array(fn),
      Y: new Float32Array(fn),
      c: new Uint32Array(fn),
      ym: new Uint16Array(fn),
      mm: new Uint16Array(fn),
      key: /* @__PURE__ */ new Map(),
      max: 1
    };
    for (let j = 0; j < fn; j++) {
      const q = dt.fine[5 * j], r = dt.fine[5 * j + 1];
      f.X[j] = fr * S3 * (q + r / 2);
      f.Y[j] = fr * 1.5 * r;
      f.c[j] = dt.fine[5 * j + 2];
      f.ym[j] = dt.fine[5 * j + 3];
      f.mm[j] = dt.fine[5 * j + 4];
      f.key.set(q + "," + r, j);
      if (f.c[j] > f.max) f.max = f.c[j];
    }
    o.roads = dt.roads;
    const pl = D.places[st];
    o.towns = pl.towns.map((t) => ({ n: t[0], lat: t[1], lon: t[2], pop: t[3], X: t[2] * K, Y: t[1] }));
    const sn = pl.stn.length, stn = o.stn = {
      n: sn,
      X: new Float32Array(sn),
      Y: new Float32Array(sn),
      c: new Int16Array(sn),
      cp: new Int16Array(sn),
      names: pl.stn
    };
    for (let i = 0; i < sn; i++) {
      stn.X[i] = pl.stn_xy[2 * i] * K;
      stn.Y[i] = pl.stn_xy[2 * i + 1];
      const k = o.key.get(hexKey(stn.X[i], stn.Y[i], R));
      stn.c[i] = k === void 0 ? -1 : o.c[k];
    }
    stn.cp.set(countiesAt(st, o.geo, pl.stn_xy, stn.c));
    return HX[st] = o;
  }
  function countiesAt(st, geo, lonLat, fallback) {
    const ciOf = new Map(D.states[st].counties.map((c, ci) => [c.fips, ci])), shapes = geo.map((g) => {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const r of g.r)
        for (let i = 0; i < r.length; i += 2) {
          b[0] = Math.min(b[0], r[i]);
          b[1] = Math.min(b[1], r[i + 1]);
          b[2] = Math.max(b[2], r[i]);
          b[3] = Math.max(b[3], r[i + 1]);
        }
      return { ci: ciOf.get(g.f) ?? -1, r: g.r, b };
    }), out = new Int16Array(fallback.length);
    for (let i = 0; i < out.length; i++) {
      const lon = lonLat[2 * i], lat = lonLat[2 * i + 1];
      const hit = shapes.find(
        ({ ci, r, b }) => ci >= 0 && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && r.reduce((ins, ring2) => ins !== inRing(ring2, lon, lat), false)
      );
      out[i] = hit ? hit.ci : fallback[i];
    }
    return out;
  }
  function maskFor(st, sel) {
    const hx = hexState(st), m = new Uint8Array(hx.n);
    for (let k = 0; k < hx.n; k++) {
      const lon = hx.X[k] / hx.K, lat = hx.Y[k];
      if (sel.type === "state") m[k] = 1;
      else if (sel.type === "county") m[k] = hx.c[k] === sel.ci ? 1 : 0;
      else if (sel.type === "hex") m[k] = k === sel.k ? 1 : 0;
      else if (sel.type === "box") m[k] = lon >= sel.w && lon <= sel.e && lat >= sel.s && lat <= sel.n ? 1 : 0;
      else {
        const dx = (lon - sel.lon) * 111.32 * Math.cos(sel.lat * Math.PI / 180), dy = (lat - sel.lat) * 110.57;
        m[k] = dx * dx + dy * dy <= sel.rad * sel.rad ? 1 : 0;
      }
    }
    return m;
  }
  var selMask = () => maskFor(S.st, S.sel);
  function analyseFor(st, sel) {
    const s2 = D.states[st], T = new Float64Array(NM), A2 = new Float64Array(NM), V5 = new Float64Array(NM);
    const byCounty = sel.type === "state" || sel.type === "county", rows = byCounty ? s2.county_rows : s2.hex_rows, mask = byCounty ? null : maskFor(st, sel);
    for (let p = 0; p < rows.length; p += 5) {
      const k = rows[p];
      if (byCounty ? sel.type === "state" || k === sel.ci : mask[k]) {
        const i = rows[p + 1];
        T[i] += rows[p + 2];
        A2[i] += rows[p + 3];
        V5[i] += rows[p + 4];
      }
    }
    const G3 = new Float64Array(NM), grows = (byCounty ? s2.gap_county_rows : s2.gap_hex_rows) ?? [];
    for (let p = 0; p < grows.length; p += 3) {
      const k = grows[p];
      if (byCounty ? sel.type === "state" || k === sel.ci : mask[k]) G3[grows[p + 1]] += grows[p + 2];
    }
    const gaps = new Map((s2.hist_gaps ?? []).map((g) => [g.i, g])), m26 = new Map((s2.y2026?.months ?? []).map((m) => [m.i, m]));
    const filled = (i, t, a, v) => {
      const x = harm(st, i, t, a, v);
      if (i < VI0) return x;
      const f = fillDays(i, st);
      if (!f.n20.length && !f.interp.length) return x;
      const h2 = Math.max(0, v + G3[i]);
      let lo = h2, hi = h2;
      const g = gaps.get(i), m = m26.get(i);
      if (sel.type === "state" && g) {
        lo = h2 - (g.filled - g.lo);
        hi = h2 + (g.hi - g.filled);
      } else if (sel.type === "state" && m) {
        lo = Math.min(h2, m.lo);
        hi = Math.max(h2, m.hi);
      }
      return { h: h2, lo, hi, src: FILL_SRC };
    };
    const R = analyseSeries({
      T,
      A: A2,
      V: V5,
      y0: Y0,
      yFrom: S.yFrom,
      yTo: S.yTo,
      vi0: VI0,
      nm: NMD,
      partI: PART ? PART.i : -1,
      partMed: sameDaysFor(st, sel)?.med ?? null,
      harm: filled
    });
    return { st, ...R };
  }
  var partSpan = (m, day) => `1\u2013${day} ${MON[m]}`;
  var median = (a) => {
    const z = a.slice().sort((x, y) => x - y), h2 = (z.length - 1) / 2;
    return z.length ? (z[Math.floor(h2)] + z[Math.ceil(h2)]) / 2 : 0;
  };
  function sameDaysFor(st, sel) {
    const p = D.states[st].partial;
    if (!p || !PART || sel.type !== "state" && sel.type !== "county") return null;
    const span3 = partSpan(p.m - 1, p.day_to);
    if (sel.type === "state") {
      const past2 = p.state_filled ?? p.state;
      return { span: span3, cur: p.state_2026, lo: p.state_2026_lo, hi: p.state_2026_hi, years: p.years, past: past2, med: p.state_filled_median ?? median(past2) };
    }
    const past = p.county_filled?.[sel.ci] ?? p.county[sel.ci], cur2 = p.county_2026[sel.ci];
    return past ? { span: span3, cur: cur2, lo: cur2, hi: cur2, years: p.years, past, med: median(past) } : null;
  }
  function yearToDate(R, pastPart, range) {
    const pr = R.ser.find((r) => r.part);
    if (!pr) return null;
    const withPart = !!pastPart, py = pr.y, pm2 = pr.m, years = [], past = [];
    const sumOf = (y) => {
      let a = 0;
      for (const r of R.ser) if (r.y === y && r.m < pm2) a += r.h;
      return a;
    };
    for (const yr of R.years) {
      if (yr.y >= py || yr.y < 2012) continue;
      const extra = withPart ? pastPart(yr.y) : 0;
      if (extra === void 0) continue;
      years.push(yr.y);
      past.push(sumOf(yr.y) + extra);
    }
    if (years.length < 3) return null;
    const cur2 = sumOf(py) + (withPart ? pr.h : 0), day = PART ? PART.day : 0, span3 = withPart ? `1 Jan\u2013${day} ${MON[pm2]}` : pm2 > 1 ? `Jan\u2013${MON[pm2 - 1]}` : "January";
    return {
      span: span3,
      withPart,
      y: py,
      cur: cur2,
      lo: range ? range.lo : cur2,
      hi: range ? range.hi : cur2,
      years,
      past,
      med: median(past),
      rank: past.filter((v) => v > cur2).length + 1,
      n: past.length + 1
    };
  }
  function ytdFor(R, st, sel) {
    const s2 = D.states[st], p = s2.partial, sd = sameDaysFor(st, sel);
    if (!p || !sd) return yearToDate(R, null);
    let range = null;
    if (sel.type === "state" && s2.y2026) {
      const ms = s2.y2026.months;
      range = { lo: ms.reduce((a, x) => a + x.lo, 0), hi: ms.reduce((a, x) => a + x.hi, 0) };
    }
    return yearToDate(
      R,
      (y) => {
        const k = sd.years.indexOf(y);
        return k < 0 ? void 0 : sd.past[k];
      },
      range
    );
  }
  function rankWords(rank, n) {
    const ord = (k) => k + (k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th");
    return rank === 1 ? `the most of ${n} years` : rank === n ? `the fewest of ${n} years` : `the ${ord(rank)} most of ${n} years`;
  }
  var ytdSentence = (t) => `${t.y} so far (${t.span}): ${fmt(t.cur)} ${fmt(t.cur) === "1" ? "hotspot" : "hotspots"}${t.hi - t.lo >= 1 ? `, likely ${fmt(t.lo)} to ${fmt(t.hi)}` : ""}, ${rankWords(t.rank, t.n)} for the same dates (typical ${fmt(t.med)}).`;
  function analyseSeries(o) {
    const { T, A: A2, V: V5 } = o, partI = o.partI ?? -1, nm = o.nm ?? Infinity, fullEnd = partI >= 0 ? partI : nm;
    const ser = [];
    for (let i = (o.yFrom - o.y0) * 12, end = Math.min((o.yTo - o.y0 + 1) * 12, nm); i < end; i++) {
      const r = Object.assign(
        { i, y: o.y0 + Math.floor(i / 12), m: i % 12, T: T[i], A: A2[i], V: V5[i] },
        o.harm(i, T[i], A2[i], V5[i])
      );
      if (i >= fullEnd) r.part = true;
      ser.push(r);
    }
    const fullYear = (y) => (y - o.y0 + 1) * 12 <= fullEnd, useAll = !ser.some((r) => fullYear(r.y)), counted = (y) => useAll || fullYear(y);
    const quant = (a, q) => {
      const z = a.slice().sort((x, y) => x - y), p = (z.length - 1) * q, f = Math.floor(p);
      return z[f] + (z[Math.min(z.length - 1, f + 1)] - z[f]) * (p - f);
    };
    const stats2 = MON.map((_, m) => {
      const a = ser.filter((r) => r.m === m && !r.part).map((r) => r.h), s2 = ser.filter((r) => r.m === m && counted(r.y)).reduce((x, r) => x + r.h, 0);
      return a.length ? { med: quant(a, 0.5), q1: quant(a, 0.25), q3: quant(a, 0.75), sum: s2 } : { med: NaN, q1: NaN, q3: NaN, sum: s2 };
    });
    ser.forEach((r) => {
      r.med = r.part ? o.partMed ?? NaN : stats2[r.m].med;
      r.ratio = Number.isFinite(r.med) ? (r.h + 1) / (r.med + 1) : NaN;
    });
    const years = [];
    for (let y = o.yFrom; y <= o.yTo; y++) {
      const rr = ser.filter((r) => r.y === y), sum2 = (k) => rr.reduce((a, r) => a + r[k], 0);
      if (!rr.length) continue;
      const row2 = {
        y,
        h: sum2("h"),
        lo: sum2("lo"),
        hi: sum2("hi"),
        naive: rr.reduce((a, r) => a + (r.i >= o.vi0 ? r.V : r.T + r.A), 0)
      };
      if (!fullYear(y)) row2.part = true;
      years.push(row2);
    }
    const counts = years.filter((y) => counted(y.y)), total2 = stats2.reduce((a, z) => a + z.sum, 0), order = stats2.map((z, m) => ({ m, sum: z.sum })).sort((a, b) => b.sum - a.sum), ranked = counts.slice().sort((a, b) => b.h - a.h);
    return {
      ser,
      stats: stats2,
      years,
      total: total2,
      any: ser.reduce((a, r) => a + r.h, 0),
      mean: counts.length ? total2 / counts.length : 0,
      order,
      ranked,
      partYear: years.find((y) => y.part) ?? null
    };
  }
  function verdict(R, focus = S.focus, sd = null) {
    const [fy, fm] = focus, f = R.ser.find((r) => r.y === fy && r.m === fm);
    if (!f) return null;
    if (f.part && !sd) return { f, fm, fy, label: "Not over yet", cls: "", rank: 0, n: 0, med: NaN, mult: "", noSame: true };
    const cur2 = f.part ? sd.cur : f.h, same = f.part ? [...sd.past, cur2] : R.ser.filter((r) => r.m === fm && !r.part).map((r) => r.h), n = same.length, rank = same.filter((v) => v > cur2).length + 1, pct4 = (same.filter((v) => v < cur2).length + (same.filter((v) => v === cur2).length - 1) / 2) / Math.max(1, n - 1) * 100, med = f.part ? sd.med : R.stats[fm].med;
    let label = "Typical", cls = "";
    if (!(cur2 === 0 && med === 0)) {
      if (pct4 >= 90) {
        label = "Unusually high";
        cls = "hi";
      } else if (pct4 >= 75) {
        label = "Above normal";
        cls = "hi";
      } else if (pct4 <= 10) {
        label = "Unusually low";
        cls = "lo";
      } else if (pct4 <= 25) {
        label = "Below normal";
        cls = "lo";
      }
    }
    return {
      f,
      fm,
      fy,
      label,
      cls,
      rank,
      n,
      med,
      mult: med > 0 && cur2 > 0 ? times(cur2 / med) + (f.part ? ` a normal ${sd.span}` : " a normal " + MON[fm]) : cur2 === 0 ? "No hotspots" + (f.part ? ` in ${sd.span}` : "") : fmt(cur2) + (fmt(cur2) === "1" ? " hotspot" : " hotspots") + (f.part ? ` in ${sd.span}` : ""),
      same: f.part ? sd : void 0
    };
  }
  var riskYears = () => {
    const a = Math.max(S.yFrom, 2012), b = Math.min(S.yTo, FULL_Y1);
    return a <= b ? [a, b] : [Math.min(S.yFrom, FULL_Y1), Math.min(S.yTo, FULL_Y1)];
  };
  function riskFor(R, m) {
    const [a, b] = riskYears(), rows = R.ser.filter((r) => r.m === m && r.y >= a && r.y <= b), hit = rows.filter((r) => r.h > 0), z = hit.map((r) => r.h).sort((x, y) => x - y);
    return {
      n: rows.length,
      k: hit.length,
      p: rows.length ? hit.length / rows.length : 0,
      typical: z.length ? z[Math.floor((z.length - 1) / 2)] : 0,
      worst: hit.reduce((w, r) => r.h > w.h ? r : w, { h: 0, y: null }),
      last: hit.length ? hit[hit.length - 1].y : null,
      a,
      b
    };
  }
  function countyRisk(st, m) {
    const s2 = D.states[st], [a, b] = riskYears(), ny = b - a + 1, nc = s2.counties.length, M = new Float64Array(nc * ny), hx = hexState(st), nf = notFire(st), fire = new Float64Array(nc), rows = s2.county_rows;
    let fireAll = 0;
    for (let k = 0; k < hx.n; k++) {
      if (nf[k]) continue;
      let c = 0;
      for (let y = a; y <= b; y++) if (hx.H[k * NM + (y - Y0) * 12 + m] > 0) c++;
      fire[hx.c[k]] += c / ny;
      fireAll += c / ny;
    }
    for (let p = 0; p < rows.length; p += 5) {
      const i = rows[p + 1];
      if (i % 12 !== m) continue;
      const y = Y0 + Math.floor(i / 12);
      if (y < a || y > b) continue;
      M[rows[p] * ny + (y - a)] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
    }
    let all = 0;
    for (let q = 0; q < M.length; q++) all += M[q];
    return s2.counties.map((c, ci) => {
      const v = Array.from(M.subarray(ci * ny, (ci + 1) * ny)), k = v.filter((x) => x > 0).length, sum2 = v.reduce((x, y) => x + y, 0);
      return {
        ci,
        name: c.name,
        k,
        n: ny,
        p: k / ny,
        mean: sum2 / ny,
        hotShare: all ? sum2 / all : 0,
        e: fire[ci],
        share: fireAll ? fire[ci] / fireAll : 0
      };
    }).sort((x, y) => y.e - x.e || y.p - x.p);
  }
  var leadText = (R, ytd = null) => R.any === 0 ? "No fire hotspots were detected here in these years. Try a larger area." : R.total === 0 ? `No fire hotspots were detected here in the complete years chosen.${ytd ? " " + ytdSentence(ytd) : ""}` : `Fire activity here peaks in ${MONL[R.order[0].m]}. ${R.ranked[0].y} was the most active ${R.ranked[0].part ? "year so far" : "complete year on record"}, ${times(R.ranked[0].h / R.mean).replace("\xD7", "")} times an average year.` + (ytd ? " " + ytdSentence(ytd) : "");
  var kmBetween = (lon1, lat1, lon2, lat2) => Math.hypot((lon1 - lon2) * 111.32 * Math.cos(lat1 * Math.PI / 180), (lat1 - lat2) * 110.57);
  function nearestTown(st, lon, lat) {
    let best = null, bd = 1e9;
    for (const t of hexState(st).towns) {
      const d = kmBetween(lon, lat, t.lon, t.lat);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
  var COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function hexPlace(st, k) {
    const hx = hexState(st), lon = hx.X[k] / hx.K, lat = hx.Y[k], t = nearestTown(st, lon, lat), d = kmBetween(lon, lat, t.lon, t.lat);
    if (d < 3) return "Near " + t.n;
    const dx = (lon - t.lon) * Math.cos(lat * Math.PI / 180), dy = lat - t.lat, dir = COMPASS[Math.round((Math.atan2(dx, dy) * 180 / Math.PI + 360) / 45) % 8];
    return `${Math.round(d)} km ${dir} of ${t.n}`;
  }
  function hexAtLonLat(st, lon, lat) {
    const hx = hexState(st), k = hx.key.get(hexKey(lon * hx.K, lat, hx.R));
    return k === void 0 ? -1 : k;
  }
  var NOT_FIRE = {
    NY: [],
    CA: [
      {
        /* the three solar towers, [lat, lon]; VIIRS flags them by day in most months since late 2013 */
        name: "the Ivanpah solar power plant",
        pts: [
          [35.534, -115.452],
          [35.557, -115.47],
          [35.575, -115.484]
        ]
      }
    ]
  };
  var notFireCache = {};
  function notFire(st) {
    let m = notFireCache[st];
    if (!m) {
      m = new Uint8Array(hexState(st).n);
      for (const src of NOT_FIRE[st])
        for (const [lat, lon] of src.pts) {
          const k = hexAtLonLat(st, lon, lat);
          if (k >= 0) m[k] = 1;
        }
      notFireCache[st] = m;
    }
    return m;
  }
  function notFireNote(st, mask) {
    const nf = notFire(st), names = /* @__PURE__ */ new Set();
    for (let k = 0; k < nf.length; k++) if (nf[k] && mask[k]) names.add(notFireName(st, k));
    return names.size ? ` These counts include heat from ${[...names].join(" and ")}, which is not fire.` : "";
  }
  var notFireName = (st, k) => notFire(st)[k] ? NOT_FIRE[st].find((src) => src.pts.some(([lat, lon]) => hexAtLonLat(st, lon, lat) === k))?.name || "" : "";
  function stationsFor(st, sel) {
    const hx = hexState(st), sn = hx.stn;
    let n = 0, near2 = 1e9, c = null, rad2 = null;
    if (sel.type === "hex") {
      c = [hx.X[sel.k] / hx.K, hx.Y[sel.k]];
      rad2 = 15;
    } else if (sel.type === "circle") {
      c = [sel.lon, sel.lat];
      rad2 = sel.rad;
    }
    for (let i = 0; i < sn.n; i++) {
      const lon = sn.X[i] / hx.K, lat = sn.Y[i];
      if (c) {
        const d = kmBetween(c[0], c[1], lon, lat);
        if (d <= rad2) n++;
        if (d < near2) near2 = d;
      } else if (sel.type === "state" || sel.type === "county" && sn.c[i] === sel.ci || sel.type === "box" && lon >= sel.w && lon <= sel.e && lat >= sel.s && lat <= sel.n)
        n++;
    }
    return { n, near: c ? near2 : null, rad: rad2 };
  }
  var placeName = () => {
    const s2 = S.sel, hx = hexState(S.st);
    return s2.type === "state" ? NAME[S.st] : s2.type === "hex" ? "Near " + nearestTown(S.st, hx.X[s2.k] / hx.K, hx.Y[s2.k]).n : s2.type === "county" ? D.states[S.st].counties[s2.ci].name + " County" : s2.type === "box" ? "Your drawn area" : s2.label ? `Around ${s2.label}` : `${s2.rad} km around ${s2.lat.toFixed(2)}, ${s2.lon.toFixed(2)}`;
  };
  function hexKey(X, Y, R) {
    const q = (Math.sqrt(3) / 3 * X - Y / 3) / R, r = 2 / 3 * Y / R, s2 = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s2);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s2);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return rq + "," + rr;
  }

  // src/color.ts
  var RAMPS = {
    fire: ["#2e1b1f", "#571f20", "#771e1e", "#991d1c", "#bb201c", "#dc2a22", "#f53a2c", "#ff5238"],
    inferno: ["#2a0f52", "#55126c", "#7f1e6c", "#a92e5e", "#d04545", "#ee6a24", "#fb9d07", "#f6d443", "#fcffa4"],
    cividis: ["#1d3f7a", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"],
    viridis: ["#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"]
  };
  var hex3 = (h2) => [1, 3, 5].map((i) => parseInt(h2.slice(i, i + 2), 16));
  function lerp(stops, t) {
    t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i, a = hex3(stops[i]), b = hex3(stops[i + 1]);
    return a.map((v, k) => Math.round(v + (b[k] - v) * f));
  }
  var seq = (t) => lerp(RAMPS[S.pal], t);
  function div(t) {
    const m = hex3(css("--mid")), e = hex3(css(t < 0 ? "--cool" : "--hot")), f = Math.min(1, Math.abs(t));
    return m.map((v, k) => Math.round(v + (e[k] - v) * f));
  }
  var rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  var pop = (n) => {
    let c = 0;
    while (n) {
      n &= n - 1;
      c++;
    }
    return c;
  };
  var colT = (lut2, t) => lut2[Math.round(63 * (0.05 + 0.95 * (S.layer === "chance" ? t : Math.pow(t, 1.5))))];
  var lutPal = null;
  var lut = [];
  var LUT = () => {
    if (lutPal !== S.pal) {
      lut = Array.from({ length: 64 }, (_, i) => rgb(seq(i / 63)));
      lutPal = S.pal;
    }
    return lut;
  };
  var inkOn = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? "#14110c" : "#fff";
  function paintRamp(id, fn) {
    const cv = $(id), c = cv.getContext("2d");
    for (let x = 0; x < cv.width; x++) {
      c.fillStyle = rgb(fn(x / (cv.width - 1)));
      c.fillRect(x, 0, 1, cv.height);
    }
  }

  // src/tooltip.ts
  var tip = $("tip");
  function showTip(e, text2) {
    tip.textContent = text2;
    tip.style.display = "block";
    const w = tip.offsetWidth, h2 = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 12)) + "px";
    tip.style.top = Math.max(8, e.clientY - h2 - 10) + "px";
  }
  var hideTip = () => tip.style.display = "none";

  // src/charts.ts
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    for (const z of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f <= z) return z * p;
    return 10 * p;
  }
  var hatchN = 0;
  var HATCH = (id) => `<defs><pattern id="${id}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#ff8a3d" opacity=".22"/><rect width="2.2" height="5" fill="#ff8a3d"/></pattern></defs>`;
  function grid(W, m, ph, ymax, fy, n) {
    let s2 = "";
    for (let k = 0; k <= n; k++) {
      const v = ymax * k / n, y = m.t + ph * (1 - k / n);
      s2 += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.1)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${fy(v)}</text>`;
    }
    return s2;
  }
  function bars(el, xs, vals, o) {
    const W = 560, H = o.h || 240, m = { l: 42, r: 8, t: 18, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b, n = xs.length, bw = pw / n;
    const ymax = niceMax(Math.max(1e-9, ...vals) * 1.08), Y = (v) => m.t + ph * (1 - Math.min(1, v / ymax));
    const hid = "hatch" + ++hatchN;
    let s2 = HATCH(hid) + grid(W, m, ph, ymax, short, 2);
    vals.forEach((v, i) => {
      const x = m.l + bw * i + 1.5, w = Math.max(1, bw - 3), y = Y(v), cx = x + w / 2;
      s2 += o.part && o.part(i) ? `<rect x="${x + 0.75}" y="${y}" width="${Math.max(0.5, w - 1.5)}" height="${Math.max(0.5, m.t + ph - y - 0.75)}" rx="3" fill="rgba(255,138,61,.25)" stroke="${o.sel === i ? "#fff" : "#ff8a3d"}" stroke-width="${o.sel === i ? 2 : 1.3}" stroke-dasharray="3 2"/>` + (n < 40 ? `<text class="hl" x="${cx}" y="${y - 5}" text-anchor="middle">so far</text>` : "") : `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0.5, m.t + ph - y)}" rx="3" fill="${o.hatch && o.hatch(i) ? `url(#${hid})` : "#ff8a3d"}" ${o.sel === i ? 'stroke="#fff" stroke-width="2"' : ""}/>`;
      if (o.lo && o.whisk(i))
        s2 += `<line x1="${cx}" x2="${cx}" y1="${Y(o.lo[i])}" y2="${Y(o.hi[i])}" stroke="#dfe5ee" stroke-width="1.3"/>`;
      if (o.top && o.top.includes(i)) s2 += `<text class="hl" x="${cx}" y="${y - 5}" text-anchor="middle">${xs[i]}</text>`;
      if (i % (o.step || 1) === 0) s2 += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${xs[i]}</text>`;
    });
    if (o.avg != null) s2 += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.avg)}" y2="${Y(o.avg)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
    vals.forEach(
      (v, i) => s2 += `<rect data-i="${i}" x="${m.l + bw * i}" y="${m.t}" width="${bw}" height="${ph + 18}" fill="transparent" style="cursor:pointer"/>`
    );
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${s2}</svg>`;
    el.querySelectorAll("rect[data-i]").forEach((r) => {
      const i = +r.dataset.i;
      r.onmousemove = (e) => showTip(e, o.tip(i));
      r.onmouseleave = hideTip;
      r.onclick = () => o.click(i);
    });
  }
  function lines(el, xs, sers, o) {
    const W = o.W || 620, H = o.h || 230, m = { l: 42, r: o.labels ? 92 : 10, t: 12, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b, n = xs.length, fy = o.fy || short;
    const ymax = niceMax(Math.max(1e-9, ...sers.flatMap((z) => z.v).filter(Number.isFinite), ...o.band ? o.band.hi.slice(0, o.band.n) : [])), X = (i) => m.l + (n === 1 ? pw / 2 : pw * i / (n - 1)), Y = (v) => m.t + ph * (1 - Math.min(1, v / ymax));
    let s2 = grid(W, m, ph, ymax, fy, 2);
    if (o.band && o.band.n > 1) {
      const b = o.band, up = [], down = [];
      for (let i = 0; i < b.n; i++) {
        up.push(`${X(i)},${Y(b.hi[i])}`);
        down.unshift(`${X(i)},${Y(b.lo[i])}`);
      }
      s2 += `<path d="M${up.concat(down).join("L")}Z" fill="${b.c}" stroke="none"/>`;
    }
    xs.forEach((x, i) => {
      if (i % Math.ceil(n / (o.every || 7)) === 0) s2 += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${x}</text>`;
    });
    if (o.vline >= 0)
      s2 += `<line x1="${X(o.vline)}" x2="${X(o.vline)}" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" stroke-dasharray="3 3"/><text class="hl" x="${X(o.vline) + 5}" y="${m.t + 10}">VIIRS starts</text>`;
    if (o.base != null)
      s2 += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.base)}" y2="${Y(o.base)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
    sers.forEach((z) => {
      let d = "", on = false;
      z.v.forEach((v, i) => {
        if (!Number.isFinite(v)) on = false;
        else {
          d += `${on ? "L" : "M"}${X(i)},${Y(v)}`;
          on = true;
        }
      });
      s2 += `<path d="${d}" fill="none" stroke="${z.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${z.dash ? ` stroke-dasharray="${z.dash}"` : ""}/>`;
    });
    if (o.labels) {
      const ends = sers.filter((z) => Number.isFinite(z.v[n - 1])).map((z) => ({ z, y: Y(z.v[n - 1]) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      const over = ends.length ? ends[ends.length - 1].y - (m.t + ph - 6) : 0;
      if (over > 0) ends.forEach((e) => e.y -= over);
      ends.forEach(
        (e) => s2 += `<circle cx="${X(n - 1)}" cy="${Y(e.z.v[n - 1])}" r="4" fill="${e.z.c}" stroke="#0b0f18" stroke-width="2"/><text class="hl" x="${X(n - 1) + 9}" y="${e.y + 4}">${e.z.name}</text>`
      );
    }
    s2 += `<line id="xh" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${s2}</svg>`;
    const hit = el.querySelector("svg > rect"), xl = el.querySelector("#xh");
    hit.onmousemove = (e) => {
      const b = hit.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - b.left) / b.width * (n - 1))));
      xl.setAttribute("x1", String(X(i)));
      xl.setAttribute("x2", String(X(i)));
      xl.setAttribute("visibility", "visible");
      showTip(e, o.tip(i));
    };
    hit.onmouseleave = () => {
      xl.setAttribute("visibility", "hidden");
      hideTip();
    };
  }
  function calendarInto(el, R, o) {
    const lmax = Math.log1p(Math.max(1, ...R.ser.map((r) => r.h))), cmp = !!o.compact, yFrom = R.years[0].y, yTo = R.years[R.years.length - 1].y, focus = o.focusYM || S.focus, vi0 = o.vi0 ?? VI0, st = R.st ?? S.st;
    el.style.gridTemplateColumns = cmp ? "34px repeat(12,minmax(0,1fr))" : "44px repeat(12,minmax(0,1fr)) 70px";
    let h2 = `<div></div>` + MON.map((m) => `<div class="h">${cmp ? m[0] : m}</div>`).join("") + (cmp ? "" : `<div class="h" style="text-align:right">Year total</div>`);
    for (let y = yTo; y >= yFrom; y--) {
      if (y === 2011 && yTo >= 2012)
        h2 += `<div class="split">${cmp ? "converted from MODIS below" : "seen by VIIRS above \xB7 converted from MODIS below"}</div>`;
      h2 += `<div class="y">${y}</div>`;
      for (let m = 0; m < 12; m++) {
        const r = R.ser[(y - yFrom) * 12 + m];
        if (!r) {
          h2 += `<div class="c none" aria-label="${MON[m]} ${y}: no data yet"></div>`;
          continue;
        }
        const c = o.mode === "anom" ? Number.isFinite(r.ratio) ? div(Math.log2(r.ratio) / 3) : [60, 66, 78] : r.h === 0 ? [22, 28, 40] : seq(0.06 + 0.94 * Math.log1p(r.h) / lmax), nd = r.i >= vi0 && !!fillNote(r.i, st);
        h2 += `<button type="button" ${cmp ? 'tabindex="-1"' : ""} class="c${o.focus && focus[0] === y && focus[1] === m ? " focus" : ""}${r.part ? " part" : ""}${nd && !cmp ? " n20" : ""}" data-i="${r.i}" style="background-color:${rgb(c)};color:${inkOn(c)}" aria-label="${MON[m]} ${y}: ${fmt(r.h)} hotspots${r.part ? " so far" : ""}">${cmp || r.h === 0 ? "" : short(r.h)}</button>`;
      }
      const yr = R.years.find((z) => z.y === y);
      if (!cmp) h2 += yr?.part ? `<div class="t part">${fmt(yr.h)}<small>so far</small></div>` : `<div class="t">${fmt(yr ? yr.h : 0)}</div>`;
    }
    el.innerHTML = h2;
    el.querySelectorAll("button.c").forEach((b) => {
      const r = R.ser[+b.dataset.i - R.ser[0].i];
      const nd = r.i >= vi0 ? fillNote(r.i, st) : "";
      b.onmousemove = (e) => showTip(
        e,
        (r.part ? `${MONL[r.m]} ${r.y} so far, to ${LAST_WORDS}: ${fmt(r.h)} ${fmt(r.h) === "1" ? "hotspot" : "hotspots"}
` + (Number.isFinite(r.med) ? `Normal for the same days: ${fmt(r.med)}` : "The month is not over; no same-days history for this area") : `${MONL[r.m]} ${r.y}: ${fmt(r.h)} ${fmt(r.h) === "1" ? "hotspot" : "hotspots"}
Normal for ${MON[r.m]}: ${fmt(r.med)}`) + (nd ? `
VIIRS Suomi NPP, with ${nd}` : `
${r.src}`) + (r.i < vi0 || nd && r.hi - r.lo >= 1 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "") + (o.more ? "\n" + o.more(r) : "")
      );
      b.onmouseleave = hideTip;
      if (o.click) b.onclick = () => o.click(r);
    });
  }

  // src/forecast.ts
  var F = () => window.FORECAST;
  var FC_YEARS = [2026, 2027];
  var fcOn = (st) => !!F()?.[st]?.any?.p;
  var largeOf = (st) => {
    const L2 = st === "CA" ? F()?.CA.large : null;
    return L2 && L2.past ? L2 : null;
  };
  var fcData = () => F();
  var layerOf = (st, fire) => fire === "large" ? largeOf(st) : fcOn(st) ? F()[st].any : null;
  var sameCache = /* @__PURE__ */ new Map();
  function fcSame(st, fire, county2 = false) {
    const L2 = layerOf(st, fire), arr = L2 && (county2 ? L2.county : L2.p);
    if (!arr) return false;
    const key = [st, fire, county2].join("|");
    let v = sameCache.get(key);
    if (v === void 0) {
      const h2 = arr.length / 2;
      v = true;
      for (let i = 0; i < h2 && v; i++) if (arr[i] !== arr[h2 + i]) v = false;
      sameCache.set(key, v);
    }
    return v;
  }
  function oddsFix() {
    if (!S.st) return;
    if (S.fire === "large" && !largeOf(S.st)) S.fire = "any";
    if (S.odds !== "past" && !fcOn(S.st)) S.odds = "past";
  }
  var isFc = (o = S.odds) => o !== "past";
  var tIdx = (year, m) => (year - 2026) * 12 + m;
  var fcCache = /* @__PURE__ */ new Map();
  function fcHex(st, fire, year, m, county2 = false) {
    const L2 = layerOf(st, fire), arr = L2 && (county2 ? L2.county : L2.p);
    if (!arr) return null;
    const key = [st, fire, year, m, county2].join("|"), hit = fcCache.get(key);
    if (hit) return hit;
    const n = county2 ? D.states[st].counties.length : hexState(st).n, o = new Float32Array(n), b = tIdx(year, m) * n;
    for (let u = 0; u < n; u++) o[u] = arr[b + u] / 1e3;
    fcCache.set(key, o);
    return o;
  }
  var largeMarks = null;
  function largeMarked(st) {
    const L2 = largeOf(st);
    if (!L2) return null;
    if (!largeMarks) {
      const n = hexState(st).n, m = new Uint8Array(n * NM), pr = L2.past.pairs;
      for (let q = 0; q < pr.length; q += 2) if (pr[q] < n && pr[q + 1] < NM) m[pr[q] * NM + pr[q + 1]] = 1;
      largeMarks = m;
    }
    return largeMarks;
  }
  function largeYears() {
    const L2 = largeOf("CA"), a = Math.max(S.yFrom, L2 ? L2.past.years[0] : Y0), b = Math.min(S.yTo, L2 ? L2.past.years[1] : S.yTo);
    return a <= b ? [a, b] : [S.yFrom, S.yTo];
  }
  var pastLargeCache = /* @__PURE__ */ new Map();
  function pastLarge(st, m, a, b) {
    const L2 = largeMarked(st);
    if (!L2) return null;
    const key = [m, a, b].join("|"), hit = pastLargeCache.get(key);
    if (hit) return hit;
    const n = hexState(st).n, o = new Float32Array(n), ny = b - a + 1;
    for (let k = 0; k < n; k++) {
      let c = 0;
      for (let y = a; y <= b; y++) c += L2[k * NM + (y - Y0) * 12 + m];
      o[k] = c / ny;
    }
    pastLargeCache.set(key, o);
    return o;
  }
  function pastLargeIn(st, mask, m, a, b) {
    const L2 = largeMarked(st), n = hexState(st).n;
    let k = 0;
    for (let y = a; y <= b; y++) {
      const i = (y - Y0) * 12 + m;
      for (let h2 = 0; h2 < n; h2++)
        if (mask[h2] && L2[h2 * NM + i]) {
          k++;
          break;
        }
    }
    return { k, n: b - a + 1 };
  }
  var scaleOf = (fire) => fire === "large" ? { max: 0.12, pow: 0.5 } : { max: 1, pow: 0.5 };
  var pastAnyCache = /* @__PURE__ */ new Map();
  function chanceNow(st, m = S.rm, odds = S.odds, fire = S.fire) {
    const sc = scaleOf(fire);
    if (isFc(odds)) {
      const v2 = fcHex(st, fire, odds, m);
      if (v2) return { v: v2, ...sc, years: null };
    }
    if (fire === "large") {
      const [a2, b2] = largeYears(), v2 = pastLarge(st, m, a2, b2);
      if (v2) return { v: v2, ...sc, years: [a2, b2] };
    }
    const [a, b] = riskYears(), key = [st, m, a, b].join("|");
    let v = pastAnyCache.get(key);
    if (!v) {
      const hx = hexState(st), nf = notFire(st);
      v = new Float32Array(hx.n);
      for (let k = 0; k < hx.n; k++) {
        if (nf[k]) continue;
        let c = 0;
        for (let y = a; y <= b; y++) if (hx.H[k * NM + (y - Y0) * 12 + m] > 0) c++;
        v[k] = c / (b - a + 1);
      }
      pastAnyCache.set(key, v);
    }
    return { v, ...scaleOf("any"), years: [a, b] };
  }
  var monthWhen = (m = S.rm, o = S.odds) => isFc(o) ? `${MONL[m]} ${o}` : MONL[m];
  var pctP = (x, past = false) => past && x === 0 ? "0%" : x >= 0.095 ? Math.round(x * 100) + "%" : x >= 5e-4 ? (x * 100).toFixed(1) + "%" : "<0.1%";
  var pctGain = (x) => Math.abs(x) < 5e-4 ? "0%" : (x < 0 ? "\u2212" : "") + Math.abs(x * 100).toFixed(1) + "%";

  // src/response.ts
  var RESP = () => window.RESPONSE;
  var respOf = (st) => RESP()?.[st] || null;
  var respCredit = () => RESP()?.credit || "";
  var GAP_KM = 15;
  function gcKm(lon1, lat1, lon2, lat2) {
    const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function estMin(cal, km3, extraA, extraB) {
    let b = 0;
    while (b + 1 < cal.bands_km.length && cal.bands_km[b + 1] <= km3) b++;
    return Math.max(km3 / cal.floor_kmh * 60, km3 / cal.kmh[b] * 60 + extraA + extraB);
  }
  var hexLon = (st, k) => hexState(st).X[k] / hexState(st).K;
  var hexLat = (st, k) => hexState(st).Y[k];
  var stnLon = (st, i) => hexState(st).stn.X[i] / hexState(st).K;
  var stnLat = (st, i) => hexState(st).stn.Y[i];
  var LEG_KM = 1;
  var extraOf = (r, k) => k >= 0 && r.e10[k] > 0 ? r.e10[k] / 10 : 0;
  function closestAt(st, k, lon = hexLon(st, k), lat = hexLat(st, k)) {
    const r = respOf(st);
    if (!r || k < 0) return null;
    const hx = hexState(st), off = gcKm(lon, lat, hexLon(st, k), hexLat(st, k)), far = off >= LEG_KM && r.e10[k] !== -9999, eK = extraOf(r, k), leg = far ? estMin(r.cal, off, 0, eK) : 0, fj = hx.f.key.get(hexKey(lon * hx.K, lat, hx.f.R)), fs = fj === void 0 || fj >= r.fine.n ? -1 : r.fine.s[fj], fine = fs >= 0 ? { i: fs, name: hx.stn.names[fs][0], min: r.fine.min10[fj] / 10 } : null, rows = [];
    for (let j = 0; j < 3; j++) {
      const i = r.top[3 * k + j];
      if (i < 0) break;
      const minC = r.min10[3 * k + j] / 10, crow = gcKm(lon, lat, stnLon(st, i), stnLat(st, i)), viaLeg = minC + leg, line = far ? estMin(r.cal, crow, eK, extraOf(r, hexAtLonLat(st, stnLon(st, i), stnLat(st, i)))) : Infinity, est = Math.min(viaLeg, line), patch = fine && fine.i === i && fine.min < est;
      rows.push({
        i,
        name: hx.stn.names[i][0],
        town: hx.stn.names[i][1],
        min: patch ? fine.min : est,
        minC,
        km: r.km10[3 * k + j] / 10,
        crow,
        via: patch ? "patch" : !far ? "centre" : line < viaLeg ? "line" : "leg"
      });
    }
    if (fine && rows.length && !rows.some((s2) => s2.i === fine.i) && fine.min < rows[rows.length - 1].min)
      rows.push({
        i: fine.i,
        name: fine.name,
        town: hx.stn.names[fine.i][1],
        min: fine.min,
        minC: NaN,
        km: NaN,
        crow: gcKm(lon, lat, stnLon(st, fine.i), stnLat(st, fine.i)),
        via: "patch"
      });
    rows.sort((x, y) => x.min - y.min);
    rows.length = Math.min(rows.length, 3);
    return {
      k,
      rows,
      off,
      fine,
      why: rows.length ? "" : r.snap_m[k] > (RESP().snap_max_km || 10) * 1e3 ? `There is no road within ${RESP().snap_max_km || 10} km of this hexagon's centre, so no drive time.` : "The roads here do not connect to any station in the data (for example a military base or an island)."
    };
  }
  var riskCache = /* @__PURE__ */ new Map();
  function monthRisk(st, m, a, b) {
    const key = [st, m, a, b].join("|"), hit = riskCache.get(key);
    if (hit) return hit;
    const hx = hexState(st), nf = notFire(st), n = b - a + 1, p = new Float32Array(hx.n), e = new Float32Array(hx.n);
    let ptot = 0, etot = 0;
    for (let k = 0; k < hx.n; k++) {
      if (nf[k]) continue;
      let c = 0, s2 = 0;
      for (let y = a; y <= b; y++) {
        const v = hx.H[k * NM + (y - Y0) * 12 + m];
        if (v > 0) c++;
        s2 += v;
      }
      p[k] = c / n;
      e[k] = s2 / n;
      ptot += p[k];
      etot += e[k];
    }
    const o = { a, b, n, p, e, ptot, etot };
    riskCache.set(key, o);
    return o;
  }
  var fcRiskCache = /* @__PURE__ */ new Map();
  function forecastRisk(st, year, m) {
    const key = [st, year, m].join("|"), hit = fcRiskCache.get(key);
    if (hit) return hit;
    const p = fcHex(st, "any", year, m);
    if (!p) return null;
    let ptot = 0;
    for (let k = 0; k < p.length; k++) ptot += p[k];
    const o = { a: year, b: year, n: 1, fc: year, p, e: new Float32Array(p.length), ptot, etot: 0 };
    fcRiskCache.set(key, o);
    return o;
  }
  function gapList(st, risk, minP) {
    const r = respOf(st), list4 = [];
    let far = 0, maxCrow = 0;
    for (let k = 0; k < r.n; k++) {
      const crow = r.crow10[k] / 10;
      if (crow > maxCrow) maxCrow = crow;
      if (crow <= GAP_KM) continue;
      far++;
      if (risk.p[k] >= minP - 1e-9) list4.push(k);
    }
    list4.sort((x, y) => risk.p[y] - risk.p[x] || r.crow10[y] - r.crow10[x]);
    return { list: list4, far, maxCrow };
  }
  var splitCache = /* @__PURE__ */ new Map();
  function splitFor(st, m) {
    const key = st + "|" + m, hit = splitCache.get(key);
    if (hit) return hit;
    const hx = hexState(st), f = hx.f, r = respOf(st), bit = 1 << m, acc = Array.from({ length: hx.n }, () => /* @__PURE__ */ new Map());
    for (let j = 0, nj = Math.min(f.n, r.fine.n); j < nj; j++) {
      if (!(f.mm[j] & bit)) continue;
      const k = hx.key.get(hexKey(f.X[j], f.Y[j], hx.R));
      if (k === void 0) continue;
      const s2 = r.fine.s[j];
      acc[k].set(s2, (acc[k].get(s2) || 0) + 1);
    }
    const out = acc.map((mp, k) => {
      let t = 0;
      mp.forEach((v) => t += v);
      if (!t) return [r.top[3 * k], 1];
      const o = [];
      mp.forEach((v, s2) => o.push(s2, v / t));
      return o;
    });
    splitCache.set(key, out);
    return out;
  }
  function staffUp(st, m, risk) {
    const hx = hexState(st), ns = hx.stn.n, parts = splitFor(st, m), w = risk.p, E = new Float64Array(ns), top = new Float32Array(ns), hexes = new Uint16Array(ns);
    let none = 0, total2 = 0;
    for (let k = 0; k < hx.n; k++) {
      const p = parts[k], wk = w[k];
      if (!(wk > 0)) continue;
      total2 += wk;
      for (let q = 0; q < p.length; q += 2) {
        const s2 = p[q];
        if (s2 < 0) {
          none += wk * p[q + 1];
          continue;
        }
        hexes[s2]++;
        E[s2] += wk * p[q + 1];
        if (wk > top[s2]) top[s2] = wk;
      }
    }
    const past = !risk.fc, hot = new Float64Array(past ? ns : 0), K = new Uint16Array(past ? ns : 0), seen = new Int32Array(past ? ns : 0).fill(-1), nf = notFire(st);
    if (past)
      for (let y = risk.a; y <= risk.b; y++)
        for (let k = 0; k < hx.n; k++) {
          const h2 = hx.H[k * NM + (y - Y0) * 12 + m];
          if (!(h2 > 0) || nf[k]) continue;
          const p = parts[k];
          for (let q = 0; q < p.length; q += 2) {
            const s2 = p[q];
            if (s2 < 0) continue;
            hot[s2] += h2 * p[q + 1];
            if (seen[s2] !== y) {
              seen[s2] = y;
              K[s2]++;
            }
          }
        }
    const rows = [];
    for (let i = 0; i < ns; i++)
      if (E[i] > 0)
        rows.push({
          i,
          e: E[i],
          share: total2 ? E[i] / total2 : 0,
          top: top[i],
          hexes: hexes[i],
          ...past ? { hot: hot[i] / risk.n, k: K[i] } : {}
        });
    rows.sort((x, y) => y.e - x.e || y.top - x.top);
    return { rows, total: total2, noneShare: total2 ? none / total2 : 0, stations: rows.length };
  }
  function stationArea(st, m, i) {
    const parts = splitFor(st, m), mask = new Uint8Array(parts.length);
    parts.forEach((p, k) => {
      for (let q = 0; q < p.length; q += 2) if (p[q] === i) mask[k] = 1;
    });
    return mask;
  }
  function coveredNow(st, T) {
    const r = respOf(st), c = new Uint8Array(r.n);
    for (let k = 0; k < r.n; k++) c[k] = r.min10[3 * k] >= 0 && r.min10[3 * k] <= T * 10 ? 1 : 0;
    return c;
  }
  var reachCache = /* @__PURE__ */ new Map();
  function reachFor(st, T) {
    const key = st + "|" + T, hit = reachCache.get(key);
    if (hit) return hit;
    const r = respOf(st), hx = hexState(st), cal = r.cal, n = hx.n, lon = new Float64Array(n), lat = new Float64Array(n), maxKm = T / 60 * cal.floor_kmh * 1.01, out = [], buf = [];
    for (let k = 0; k < n; k++) {
      lon[k] = hx.X[k] / hx.K;
      lat[k] = hx.Y[k];
    }
    for (let j = 0; j < n; j++) {
      if (r.e10[j] === -9999) {
        out.push(null);
        continue;
      }
      buf.length = 0;
      const cj = 111.32 * Math.cos(lat[j] * Math.PI / 180), ej = r.e10[j] / 10;
      for (let k = 0; k < n; k++) {
        if (r.e10[k] === -9999) continue;
        const dy = (lat[k] - lat[j]) * 110.57;
        if (dy > maxKm || dy < -maxKm) continue;
        const dx = (lon[k] - lon[j]) * cj;
        if (dx * dx + dy * dy > maxKm * maxKm) continue;
        if (k === j || estMin(cal, gcKm(lon[j], lat[j], lon[k], lat[k]), ej, r.e10[k] / 10) <= T) buf.push(k);
      }
      out.push(Int32Array.from(buf));
    }
    reachCache.set(key, out);
    return out;
  }
  function greedyPlan(st, w, T, N) {
    const reach = reachFor(st, T), cov = coveredNow(st, T), n = w.length, by = new Int16Array(n).fill(-1);
    let total2 = 0, got = 0;
    for (let k = 0; k < n; k++) {
      total2 += w[k];
      if (cov[k]) got += w[k];
    }
    const before = total2 ? got / total2 : 0, sites = [], after = [];
    for (let s2 = 0; s2 < N && total2 > 0; s2++) {
      let best = -1, bg = 1e-9;
      for (let j = 0; j < n; j++) {
        const R = reach[j];
        if (!R) continue;
        let g = 0;
        for (let q = 0; q < R.length; q++) if (!cov[R[q]]) g += w[R[q]];
        if (g > bg) {
          bg = g;
          best = j;
        }
      }
      if (best < 0) break;
      for (const k of reach[best])
        if (!cov[k]) {
          cov[k] = 1;
          by[k] = s2;
        }
      got += bg;
      sites.push({ k: best, gain: bg / total2 });
      after.push(got / total2);
    }
    return { before, after, sites, by, total: total2 };
  }
  function coverageWith(st, w, T, sites) {
    const reach = reachFor(st, T), cov = coveredNow(st, T);
    for (const j of sites) for (const k of reach[j] || []) cov[k] = 1;
    let t = 0, g = 0;
    for (let k = 0; k < w.length; k++) {
      t += w[k];
      if (cov[k]) g += w[k];
    }
    return t ? g / t : 0;
  }
  var planCache = /* @__PURE__ */ new Map();
  function planFor(st, risk, m, T, N) {
    const key = [st, m, risk.fc ? "fc" : "past", risk.a, risk.b, T, N].join("|");
    let p = planCache.get(key);
    if (!p) {
      p = greedyPlan(st, risk.p, T, N);
      planCache.set(key, p);
    }
    return p;
  }
  var testCache = /* @__PURE__ */ new Map();
  function planTest(st, m, a, b, T, N) {
    const key = [st, m, a, b, T, N].join("|");
    if (testCache.has(key)) return testCache.get(key);
    let out = null;
    if (b - a + 1 >= 6) {
      const mid = a + Math.floor((b - a + 1) / 2) - 1, tr = monthRisk(st, m, a, mid), te = monthRisk(st, m, mid + 1, b);
      if (tr.ptot > 0 && te.ptot > 0) {
        const g = greedyPlan(st, tr.p, T, N).sites.map((s2) => s2.k), cov = coveredNow(st, T), reach = reachFor(st, T), busy3 = [];
        for (let k = 0; k < tr.p.length; k++) if (!cov[k] && reach[k] && tr.p[k] > 0) busy3.push(k);
        busy3.sort((x, y) => tr.p[y] - tr.p[x] || x - y);
        out = {
          train: [a, mid],
          test: [mid + 1, b],
          today: coverageWith(st, te.p, T, []),
          greedy: coverageWith(st, te.p, T, g),
          busiest: coverageWith(st, te.p, T, busy3.slice(0, N))
        };
      }
    }
    testCache.set(key, out);
    return out;
  }
  function reachMean(st, T) {
    let n = 0, t = 0;
    for (const R of reachFor(st, T))
      if (R) {
        n++;
        t += R.length;
      }
    return n ? t / n : 0;
  }
  function calErrFor(cal, T) {
    const ok = cal.test.by_band.filter((b) => b.n >= 100 && cal.bands_km[b.band] !== void 0);
    if (!ok.length) return null;
    const hit = ok.filter((b) => cal.bands_km[b.band] < T / 60 * cal.kmh[b.band]), use = hit.length ? hit : [ok[0]], errs = use.map((b) => b.bands_plus_local), last = use[use.length - 1].band;
    return {
      lo: Math.min(...errs),
      hi: Math.max(...errs),
      km0: cal.bands_km[use[0].band],
      km1: cal.bands_km[last + 1] ?? cal.bands_km[last]
    };
  }

  // src/pop.ts
  var P = () => window.POPULATION?.states ?? null;
  var popWhen = (short2 = false) => window.POPULATION ? `Census${short2 ? "" : " estimate"}, ${window.POPULATION.label}` : "";
  function popCounty(st, ci) {
    const fips = D.states[st].counties[ci]?.fips;
    return fips ? P()?.[st]?.counties[fips] ?? null : null;
  }
  var popState = (st) => P()?.[st]?.total ?? null;
  function fmtPop(n) {
    if (n < 1e4) return n.toLocaleString("en-US");
    const r = Number(n.toPrecision(3));
    return r >= 1e6 ? Number((r / 1e6).toPrecision(3)) + " million" : r.toLocaleString("en-US");
  }
  var peoplePop = (n) => fmtPop(n) + (n === 1 ? " person" : " people");
  function popSuffix(st, ci) {
    const p = popCounty(st, ci);
    return p == null ? "" : ` \xB7 ${fmtPop(p)} ${p === 1 ? "resident" : "residents"}`;
  }
  var exactPop = (n) => `${n.toLocaleString("en-US")} people (US Census Bureau estimate for 1 ${window.POPULATION?.label ?? ""})`;
  function popOf(st, cis) {
    if (!P()) return null;
    const seen = [...new Set(cis)].filter((ci) => ci >= 0);
    let people = 0;
    for (const ci of seen) {
      const p = popCounty(st, ci);
      if (p == null) return null;
      people += p;
    }
    return { counties: seen, people };
  }
  function countyNames(st, cis, max = 4) {
    const names = cis.map((ci) => D.states[st].counties[ci].name);
    if (names.length > max + 1) return names.slice(0, max).join(", ") + ` and ${names.length - max} more`;
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0] ?? "";
  }
  function popSentence(st, cis, lead2, notWho = "not only the people near fire") {
    const p = popOf(st, cis);
    if (!p || !p.counties.length) return "";
    const n = p.counties.length;
    return `${lead2(n, countyNames(st, p.counties))} ${n === 1 ? "is" : "are"} home to ${peoplePop(p.people)}${n === 1 ? "" : " in all"} (${popWhen()}). That counts everyone living in ${n === 1 ? "the county" : "those counties"}, ${notWho}.`;
  }

  // src/respui.ts
  var GAP_C = "#4fe3ff";
  var STN_C = "#7fd8ff";
  var EMBER = "#ff8a3d";
  var esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var pct = (x) => x >= 0.095 ? Math.round(x * 100) + "%" : x >= 1e-3 ? (x * 100).toFixed(1) + "%" : x > 0 ? "<0.1%" : "0%";
  var pc1 = (x) => (x * 100).toFixed(1) + "%";
  var km1 = (x) => x < 10 ? x.toFixed(1) : String(Math.round(x));
  var mins = (x) => x < 10 ? x.toFixed(1) : String(Math.round(x));
  var county = (st, k) => D.states[st].counties[hexState(st).c[k]].name + " County";
  var hexKm = (st) => Math.round(D.states[st].hex_r * 111.2 * Math.sqrt(3));
  var THR = [
    [0.1, "1 year in 10"],
    [0.25, "1 year in 4"],
    [0.5, "1 year in 2"]
  ];
  var thrLabel = (t) => (THR.find((x) => Math.abs(x[0] - t) < 1e-6) || THR[1])[1];
  var inCounties = (n, names) => n === 1 ? `${names} County` : `${n} counties (${names})`;
  var gapPop = (st, ks) => popSentence(
    st,
    ks.map((k) => hexState(st).c[k]),
    (n, names) => `${ks.length === 1 ? "This place lies" : `The ${ks.length} places lie`} in ${inCounties(n, names)}, which`,
    ks.length === 1 ? "not the people living in this remote place" : "not the people living in these remote places"
  );
  var memo = null;
  function cur() {
    const st = S.st, [a, b] = riskYears(), fc = isFc() && fcOn(st) ? S.odds : 0, key = [st, S.rm, a, b, RT.gapMin, fc].join("|");
    if (!memo || memo.key !== key) {
      const risk = fc && forecastRisk(st, fc, S.rm) || monthRisk(st, S.rm, a, b);
      memo = { key, risk, gaps: gapList(st, risk, RT.gapMin), staff: staffUp(st, S.rm, risk) };
    }
    return memo;
  }
  var riskWords = (r, mo) => r.fc ? `its forecast chance of fire in ${mo} ${r.fc} (from fire history, not weather)` : `how often it burned in ${mo}, ${r.a}\u2013${r.b}`;
  var srcLine = (r, mo) => `<p class="srcLine">${r.fc ? `Using the <b>forecast for ${mo} ${r.fc}</b>` : `Using <b>past odds</b>, ${mo} ${r.a}\u2013${r.b}`}${S.fire === "large" ? ". These tools weigh all fires, not only large ones." : ""}</p>`;
  var curPlan = () => planFor(S.st, cur().risk, S.rm, RT.planT, RT.planN);
  var areaMemo = null;
  function focusArea() {
    const key = [S.st, S.rm, RT.focusStn].join("|");
    if (!areaMemo || areaMemo.key !== key) areaMemo = { key, mask: stationArea(S.st, S.rm, RT.focusStn) };
    return areaMemo.mask;
  }
  function respTarget() {
    if (!S.st || !respOf(S.st)) return null;
    const hx = hexState(S.st), sl = S.sel;
    if (RT.tool === "near" && RT.pin) return { ...RT.pin, what: "the spot you clicked" };
    if (sl.type === "hex") return { k: sl.k, lon: hx.X[sl.k] / hx.K, lat: hx.Y[sl.k], what: "this hexagon's centre" };
    if (sl.type === "circle" && sl.label) {
      const k = hexAtLonLat(S.st, sl.lon, sl.lat);
      if (k >= 0) return { k, lon: sl.lon, lat: sl.lat, what: sl.label };
    }
    return null;
  }
  function renderResp() {
    const st = S.st, r = respOf(st);
    $("resp").hidden = !r;
    if (!r) return;
    const mo = MONL[S.rm], tool = RT.tool;
    document.querySelectorAll("#toolSeg button").forEach((b) => {
      const on = b.dataset.tool === tool;
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("on", on);
    });
    $("respCtl").hidden = tool !== "gap" && tool !== "plan";
    $("gapCtl").hidden = tool !== "gap";
    $("planCtl").hidden = tool !== "plan";
    $("rmResp").value = String(S.rm);
    document.querySelectorAll("#oddsResp button").forEach((b) => {
      b.hidden = b.dataset.odds !== "past" && !fcOn(st);
      b.setAttribute("aria-pressed", String(b.dataset.odds === String(S.odds)));
    });
    document.querySelectorAll("#gapSeg button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.thr === RT.gapMin)));
    document.querySelectorAll("#planT button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.t === RT.planT)));
    $("planN").value = String(RT.planN);
    $("planNv").textContent = String(RT.planN);
    let h2 = "";
    if (RT.focusStn >= 0) h2 += focusHtml(st, mo);
    if (tool === "gap") h2 += gapHtml(st, mo);
    else if (tool === "plan") h2 += planHtml(st, mo);
    const t = respTarget();
    if (t) h2 += closestHtml(st, t);
    else if (tool === "near")
      h2 += `<p class="hint">Click anywhere in ${NAME[st]} to see the three stations with the shortest drive. Turn this off to click into counties again.</p>`;
    else if (!tool && RT.focusStn < 0)
      h2 += `<p class="hint">Find the stations closest to any spot, the places where fire is common but every station is more than ${GAP_KM} km away, or where extra crews would reach the most fire.</p>`;
    $("respOut").innerHTML = h2;
    $("respOut").querySelectorAll("[data-go]").forEach((b) => b.onclick = () => goHex(+b.dataset.go));
    $("respOut").querySelectorAll("[data-stn]").forEach(
      (b) => b.onclick = () => centerOn(stnLon(st, +b.dataset.stn), stnLat(st, +b.dataset.stn), Math.max(V.s, 150 / hexState(st).R), 700)
    );
    $("respOut").querySelectorAll("[data-act]").forEach(
      (b) => b.onclick = () => {
        const a = b.dataset.act;
        if (a === "clearStn") RT.focusStn = -1;
        if (a === "clearPin") RT.pin = null;
        if (a === "allGaps") {
          openSheet("area");
          requestAnimationFrame(() => $("gapSec").scrollIntoView({ block: "start" }));
          return;
        }
        render();
      }
    );
    $("respCredit").textContent = respCredit().replace("(c)", "\xA9");
  }
  function closestHtml(st, t) {
    const c = closestAt(st, t.k, t.lon, t.lat), spot = t.what !== "this hexagon's centre", from = t.what === "the spot you clicked" ? "the spot" : esc(t.what), head = `<div class="rh"><span>Closest stations by road</span>${RT.tool === "near" && RT.pin ? `<button class="link" type="button" data-act="clearPin">Clear</button>` : ""}</div>`;
    if (!c.rows.length) return head + `<p class="hint">${c.why}</p>`;
    const how2 = (s2) => s2.via === "patch" ? `by road to the 2 km patch at ${from}` : s2.via === "leg" ? `${mins(s2.minC)} min (${km1(s2.km)} km) by road to the hexagon centre, then about ${mins(s2.min - s2.minC)} min to ${from}` : s2.via === "line" ? `estimated from the straight line` : `${km1(s2.km)} km by road`;
    const rows = c.rows.map(
      (s2, j) => `<button type="button" class="nr" data-stn="${s2.i}"><span class="bd">${j + 1}</span><b>${esc(s2.name)}</b><span class="mn">${s2.via === "leg" || s2.via === "line" ? "~" : ""}${mins(s2.min)} min</span><small>${s2.town ? esc(s2.town) + " \xB7 " : ""}${how2(s2)} \xB7 ${km1(s2.crow)} km straight${spot ? " from " + from : ""}</small></button>`
    ).join("");
    const legNote = c.rows.some((s2) => s2.via === "leg" || s2.via === "line") ? ` ${spot ? `${from.charAt(0).toUpperCase() + from.slice(1)} is` : "It is"} ${km1(c.off)} km from the centre of its ${hexKm(st)} km hexagon, where the road search ends, so a ~ time is estimated from straight-line distance: the drive to the centre plus the last stretch, or straight from the station, whichever is shorter. These estimates are often 15\u201330% off, and a closer station can be missing from the three.` : "";
    return head + `<div class="nl">${rows}</div><p class="hint">Road searches to the hexagon's centre${c.rows.some((s2) => s2.via === "patch") ? ", and to the 2 km patch at the spot where fire was seen there" : ""}, at set speeds for each kind of road, with no traffic. Estimated drives, not response times.${legNote}</p>` + (c.fine && !c.rows.some((s2) => s2.i === c.fine.i) ? `<p class="hint">Fire was seen in the 2 km patch here. Its fastest station by road is ${esc(c.fine.name)}, ${mins(c.fine.min)} min.</p>` : "");
  }
  function gapHtml(st, mo) {
    const { gaps, risk } = cur(), r = respOf(st), n = gaps.list.length, rule = gapRule(risk, mo), when = risk.fc ? `${mo} ${risk.fc}` : mo;
    if (!n)
      return `${srcLine(risk, mo)}<p class="big"><b>None</b> in ${when}.</p><p class="hint">No place in ${NAME[st]} has ${rule}. ${gaps.far ? `${fmt(gaps.far)} hexagons are over ${GAP_KM} km from a station (the farthest ${km1(gaps.maxCrow)} km), but ${risk.fc ? `none has that high a forecast chance in ${when}` : `they burn less often than that in ${mo}`}.` : `Every hexagon has a station within ${GAP_KM} km.`}</p>`;
    const rows = gaps.list.slice(0, 6).map((k) => gapRow(st, k, risk, r.crow10[k] / 10, r.min10[3 * k], r.top[3 * k])).join("");
    const pop2 = gapPop(st, gaps.list);
    return `${srcLine(risk, mo)}<p class="big"><b>${n}</b> ${n === 1 ? "place" : "places"} to watch in ${when}</p><p class="hint"><i class="gk"></i>Outlined on the map: hexagons with ${rule}.</p><div class="nl">${rows}</div>` + (n > 6 ? `<button class="link" type="button" data-act="allGaps">See all ${n} in the full data</button>` : "") + (pop2 ? `<p class="hint">${esc(pop2)}</p>` : "");
  }
  var gapRule = (risk, mo) => (risk.fc ? `a forecast chance of fire in ${mo} ${risk.fc} of at least ${Math.round(RT.gapMin * 100)}%` : `fire in ${mo} in at least ${thrLabel(RT.gapMin)} (${risk.a}\u2013${risk.b})`) + ` and every station more than ${GAP_KM} km away in a straight line`;
  function gapRow(st, k, risk, crow, min10, top) {
    const hx = hexState(st), p = risk.p[k];
    return `<button type="button" class="nr" data-go="${k}"><span class="bd gap">!</span><b>${esc(hexPlace(st, k))}</b><span class="mn">${km1(crow)} km</span><small>${esc(county(st, k))} \xB7 ${risk.fc ? `forecast chance ${pctP(p)}` : `fire in ${pct(p)} of years`} \xB7 ${min10 >= 0 ? `fastest drive ${mins(min10 / 10)} min, ${esc(hx.stn.names[top][0])}` : "no road link to a station"}</small></button>`;
  }
  function planHtml(st, mo) {
    const { risk } = cur();
    if (!risk.ptot) return `<p class="hint">No fire was seen in ${NAME[st]} in ${mo}, ${risk.a}\u2013${risk.b}, so there is nothing to cover.</p>`;
    const p = curPlan(), T = RT.planT, k = p.sites.length, end = k ? p.after[k - 1] : p.before, [ta, tb] = riskYears(), test = planTest(st, S.rm, ta, tb, T, RT.planN);
    let h2 = srcLine(risk, mo) + `<div class="cov"><div><span>Today</span><b>${pc1(p.before)}</b></div><span class="arr">\u2192</span><div><span>With ${k} more ${k === 1 ? "crew" : "crews"}</span><b class="em">${pc1(end)}</b></div></div><div class="covBar" role="img" aria-label="${pc1(p.before)} covered today, ${pc1(end)} with the added crews"><i style="width:${(p.before * 100).toFixed(1)}%"></i><i class="add" style="width:${((end - p.before) * 100).toFixed(1)}%"></i></div><p class="hint">Share of ${mo}'s fire risk within ${T} minutes' drive of a station. Each hexagon counts by ${riskWords(risk, mo)}. Each crew below shows the percentage points it adds.</p>`;
    if (k < RT.planN)
      h2 += `<p class="hint">${k ? `Only ${k} ${k === 1 ? "crew adds" : "crews add"} anything.` : "No crew adds anything."} Every other place with fire in ${mo} is already within ${T} minutes or has no road link.</p>`;
    h2 += `<div class="nl">` + p.sites.map(
      (s2, j) => `<button type="button" class="nr" data-go="${s2.k}"><span class="bd site">${j + 1}</span><b>${esc(hexPlace(st, s2.k))}</b><span class="mn">+${(s2.gain * 100).toFixed(1)} pts</span><small>${esc(county(st, s2.k))}</small></button>`
    ).join("") + `</div>`;
    if (test)
      h2 += `<p class="hint test"><b>${risk.fc ? "The method, checked on past years." : "Checked on later years."}</b> Sites chosen from ${test.train[0]}\u2013${test.train[1]} cover ${pc1(test.greedy)} of ${mo}'s fire risk in ${test.test[0]}\u2013${test.test[1]} (stations alone: ${pc1(test.today)}). Putting the same number of crews in the busiest places no station reaches in time covers ${pc1(test.busiest)}.</p>`;
    const err = calErrFor(respOf(st).cal, T), reach = reachMean(st, T);
    h2 += `<p class="hint">Each crew goes, one at a time, to the hexagon centre that brings the most still-uncovered fire risk within ${T} minutes. Stations use their road drive times; new sites use an estimate from straight-line distance` + (err ? `, typically ${err.lo === err.hi ? err.lo : `${err.lo}\u2013${err.hi}`}% off at ${err.km0}\u2013${err.km1} km in tests.` : ".") + (reach < 2 ? ` At ${T} minutes a new site reaches on average ${reach.toFixed(1)} of the ${hexKm(st)} km hexagons, mostly its own, so the planner picks nearly the same places as simply taking the busiest places no station reaches in time.` : "") + `</p>`;
    return h2;
  }
  function focusHtml(st, mo) {
    const i = RT.focusStn, hx = hexState(st), row2 = cur().staff.rows.find((r) => r.i === i), risk = cur().risk, n = risk.n;
    if (risk.fc)
      return `<div class="rh"><span>${esc(hx.stn.names[i][0])}</span><button class="link" type="button" data-act="clearStn">Clear</button></div><p class="hint"><i class="sk"></i>${row2 ? `First to reach ${pct(row2.share)} of ${NAME[st]}'s forecast fire risk for ${mo} ${risk.fc}, across the ${row2.hexes} outlined ${row2.hexes === 1 ? "hexagon" : "hexagons"}. The likeliest has a ${pctP(row2.top || 0)} chance of fire.` : `None of the forecast fire risk for ${mo} ${risk.fc} falls in the area this station reaches first.`}</p>`;
    return `<div class="rh"><span>${esc(hx.stn.names[i][0])}</span><button class="link" type="button" data-act="clearStn">Clear</button></div><p class="hint"><i class="sk"></i>${row2 ? `First by road to ${pct(row2.share)} of ${NAME[st]}'s ${mo} fire: about ${row2.e < 10 ? row2.e.toFixed(1) : fmt(row2.e)} of the ${row2.hexes} outlined ${row2.hexes === 1 ? "hexagon" : "hexagons"} have fire in an average ${mo}. Fire there in ${row2.k} of ${n} years, about ${fmt(row2.hot || 0)} hotspots in an average ${mo}.` : `No fire in ${mo} falls in the area this station reaches first.`}</p>`;
  }
  function goHex(k) {
    const hx = hexState(S.st);
    S.sel = { type: "hex", k };
    render();
    centerOn(hx.X[k] / hx.K, hx.Y[k], 150 / hx.R, 900);
  }
  function renderStaff() {
    const st = S.st, on = !!respOf(st);
    $("staffBox").hidden = !on;
    $("gapSec").hidden = !on;
    if (!on) return;
    const { staff, gaps, risk } = cur(), mo = MONL[S.rm], hx = hexState(st);
    $("staff").innerHTML = staff.rows.length ? staff.rows.slice(0, 8).map(
      (w, j) => `<button type="button" class="w" data-stn="${w.i}"><span class="rk">${j + 1}</span><b>${esc(hx.stn.names[w.i][0])}</b><span class="pc">${pct(w.share)}</span><small>${hx.stn.names[w.i][1] ? esc(hx.stn.names[w.i][1]) + " \xB7 " : ""}${risk.fc ? `first to ${w.hexes} ${w.hexes === 1 ? "hexagon" : "hexagons"} \xB7 the likeliest has a ${pctP(w.top)} forecast chance` : `fire in its area in ${w.k} of ${risk.n} years \xB7 about ${fmt(w.hot || 0)} hotspots in an average ${mo}`}</small></button>`
    ).join("") : `<p class="note small">${risk.fc ? `No forecast fire risk in ${mo} ${risk.fc}.` : `No hotspots in ${mo}, ${risk.a}\u2013${risk.b}.`}</p>`;
    $("staff").querySelectorAll("[data-stn]").forEach((b) => b.onclick = () => showStation(+b.dataset.stn));
    const top8 = staff.rows.slice(0, 8).reduce((a, w) => a + w.share, 0), oneYear = !risk.fc && staff.rows.slice(0, 8).filter((w) => w.k === 1).length;
    $("staffNote").textContent = staff.rows.length ? (risk.fc ? `These 8 stations are first by road to ${pct(top8)} of the state's forecast fire risk for ${mo} ${risk.fc}: each hexagon counts by its chance of fire, split among stations the way its ${mo} fire fell since 2012.` : `These 8 stations are first by road to ${pct(top8)} of the state's ${mo} fire; ${fmt(staff.stations)} stations are first to some. Each hexagon counts by its share of years with a hotspot, so a place that burns most years outweighs one huge fire.`) + (oneYear ? ` ${oneYear} of them ${oneYear === 1 ? "rests" : "rest"} on fire in a single year.` : "") + (staff.noneShare > 5e-4 ? ` ${pct(staff.noneShare)} of it falls where no station has a road link.` : "") + " Hotspots are what satellites saw burning, mostly in a few big wildfires: they are not calls or incidents, and this says nothing about how a station is staffed." + staffPop(
      st,
      staff.rows.slice(0, 8).map((w) => w.i)
    ) : "";
    const n = gaps.list.length, r = respOf(st);
    $("gapTitle").textContent = `Far from a station in ${mo}${risk.fc ? " " + risk.fc : ""}: ${n} ${n === 1 ? "place" : "places"}`;
    const pop2 = n ? gapPop(st, gaps.list) : "";
    $("gapNote").textContent = `Hexagons with ${gapRule(risk, mo)}. ` + (n ? "Tap one to see it on the map. The drive time is to the fastest station by road." : gaps.far ? `${fmt(gaps.far)} hexagons are over ${GAP_KM} km from a station (the farthest ${km1(gaps.maxCrow)} km), but none of them ${risk.fc ? "has that high a forecast chance" : "burns that often"} in ${mo}.` : "") + (pop2 ? " " + pop2 : "") + " Change the rule under Fire response on the map.";
    $("gapList").innerHTML = gaps.list.map((k) => gapRow(st, k, risk, r.crow10[k] / 10, r.min10[3 * k], r.top[3 * k])).join("");
    $("gapList").querySelectorAll("[data-go]").forEach(
      (b) => b.onclick = () => {
        closeSheet();
        setTool("gap");
        goHex(+b.dataset.go);
      }
    );
    $("respMethod").innerHTML = methodHtml(st);
  }
  function staffPop(st, stations) {
    const c = hexState(st).stn.cp, k = stations.length, p = popSentence(
      st,
      stations.map((i) => c[i]),
      (n, names) => `${k === 1 ? "This station stands" : `These ${k} stations stand`} in ${inCounties(n, names)}, which`,
      k === 1 ? "not the people this station serves" : "not the people these stations serve"
    );
    return p ? " " + p : "";
  }
  function showStation(i) {
    closeSheet();
    const st = S.st, hx = hexState(st);
    RT.focusStn = i;
    stopPlay();
    S.layer = "chance";
    S.show = { t: "all" };
    const m = focusArea();
    let x0 = hx.stn.X[i], x1 = x0, y0 = hx.stn.Y[i], y1 = y0;
    for (let k = 0; k < hx.n; k++)
      if (m[k]) {
        x0 = Math.min(x0, hx.X[k]);
        x1 = Math.max(x1, hx.X[k]);
        y0 = Math.min(y0, hx.Y[k]);
        y1 = Math.max(y1, hx.Y[k]);
      }
    const p = hx.R * 3, f = fitView({ x0: x0 - p, x1: x1 + p, y0: y0 - p, y1: y1 + p });
    f.s = Math.min(f.s, V.fit * 8);
    render();
    flyTo(f, 800);
    if (innerWidth > 900) requestAnimationFrame(() => $("resp").scrollIntoView({ block: "start" }));
  }
  function methodHtml(st) {
    const R = window.RESPONSE, r = respOf(st), t = r.cal.test, o = (s2) => window.RESPONSE[s2].cal.test;
    return `<p>${howShort(st)}</p><ul class="steps"><li><b>Roads.</b> OpenStreetMap (Geofabrik extract of ${R.osm[st].timestamp.slice(0, 10)}), ${fmt(R.osm[st].graph.vertices)} road points. Speeds by road class: motorway ${R.speeds_kmh.motorway}, primary ${R.speeds_kmh.primary}, secondary ${R.speeds_kmh.secondary}, residential ${R.speeds_kmh.residential}, track ${R.speeds_kmh.track} km/h; posted limits are used where tagged, slightly reduced, up to ${R.cap_kmh} km/h. One-way rules apply on freeways only. The walk from a point to its nearest road is counted at ${R.access_kmh} km/h; a point more than ${R.snap_max_km} km from a road gets no time.</li><li><b>Stations.</b> The ${fmt(r.ns)} fire and EMS stations in the page's station list for ${NAME[st]}. Stations in neighbouring states are not counted, so places near the state line may have a closer one.</li><li><b>Closest stations</b> are exact road searches to each hexagon's centre. For a spot away from the centre, the last stretch is estimated (the rule below), or the 2 km patch's own road search is used where it is shorter. <b>First-due areas</b> split each hexagon's fire equally among the 2 km patches inside it that burned in that month since 2012, and give each patch to its fastest station. <b>Stations</b> are ranked by the fire in their first-due area, each hexagon counted by its chance of fire; hotspots are satellite detections, not calls or incidents.</li><li><b>New crew sites</b> use a rule that estimates drive time from straight-line distance: a speed for each distance band plus a few local minutes for each hexagon. On places held out of the fit its typical error over all distances is ${t.bands_plus_local.med_abs_pct}% here (one speed for every distance: ${t.one_speed.med_abs_pct}%), but ${bandErr(st)} at the short distances the planner uses. In New York ${o("NY").bands_plus_local.med_abs_pct}% against ${o("NY").one_speed.med_abs_pct}% overall; in California ${o("CA").bands_plus_local.med_abs_pct}% against ${o("CA").one_speed.med_abs_pct}%. Good for ranking, not for promising a time. At the ${hexKm(st)} km hexagon size a new site within 10\u201315 minutes reaches little beyond its own hexagon.</li><li><b>Fire risk</b> is, with past odds, the share of years ${riskYears().join("\u2013")} with a hotspot in the month: history, not a forecast. With Forecast 2026 or 2027 it is the forecast chance of at least one hotspot (see \u201CForecast 2026\u20132027\u201D above), which is also built from fire history alone and knows nothing about weather; first-due areas still split each hexagon the way its fire fell since 2012. The tools always weigh all fires, not only large ones.${NOT_FIRE[st].length ? ` The ${NOT_FIRE[st].map((x) => x.name.replace(/^the /, "")).join(" and ")} ${NOT_FIRE[st].length === 1 ? "is" : "are"} left out: its hotspots are heat from the plant, not fire, so ${notFire(st).reduce((a, v) => a + v, 0)} hexagons count as having none.` : ""}</li></ul><p class="note small">${esc(respCredit().replace("(c)", "\xA9"))}</p>`;
  }
  var bandErr = (st) => {
    const e = calErrFor(respOf(st).cal, 30);
    return e ? `${e.lo === e.hi ? e.lo : `${e.lo}\u2013${e.hi}`}% at ${e.km0}\u2013${e.km1} km` : "more";
  };
  var howShort = (st) => `Drive times come from OpenStreetMap roads at a set speed for each kind of road, from the ${fmt(respOf(st).ns)} fire and EMS stations in the station list. There is no traffic, no signal delay and no time to get out of the station, and we do not know which stations are staffed or what they have, so these are estimated drives, not response times.`;
  function setTool(t) {
    RT.tool = t;
    if (t !== "near") RT.pin = null;
    if (t === "gap" || t === "plan") {
      stopPlay();
      S.layer = "chance";
      S.fire = "any";
      S.show = { t: "all" };
    }
  }
  function toolPlaces() {
    if (RT.tool === "gap") return cur().gaps.list.slice(0, 6);
    if (RT.tool === "plan" && cur().risk.ptot) return curPlan().sites.map((s2) => s2.k);
    return [];
  }
  function showToolPlaces() {
    if (!S.st) return;
    const ks = toolPlaces(), hx = hexState(S.st);
    if (!ks.length || ks.filter((k) => onScreen(hx.X[k], hx.Y[k])).length * 2 >= ks.length) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of ks) {
      x0 = Math.min(x0, hx.X[k]);
      x1 = Math.max(x1, hx.X[k]);
      y0 = Math.min(y0, hx.Y[k]);
      y1 = Math.max(y1, hx.Y[k]);
    }
    const p = hx.R * 4, f = fitView({ x0: x0 - p, x1: x1 + p, y0: y0 - p, y1: y1 + p });
    f.s = Math.min(f.s, V.fit * 6);
    flyTo(f, 800);
  }
  var showOut = () => {
    if (innerWidth <= 900 && RT.tool) requestAnimationFrame(() => $("respOut").scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  var retool = () => {
    render();
    showToolPlaces();
  };
  function respEvents() {
    document.querySelectorAll("#toolSeg button").forEach(
      (b) => b.onclick = () => {
        const t = b.dataset.tool;
        setTool(RT.tool === t ? null : t);
        retool();
        if (innerWidth > 900 && RT.tool) requestAnimationFrame(() => $("resp").scrollIntoView({ block: "nearest" }));
      }
    );
    $("rmResp").innerHTML = MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    $("rmResp").onchange = () => {
      S.rm = +$("rmResp").value;
      retool();
    };
    document.querySelectorAll("#oddsResp button").forEach(
      (b) => b.onclick = () => {
        S.odds = b.dataset.odds === "past" ? "past" : +b.dataset.odds;
        retool();
      }
    );
    document.querySelectorAll("#gapSeg button").forEach(
      (b) => b.onclick = () => {
        RT.gapMin = +b.dataset.thr;
        retool();
      }
    );
    document.querySelectorAll("#planT button").forEach(
      (b) => b.onclick = () => {
        RT.planT = +b.dataset.t;
        retool();
      }
    );
    $("planN").oninput = () => {
      RT.planN = Math.max(1, Math.min(20, Math.round(+$("planN").value) || 1));
      $("planNv").textContent = String(RT.planN);
      retool();
    };
  }
  function respReset() {
    RT.pin = null;
    RT.focusStn = -1;
    memo = null;
    if (RT.tool === "gap" || RT.tool === "plan") S.layer = "chance";
    if (S.st) $("respHowTxt").textContent = respOf(S.st) ? howShort(S.st) : "";
  }
  function respClick(lon, lat, k) {
    if (RT.tool !== "near" || !S.st || !respOf(S.st)) return false;
    RT.pin = k >= 0 ? { lon, lat, k } : null;
    render();
    const cl = RT.pin && closestAt(S.st, k, lon, lat);
    if (cl && cl.rows.length && V.s < V.fit * 2.5) {
      const hx = hexState(S.st), xs = [lon * hx.K, ...cl.rows.map((s2) => hx.stn.X[s2.i])], ys = [lat, ...cl.rows.map((s2) => hx.stn.Y[s2.i])], p = hx.R * 2, f = fitView({ x0: Math.min(...xs) - p, x1: Math.max(...xs) + p, y0: Math.min(...ys) - p, y1: Math.max(...ys) + p });
      f.s = Math.min(f.s, V.fit * 24);
      flyTo(f, 800);
    }
    if (k < 0)
      $("respOut").insertAdjacentHTML("afterbegin", `<p class="hint">That spot is outside ${NAME[S.st]}. Click inside the state.</p>`);
    showOut();
    return true;
  }
  function respTip(k) {
    const r = S.st && respOf(S.st);
    if (!r || !RT.tool || k < 0) return "";
    const m = r.min10[3 * k];
    return `
From the hexagon's centre: nearest station ${km1(r.crow10[k] / 10)} km in a straight line` + (m >= 0 ? `, fastest drive ${mins(m / 10)} min` : ", no road link to a station") + (RT.tool === "near" ? "\nClick for the three closest stations" : "");
  }
  function drawResponse(c, sx2, sy2, R) {
    const st = S.st;
    if (!st || !respOf(st)) return;
    const hx = hexState(st), W = V.W, H = V.H, rr = R * 0.93, on = (x, y, m) => x > -m && y > -m && x < W + m && y < H + m;
    const hexP = (k, s2 = 1) => {
      const x = sx2(hx.X[k]), y = sy2(hx.Y[k]);
      if (!on(x, y, rr)) return false;
      c.beginPath();
      if (rr < 3.5) {
        c.arc(x, y, 3, 0, 7);
        return true;
      }
      for (let a = 0; a < 6; a++) {
        const t2 = Math.PI / 180 * (30 + 60 * a);
        a ? c.lineTo(x + rr * s2 * Math.cos(t2), y - rr * s2 * Math.sin(t2)) : c.moveTo(x + rr * s2 * Math.cos(t2), y - rr * s2 * Math.sin(t2));
      }
      c.closePath();
      return true;
    };
    const badge2 = (x, y, txt, fill, ink, r = 9) => {
      c.beginPath();
      c.arc(x, y, r, 0, 7);
      c.fillStyle = fill;
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = "rgba(0,0,0,.75)";
      c.stroke();
      c.fillStyle = ink;
      c.font = "600 11px 'JetBrains Mono',monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(txt, x, y + 0.5);
    };
    const station = (i, label) => {
      const x = sx2(hx.stn.X[i]), y = sy2(hx.stn.Y[i]);
      if (!on(x, y, 20)) return;
      c.fillStyle = STN_C;
      c.strokeStyle = "#fff";
      c.lineWidth = 1.6;
      c.beginPath();
      c.rect(x - 5.5, y - 5.5, 11, 11);
      c.fill();
      c.stroke();
      if (label) badge2(x + 13, y - 12, label, "#fff", "#04121c", 8.5);
    };
    c.save();
    c.setLineDash([]);
    if (RT.tool === "gap") {
      c.strokeStyle = GAP_C;
      c.lineWidth = R > 8 ? 2.4 : 2;
      for (const k of cur().gaps.list) if (hexP(k)) c.stroke();
    }
    if (RT.tool === "plan" && cur().risk.ptot) {
      const p = curPlan();
      c.strokeStyle = EMBER;
      c.lineWidth = 1.3;
      c.globalAlpha = 0.9;
      for (let k = 0; k < hx.n; k++) if (p.by[k] >= 0 && hexP(k, 0.9)) c.stroke();
      c.globalAlpha = 1;
      p.sites.forEach((s2, j) => {
        const x = sx2(hx.X[s2.k]), y = sy2(hx.Y[s2.k]);
        if (on(x, y, 12)) badge2(x, y, String(j + 1), EMBER, "#1b0c02", 10);
      });
    }
    if (RT.focusStn >= 0) {
      const m = focusArea();
      c.strokeStyle = "#fff";
      c.lineWidth = 1.8;
      for (let k = 0; k < hx.n; k++) if (m[k] && hexP(k)) c.stroke();
      station(RT.focusStn, "");
    }
    const t = RT.tool === "plan" ? null : respTarget(), cl = t && closestAt(st, t.k, t.lon, t.lat);
    if (t && cl) {
      const x0 = sx2(t.lon * hx.K), y0 = sy2(t.lat);
      c.setLineDash([6, 5]);
      for (const [col, lw] of [
        ["rgba(0,0,0,.6)", 3.6],
        ["rgba(255,255,255,.95)", 1.6]
      ]) {
        c.strokeStyle = col;
        c.lineWidth = lw;
        c.beginPath();
        for (const s2 of cl.rows) {
          c.moveTo(x0, y0);
          c.lineTo(sx2(hx.stn.X[s2.i]), sy2(hx.stn.Y[s2.i]));
        }
        c.stroke();
      }
      c.setLineDash([]);
      cl.rows.forEach((s2, j) => station(s2.i, String(j + 1)));
      c.beginPath();
      c.arc(x0, y0, 6.5, 0, 7);
      c.fillStyle = EMBER;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = "#fff";
      c.stroke();
    }
    c.restore();
  }

  // src/downloads.ts
  var selSlug = () => `${S.st}-${S.sel.type === "county" ? D.states[S.st].counties[S.sel.ci].name.replace(/\W+/g, "") : S.sel.type}`;
  async function save(filename, data, msg = $("dlMsg")) {
    try {
      const d = window.claude && await window.claude.use("downloads");
      if (d) {
        await d.save({ filename, data });
        msg.textContent = `Saved ${filename}.`;
        return;
      }
    } catch (e) {
      msg.textContent = "The download was declined.";
      return;
    }
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      msg.textContent = `Saved ${filename}.`;
    } catch (e) {
      msg.textContent = "Downloads are not available in this view.";
    }
  }
  var modisThrough = () => {
    const t = D.meta.modis_through;
    return t ? (t[0] - Y0) * 12 + t[1] - 1 : NM - 1;
  };
  var monthStatus = (i) => i <= FULL_I ? "complete" : i <= LAST_I ? `partial_to_${LAST_DATE}` : "no_data";
  function fillDates(i, st) {
    const f = fillDays(i, st), pre = `${Y0 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-`, iso = (d) => d.map((x) => pre + String(x).padStart(2, "0")).join(" ");
    return { n20: iso(f.n20), interp: iso(f.interp), any: f.n20.length + f.interp.length > 0 };
  }
  function csvCal() {
    const st = S.st, s2 = D.states[st], R = analyseFor(st, S.sel), mt = modisThrough(), whole2 = S.sel.type === "state", m26 = new Map((s2.y2026?.months ?? []).map((m) => [m.i, m])), gaps = new Map((s2.hist_gaps ?? []).map((g) => [g.i, g])), rows = [
      "year,month,month_status,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs_on_filled_days,noaa20_converted_snpp_terms,days_from_noaa20_converted,days_estimated_from_neighbours,median_for_calendar_month,ratio_to_median"
    ];
    R.ser.forEach((r) => {
      const f = fillDates(r.i, st), m = m26.get(r.i), g = gaps.get(r.i);
      let snpp = r.V, n20raw = "", n20conv = "";
      if (f.any && m) {
        snpp = whole2 ? m.snpp : "";
        n20raw = whole2 ? m.n20_raw : "";
        n20conv = whole2 ? m.n20_converted : "";
      } else if (f.any && g) {
        n20raw = whole2 ? g.n20_gap : "";
        n20conv = (r.h - (r.V - (whole2 ? g.snpp_gap : 0))).toFixed(2);
        if (!whole2) n20conv = "";
      }
      rows.push(
        [
          r.y,
          r.m + 1,
          monthStatus(r.i),
          r.h.toFixed(2),
          r.lo.toFixed(2),
          r.hi.toFixed(2),
          `"${f.any ? FILL_SRC : r.src}"`,
          r.i > mt ? "" : r.T,
          r.i > mt ? "" : r.A,
          snpp,
          n20raw,
          n20conv,
          f.n20,
          f.interp,
          Number.isFinite(r.med) ? r.med.toFixed(2) : "",
          r.med > 0 ? (r.h / r.med).toFixed(3) : ""
        ].join(",")
      );
    });
    save(`burn-calendar_${selSlug()}_${S.yFrom}-${S.yTo}.csv`, rows.join("\n"));
  }
  function csvHot() {
    const s2 = D.states[S.st], hx = hexState(S.st), mask = selMask(), cr = s2.hex_rows, mt = modisThrough(), gapHex = /* @__PURE__ */ new Map(), rows = [
      "hex_center_lat,hex_center_lon,county,year,month,month_status,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,harmonized_viirs_equivalent,source,days_from_noaa20_converted,days_estimated_from_neighbours"
    ];
    const gh = s2.gap_hex_rows ?? [];
    for (let p = 0; p < gh.length; p += 3) gapHex.set(gh[p] * NM + gh[p + 1], gh[p + 2]);
    const push = (k, i, T, A2, V5) => {
      const y = Y0 + Math.floor(i / 12);
      if (!mask[k] || y < S.yFrom || y > S.yTo) return;
      const h2 = harm(S.st, i, T, A2, V5), f = fillDates(i, S.st), dh = gapHex.get(k * NM + i) ?? 0;
      gapHex.delete(k * NM + i);
      rows.push(
        [
          hx.Y[k].toFixed(3),
          (hx.X[k] / hx.K).toFixed(3),
          `"${s2.counties[hx.c[k]].name}"`,
          y,
          i % 12 + 1,
          monthStatus(i),
          i > mt ? "" : T,
          i > mt ? "" : A2,
          /* Suomi NPP as observed; blank on 2026 months with days from NOAA-20, whose per-hexagon split is not kept */
          f.any && y >= 2026 ? "" : V5,
          Math.max(0, h2.h + dh).toFixed(2),
          `"${f.any ? FILL_SRC : h2.src}"`,
          f.n20,
          f.interp
        ].join(",")
      );
    };
    for (let p = 0; p < cr.length; p += 5) push(cr[p], cr[p + 1], cr[p + 2], cr[p + 3], cr[p + 4]);
    [...gapHex.keys()].forEach((key) => push(Math.floor(key / NM), key % NM, 0, 0, 0));
    save(`hotspots-hex_${selSlug()}_${S.yFrom}-${S.yTo}.csv`, rows.join("\n"));
  }
  var pm = (v) => (v / 1e3).toFixed(3);
  function pastShares(n, a, b, hit) {
    const o = new Float32Array(n * 12);
    for (let u = 0; u < n; u++)
      for (let m = 0; m < 12; m++) {
        let c = 0;
        for (let y = a; y <= b; y++) if (hit(u, (y - Y0) * 12 + m)) c++;
        o[u * 12 + m] = c / (b - a + 1);
      }
    return o;
  }
  function forecastHexRows(st = S.st, mask = selMask()) {
    const F2 = fcData(), hx = hexState(st), s2 = D.states[st], n = hx.n, any = F2[st].any.p, L2 = largeOf(st), LM = largeMarked(st), [a, b] = riskYears(), [la, lb] = largeYears(), nf = notFire(st), pa = pastShares(n, a, b, (k, i) => !nf[k] && hx.H[k * NM + i] > 0), pl = L2 && LM ? pastShares(n, la, lb, (k, i) => LM[k * NM + i] === 1) : null, rows = [
      `state,county,hex_id,hex_center_lat,hex_center_lon,year,month,p_any${L2 ? ",p_large" : ""},past_any_${a}_${b}${pl ? `,past_large_${la}_${lb}` : ""}`
    ];
    for (let k = 0; k < n; k++) {
      if (!mask[k]) continue;
      const head = `${st},"${s2.counties[hx.c[k]].name}",${k},${hx.Y[k].toFixed(4)},${(hx.X[k] / hx.K).toFixed(4)}`;
      FC_YEARS.forEach((y, yi) => {
        for (let m = 0; m < 12; m++) {
          const t = (yi * 12 + m) * n + k;
          rows.push(
            `${head},${y},${m + 1},${pm(any[t])}${L2 ? "," + pm(L2.p[t]) : ""},${pa[k * 12 + m].toFixed(3)}${pl ? "," + pl[k * 12 + m].toFixed(3) : ""}`
          );
        }
      });
    }
    return rows;
  }
  function forecastCountyRows(st = S.st, mask = selMask()) {
    const F2 = fcData(), hx = hexState(st), s2 = D.states[st], nc = s2.counties.length, hexAny = F2[st].any.p, any = F2[st].any.county.slice(), L2 = largeOf(st), [a, b] = riskYears(), [la, lb] = largeYears(), seen = new Uint8Array(nc), fire = new Uint8Array(nc * NM), big2 = new Uint8Array(nc * NM), cr = s2.county_rows;
    for (let k = 0; k < hx.n; k++) if (mask[k]) seen[hx.c[k]] = 1;
    for (let t = 0; t < 12 * FC_YEARS.length; t++)
      for (let k = 0; k < hx.n; k++) {
        const u = t * nc + hx.c[k];
        if (hexAny[t * hx.n + k] > any[u]) any[u] = hexAny[t * hx.n + k];
      }
    for (let p = 0; p < cr.length; p += 5) if (harm(st, cr[p + 1], cr[p + 2], cr[p + 3], cr[p + 4]).h > 0) fire[cr[p] * NM + cr[p + 1]] = 1;
    if (L2) {
      for (let p = 0; p < L2.past.county_rows.length; p += 4)
        if (L2.past.county_rows[p + 2] > 0) big2[L2.past.county_rows[p] * NM + L2.past.county_rows[p + 1]] = 1;
    }
    const pa = pastShares(nc, a, b, (c, i) => fire[c * NM + i] === 1), pl = L2 ? pastShares(nc, la, lb, (c, i) => big2[c * NM + i] === 1) : null, rows = [
      `state,county,fips,year,month,p_any${L2 && L2.county ? ",p_large" : ""},past_any_${a}_${b}${pl ? `,past_large_${la}_${lb}` : ""}`
    ];
    for (let c = 0; c < nc; c++) {
      if (!seen[c]) continue;
      FC_YEARS.forEach((y, yi) => {
        for (let m = 0; m < 12; m++) {
          const t = (yi * 12 + m) * nc + c;
          rows.push(
            `${st},"${s2.counties[c].name}",${s2.counties[c].fips},${y},${m + 1},${pm(any[t])}${L2 && L2.county ? "," + pm(L2.county[t]) : ""},${pa[c * 12 + m].toFixed(3)}${pl ? "," + pl[c * 12 + m].toFixed(3) : ""}`
          );
        }
      });
    }
    return rows;
  }
  function csvForecast() {
    if (!fcOn(S.st)) return;
    save(`forecast-hex_${selSlug()}_2026-2027.csv`, forecastHexRows().join("\n"));
  }
  function csvForecastCounty() {
    if (!fcOn(S.st)) return;
    save(`forecast-county_${selSlug()}_2026-2027.csv`, forecastCountyRows().join("\n"));
  }

  // src/outlook.ts
  var O = () => window.OUTLOOK;
  var olOn = (st) => !!O()?.states?.[st]?.base;
  var olData = () => O();
  var RARE = 0.03;
  var TIMEOUT_MS = 4e4;
  var CHUNK = 16;
  var SLOW_MS = 6e3;
  var KEEP_MS = 3 * 3600 * 1e3;
  var TZ = { NY: "America/New_York", CA: "America/Los_Angeles" };
  function stateToday(st) {
    try {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ[st], year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
        /* @__PURE__ */ new Date()
      ), v = (t) => p.find((x) => x.type === t)?.value || "";
      return `${v("year")}-${v("month")}-${v("day")}`;
    } catch {
      return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    }
  }
  var fresh = (st, at, today) => Date.now() - at < KEEP_MS && today >= stateToday(st);
  function doy365(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const j = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5);
    const leap = y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
    return leap && m > 2 ? j - 1 : j;
  }
  function countyOutlook(D2, S3, ci, today, rain, et0) {
    const T = D2.prior, H = D2.horizon;
    if (!/^\d{4}-\d\d-\d\d$/.test(today) || rain.length < T + H || et0.length < T + H) return null;
    let rain14 = 0, dry = 0, et14 = 0, rain30 = 0, et30 = 0;
    for (let i = 0; i < T + H; i++) {
      const rv = rain[i], ev = et0[i];
      if (typeof rv !== "number" || typeof ev !== "number" || !Number.isFinite(rv) || !Number.isFinite(ev)) return null;
      const r = Math.max(0, rv), e = Math.max(0, ev);
      if (i < T) {
        rain30 += r;
        et30 += e;
      } else {
        rain14 += r;
        et14 += e;
        if (r < D2.dry_mm) dry++;
      }
    }
    const base2 = S3.base[ci * 365 + doy365(today)] / 1e4;
    if (!(base2 > 0 && base2 < 1)) return null;
    const x = [Math.log(base2 / (1 - base2)), Math.log1p(rain14), dry / H, et14 / H, Math.log1p(rain30), (et30 - rain30) / T];
    let z = S3.coef[0];
    for (let j = 0; j < x.length; j++) z += S3.coef[j + 1] * x[j];
    const p = 1 / (1 + Math.exp(-z)), norm2 = 1 / (1 + Math.exp(-(S3.norm_coef[0] + S3.norm_coef[1] * x[0])));
    return { p, base: base2, ratio: p / base2, norm: norm2, wx_ratio: p / norm2, today };
  }
  function forecastUrl(st, cis, models) {
    const S3 = O().states[st], q = new URLSearchParams();
    q.set("latitude", cis.map((ci) => S3.pts[ci][0].toFixed(3)).join(","));
    q.set("longitude", cis.map((ci) => S3.pts[ci][1].toFixed(3)).join(","));
    for (const [k, v] of Object.entries(O().api.params)) if (k !== "models") q.set(k, String(v));
    q.set("models", models);
    return O().api.url + "?" + q.toString();
  }
  var runs = {};
  var busy = {};
  var olRun = (st) => runs[st] || null;
  var numArr = (a) => Array.isArray(a) ? a.map((v) => typeof v === "number" && Number.isFinite(v) ? v : null) : null;
  var WeatherError = class extends Error {
  };
  async function getDaily(st, cis, models) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT_MS), why = () => ac.signal.aborted ? `The weather service did not answer within ${TIMEOUT_MS / 1e3} seconds.` : navigator.onLine === false ? "You seem to be offline, so there is no weather forecast." : "The weather service could not be reached.";
    try {
      let r;
      try {
        r = await fetch(forecastUrl(st, cis, models), { signal: ac.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      } catch {
        throw new WeatherError(why());
      }
      if (!r.ok)
        throw new WeatherError(
          r.status === 429 ? "The weather service's free daily limit has been reached. Try again later." : `The weather service answered with an error (${r.status}).`
        );
      let j;
      try {
        j = await r.json();
      } catch {
        throw new WeatherError(ac.signal.aborted ? why() : "The weather service sent something that is not a forecast.");
      }
      const list4 = Array.isArray(j) ? j : [j];
      if (list4.length !== cis.length) throw new WeatherError("The weather service sent a forecast for the wrong number of places.");
      return list4.map((o) => o && typeof o === "object" && o.daily || {});
    } finally {
      clearTimeout(t);
    }
  }
  function work(st, ci, d) {
    const time = Array.isArray(d.time) ? d.time : null, rain = numArr(d.precipitation_sum), et0 = numArr(d.et0_fao_evapotranspiration);
    if (!time || !rain || !et0 || typeof time[O().prior] !== "string") return null;
    return countyOutlook(O(), O().states[st], ci, time[O().prior], rain, et0);
  }
  var addDays = (iso, n) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  var storeKey = (st) => `burn-outlook-v${O()?.v ?? 0}-${st}`;
  function fromStore(st) {
    try {
      const raw = localStorage.getItem(storeKey(st));
      if (!raw) return null;
      const s2 = JSON.parse(raw);
      if (!s2 || typeof s2.at !== "number" || !Array.isArray(s2.rows) || s2.rows.length !== O().states[st].pts.length) return null;
      const rows = s2.rows.map((r) => r ? { p: r[0], base: r[1], ratio: r[0] / r[1], norm: r[2], wx_ratio: r[0] / r[2], today: r[3] } : null), run = finish(rows, s2.fallback, s2.at);
      return run.status === "ok" && fresh(st, run.at, run.today) ? run : null;
    } catch {
      return null;
    }
  }
  function toStore(st, run) {
    try {
      const s2 = { at: run.at, fallback: run.fallback, rows: run.rows.map((r) => r ? [r.p, r.base, r.norm, r.today] : null) };
      localStorage.setItem(storeKey(st), JSON.stringify(s2));
    } catch {
    }
  }
  function finish(rows, fallback, at) {
    const first = rows.find((r) => r) || null, tally = /* @__PURE__ */ new Map();
    rows.forEach((r) => r && tally.set(r.today, (tally.get(r.today) || 0) + 1));
    const today = first ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] : "";
    return {
      status: first ? "ok" : "error",
      rows,
      today,
      end: today ? addDays(today, O().horizon - 1) : "",
      fallback,
      missing: rows.filter((r) => !r).length,
      at,
      err: first ? "" : "The weather service sent no usable forecast."
    };
  }
  function olLoad(st, done, force = false) {
    if (!olOn(st) || busy[st]) return;
    const have = runs[st], keep = have && have.status === "ok" && fresh(st, have.at, have.today) ? have : null;
    if (keep && (!force || !keep.missing)) return;
    if (!keep) {
      const stored = fromStore(st);
      if (stored) {
        runs[st] = stored;
        done();
        return;
      }
      runs[st] = { status: "loading", rows: [], today: "", end: "", fallback: 0, missing: 0, at: 0, err: "" };
      done();
    }
    const n = O().states[st].pts.length, want = Array.from({ length: n }, (_, i) => i).filter((ci) => !keep || !keep.rows[ci]);
    const slowT = setTimeout(() => {
      const cur2 = runs[st];
      if (cur2 && cur2.status === "loading") {
        cur2.slow = true;
        done();
      }
    }, SLOW_MS);
    busy[st] = (async () => {
      try {
        const chunks = [];
        for (let i = 0; i < want.length; i += CHUNK) chunks.push(want.slice(i, i + CHUNK));
        const got = await Promise.allSettled(chunks.map((c) => getDaily(st, c, String(O().api.params.models))));
        if (got.every((g) => g.status === "rejected")) throw got[0].reason;
        const rows = keep ? keep.rows.slice() : new Array(n).fill(null), answered = /* @__PURE__ */ new Set();
        got.forEach((g, j) => {
          if (g.status !== "fulfilled") return;
          chunks[j].forEach((ci, i) => {
            answered.add(ci);
            rows[ci] = work(st, ci, g.value[i]);
          });
        });
        let fallback = keep ? keep.fallback : 0;
        const gaps = want.filter((ci) => answered.has(ci) && !rows[ci]);
        if (gaps.length) {
          try {
            const fb = await getDaily(st, gaps, O().api.fallback_models);
            gaps.forEach((ci, j) => {
              const o = work(st, ci, fb[j]);
              if (o) {
                rows[ci] = o;
                fallback++;
              }
            });
          } catch {
          }
        }
        const run = finish(rows, fallback, keep ? keep.at : Date.now());
        const failed = got.find((g) => g.status === "rejected");
        if (failed && run.status === "ok") run.err = failed.reason instanceof WeatherError ? failed.reason.message : "";
        runs[st] = run;
        if (run.status === "ok" && !run.missing) toStore(st, run);
      } catch (e) {
        const err = e instanceof WeatherError ? e.message : "The outlook could not be worked out.";
        runs[st] = keep ? { ...keep, err } : { status: "error", rows: [], today: "", end: "", fallback: 0, missing: n, at: 0, err };
      } finally {
        clearTimeout(slowT);
        delete busy[st];
        done();
      }
    })();
  }

  // src/olui.ts
  var esc2 = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var pct2 = (x) => pctP(x, true);
  var ratioT = (r) => Math.max(-1, Math.min(1, Math.log2(r)));
  var RATIO_STOPS = [
    [0.5, "\xBD\xD7"],
    [0.71, "0.7\xD7"],
    [1, "no change"],
    [1.41, "1.4\xD7"],
    [2, "2\xD7+"]
  ];
  var raised = (o) => o.base >= RARE && o.wx_ratio >= 1.1;
  var lowered = (o) => o.base >= RARE && o.wx_ratio <= 0.9;
  var OM = `<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>`;
  var rowOf = (st, ci) => {
    const r = olRun(st);
    return r && r.status === "ok" ? r.rows[ci] || null : null;
  };
  var dayName = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  };
  var olRange = (st) => {
    const r = olRun(st);
    return r && r.today ? `${dayName(r.today)} \u2013 ${dayName(r.end)}, ${r.end.slice(0, 4)}` : "";
  };
  var weatherCue = (o) => o.wx_ratio >= 1.1 ? `weather pushes it up (${times(o.wx_ratio)})` : o.wx_ratio <= 0.9 ? `weather pulls it down (${times(o.wx_ratio)})` : "weather changes it little";
  var sayOutlook = (o) => `${pct2(o.p)} (usual for these dates ${pct2(o.base)})`;
  var skill = (st) => olData().states[st].metrics.backtest["full model (observed next 14 days)"];
  function olFill(st, ci) {
    const o = rowOf(st, ci);
    if (!o) return null;
    return { c: rgb(div(ratioT(o.wx_ratio))), a: o.base < RARE ? 0.32 : 0.86 };
  }
  function olTip(ci) {
    const st = S.st, r = olRun(st), o = rowOf(st, ci);
    if (!r || r.status === "loading") return "Getting the weather forecast\u2026";
    if (r.status !== "ok") return "No outlook: " + r.err;
    if (!o) return "No outlook here: the weather forecast had gaps for this county.";
    return `Next 14 days, ${olRange(st)}:
${pct2(o.p)} chance of at least one hotspot
Usual for these dates: ${pct2(o.base)}
` + (o.base >= RARE ? `The ${weatherCue(o)}, against the model's ${pct2(o.norm)} with no weather` : `Fire is rare here now, so the weather's effect is mostly noise`);
  }
  function olLegend() {
    const st = S.st, r = olRun(st), when = r && r.status === "ok" ? olRange(st) : "";
    $("legTitle").textContent = `Next 14 days${when ? ", " + when : ""}: how the weather forecast moves the chance of a hotspot`;
    if (!r || r.status !== "ok") {
      $("legSw").innerHTML = "";
      $("legCap").textContent = !r || r.status === "loading" || r.status === "idle" ? "Getting the weather forecast\u2026" : "No outlook data right now.";
      return;
    }
    let g = "";
    RATIO_STOPS.forEach(([v, lab], i) => {
      const x = 6 + i * 47;
      g += `<rect x="${x}" y="4" width="43" height="20" rx="3" fill="${rgb(div(ratioT(v)))}"/><text x="${x + 21.5}" y="40" text-anchor="middle">${lab}</text>`;
    });
    $("legSw").innerHTML = `<svg viewBox="0 0 244 46" role="img" aria-label="Blue counties: the weather lowers the chance; red: it raises it">${g}</svg>`;
    $("legCap").textContent = "Red: the weather forecast raises the chance of a hotspot, blue: it lowers it, against the model's chance for these dates with no weather. Faded: fire is rare here now (usual under 3%), so the effect is noisy. Weather: Open-Meteo.";
  }
  function renderOutlookBar() {
    const st = S.st, on = olOn(st), ol = S.layer === "outlook";
    $("layerSeg").querySelector('[data-layer="outlook"]').hidden = !on;
    $("olBar").hidden = !ol;
    if (!ol) return;
    const r = olRun(st), sk = skill(st);
    $("olRetry").hidden = !r || !(r.status === "error" || r.status === "ok" && r.missing > 0);
    $("olKey").hidden = !r || r.status !== "ok";
    if (!r || r.status === "loading" || r.status === "idle") {
      $("olNote").innerHTML = `<b>Next 14 days</b>: getting the weather forecast from ${OM}\u2026` + (r && r.slow ? " The weather service is slow right now; this can take up to half a minute." : "");
      return;
    }
    if (r.status === "error") {
      $("olNote").innerHTML = `<b>Next 14 days</b>: no outlook right now. ${esc2(r.err)} The rest of the page works without it.`;
      return;
    }
    const n = r.rows.length, up = r.rows.filter((o) => o && raised(o)).length, down = r.rows.filter((o) => o && lowered(o)).length;
    $("olNote").innerHTML = `<b>Next 14 days, ${olRange(st)}</b>: how the weather forecast moves each county's chance of at least one hotspot.<span class="more"> It raises the chance in ${up} of ${n} counties and lowers it in ${down}.</span> Tested with the weather that actually happened, it beat the usual odds by only ${(sk.bss * 100).toFixed(1)}%; real forecasts do less well. Weather: ${OM} (ECMWF).` + (r.missing ? ` No forecast for ${r.missing} ${r.missing === 1 ? "county" : "counties"}${r.err ? ": " + esc2(r.err) : "."}` : "");
  }
  function olCard() {
    const st = S.st, r = olRun(st);
    if (S.layer !== "outlook" || !olOn(st)) return null;
    if (!r || r.status !== "ok")
      return {
        q: "Next 14 days",
        v: r && r.status === "error" ? "No forecast" : "\u2026",
        title: r && r.status === "error" ? r.err : "Getting the weather forecast."
      };
    const sl = S.sel, hx = hexState(st), ci = sl.type === "county" ? sl.ci : sl.type === "hex" ? hx.c[sl.k] : -1;
    if (ci >= 0) {
      const o = r.rows[ci], cn = D.states[st].counties[ci].name;
      if (!o) return { q: `Next 14 days, ${cn}`, v: "No forecast", title: "The weather forecast had gaps for this county." };
      return {
        q: `Next 14 days, ${cn}`,
        v: o.base >= RARE ? `${pct2(o.p)}, weather ${times(o.wx_ratio)}` : pct2(o.p),
        title: `Chance of at least one hotspot in ${cn} County, ${olRange(st)}: ${sayOutlook(o)}. The ${weatherCue(o)} (the model gives ${pct2(o.norm)} with no weather). A small nudge on the usual odds, not a fire-danger rating.`
      };
    }
    const m = selMask(), touch = /* @__PURE__ */ new Set();
    for (let k = 0; k < hx.n; k++) if (m[k]) touch.add(hx.c[k]);
    const rows = [...touch].map((c) => r.rows[c]).filter((o) => !!o), up = rows.filter(raised).length;
    return {
      q: "Counties the weather raises, 14 days",
      v: `${up} of ${rows.length}`,
      title: `Counties where the weather forecast raises the chance of a hotspot over ${olRange(st)} by at least a tenth, against the model's chance for these dates with no weather (counties where fire is rare now are left out). Open the full data for the list.`
    };
  }
  var sortBy = "p";
  var showAll = false;
  var ROWS = [
    ["climatology", "The usual odds alone (the baseline)"],
    ["recalibrated climatology", "The usual odds, recalibrated: no weather at all"],
    ["climatology + past 30 days", "+ weather of the past 30 days (needs no forecast)"],
    ["past 30 days + observed next 7 days", "+ the next 7 days' weather, as it turned out"],
    ["full model (observed next 14 days)", "+ the next 14 days' weather, as it turned out: the model used here"]
  ];
  var yearsBetter = (s2) => {
    const v = Object.values(s2.bss_by_year);
    return `${v.filter((x) => x > 0).length} of ${v.length}`;
  };
  function renderOutlookSheet() {
    const st = S.st, on = olOn(st);
    $("olSec").hidden = !on;
    if (!on) return;
    const O2 = olData(), so = O2.states[st], bt = so.metrics.backtest, r = olRun(st), sk = skill(st);
    document.querySelectorAll("#olSort button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === sortBy)));
    $("olSort").hidden = $("olMore").hidden = $("olCsv").hidden = !r || r.status !== "ok";
    $("olRetryS").hidden = !r || !(r.status === "error" || r.status === "ok" && r.missing > 0);
    if (!r || r.status !== "ok") {
      $("olTitle").textContent = "Counties to watch in the next 14 days";
      $("olNoteS").textContent = !r || r.status === "loading" || r.status === "idle" ? "Getting the weather forecast from Open-Meteo\u2026" + (r && r.slow ? " The weather service is slow right now; this can take up to half a minute." : "") : `No outlook right now. ${r.err} Everything else on the page still works.`;
      $("olList").innerHTML = "";
    } else {
      const n = r.rows.length, rows = r.rows.map((o, ci) => ({ o, ci })).filter((x) => !!x.o), list4 = sortBy === "p" ? rows.sort((a, b) => b.o.p - a.o.p || b.o.wx_ratio - a.o.wx_ratio) : rows.filter((x) => x.o.base >= RARE).sort((a, b) => b.o.wx_ratio - a.o.wx_ratio || b.o.p - a.o.p), shown2 = showAll ? list4 : list4.slice(0, 9), up = rows.filter((x) => raised(x.o)).length, down = rows.filter((x) => lowered(x.o)).length;
      $("olTitle").textContent = `Counties to watch in the next 14 days: ${olRange(st)}`;
      $("olNoteS").textContent = `Each county's chance of at least one VIIRS hotspot from ${dayName(r.today)} through ${dayName(r.end)}, from its usual odds for these dates and Open-Meteo's weather forecast. The weather raises the chance in ${up} of ${n} counties and lowers it in ${down}, against the model's chance with no weather. ` + (r.missing ? `${r.missing} ${r.missing === 1 ? "county has" : "counties have"} no forecast this time${r.err ? " (" + r.err.charAt(0).toLowerCase() + r.err.slice(1).replace(/\.$/, "") + ")" : ""}; Retry asks again. ` : "") + (sortBy === "p" ? "Ranked by chance. " : `Ranked by how much the weather raises the chance; counties where fire is usually under ${Math.round(RARE * 100)}% at this time of year are left out, since there the effect is mostly noise. `) + "A hotspot is a satellite detection, often a farm or prescribed burn: this is not a fire-danger rating. Tap a county to see it on the map.";
      $("olList").innerHTML = shown2.map(
        ({ o, ci }, i) => `<button type="button" class="w" data-ci="${ci}"><span class="rk">${i + 1}</span><b>${esc2(D.states[st].counties[ci].name)}</b><span class="pc">${pct2(o.p)}</span><small>Usual for these dates ${pct2(o.base)}${o.base >= RARE ? ` \xB7 ${weatherCue(o)}` : " \xB7 fire is rare here now"}${popSuffix(st, ci)}</small></button>`
      ).join("");
      $("olMore").textContent = showAll ? "Show the top 9" : `Show all ${list4.length}`;
      $("olMore").hidden = list4.length <= 9;
    }
    $("olList").querySelectorAll(".w").forEach(
      (b) => b.onclick = () => {
        closeSheet();
        stopPlay();
        S.layer = "outlook";
        setCounty(+b.dataset.ci);
      }
    );
    $("olHow").innerHTML = `Each county's <b>usual chance</b> is how often VIIRS saw a hotspot there in the same 14-day window of the year, ${so.climatology.years[0]}\u2013${so.climatology.years[1]}. A small model (a logistic regression, fitted on ${so.metrics.years[0]}\u2013${so.metrics.years[so.metrics.years.length - 1]}) nudges it with ${OM}'s ECMWF weather: rain and drying over the past 30 days and the next 14, above all the number of dry days ahead. <b>The test is generous:</b> it gave the model the weather that actually happened, and even then it beat the usual odds by only ${(sk.bss * 100).toFixed(1)}%. A real forecast goes wrong, more so in the second week, so expect less; real forecasts were not tested, because Open-Meteo's archive of past forecasts was beyond its free daily limit. The usual odds and the model were built from data to ${so.climatology.years[1]} and are left as they were: the 2026 hotspots now on the calendar are not in them.`;
    const recal = bt["recalibrated climatology"], beyond = (s2) => recal ? 1 - (1 - s2.bss) / (1 - recal.bss) : null, sp = (x) => x == null ? "\u2013" : (x >= 0 ? "+" : "\u2212") + Math.abs(x * 100).toFixed(2) + "%";
    $("olTable").innerHTML = `<tr><th>Tested on ${so.metrics.years[0]}\u2013${so.metrics.years[so.metrics.years.length - 1]}, one year left out at a time</th><th>Brier</th><th>Against the usual odds</th><th>Against the recalibrated odds</th><th>AUC</th><th>Years better than usual</th></tr>` + ROWS.filter(([k]) => bt[k]).map(([k, lab]) => {
      const s2 = bt[k], base2 = k === "climatology", wx = !base2 && k !== "recalibrated climatology", last = k === ROWS[ROWS.length - 1][0];
      return `<tr><td class="u">${lab}</td><td>${s2.brier.toFixed(4)}</td><td>${base2 ? "\u2013" : sp(s2.bss)}</td><td class="${last ? "em" : ""}">${wx ? sp(beyond(s2)) : "\u2013"}</td><td>${s2.auc.toFixed(3)}</td><td>${base2 ? "\u2013" : yearsBetter(s2)}</td></tr>`;
    }).join("");
    const p30 = bt["climatology + past 30 days"], p30b = p30 ? beyond(p30) : null;
    $("olKeyS").textContent = `${NAME[st]}: ${so.metrics.rows.toLocaleString("en-US")} county-days, ${Math.round(so.metrics.events / so.metrics.rows * 100)}% with a hotspot in the 14 days that followed. Part of every gain over the usual odds needs no weather: refitting the usual odds alone (the second row) already helps. That refit is the model's chance with no weather, which the map compares against, so the map shows the weather's own effect. ` + (p30b != null && p30b <= 1e-3 ? `Here the past 30 days of weather add nothing beyond that refit (${sp(p30b)}); all the weather's skill is in the days ahead. ` : "") + "Brier: the average squared gap between the chance given and what happened; lower is better. Against the usual or the recalibrated odds: the Brier skill score against that row. AUC: how often a county-window with a hotspot got a higher chance than one without; 0.5 is a coin toss. We expect the live outlook to land between the past-30-days row, which needs no forecast, and the last; that was not tested.";
    $("olSrc").innerHTML = `Weather: ${OM} forecast API, ECMWF IFS 0.25\xB0 model${r && r.status === "ok" && r.fallback ? `, with Open-Meteo's best-match model for ${r.fallback} ${r.fallback === 1 ? "county" : "counties"} where ECMWF had gaps` : ""} (data CC BY 4.0)` + (r && r.status === "ok" ? `, fetched at ${new Date(r.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "") + `. Model trained on ERA5 reanalysis from the Open-Meteo archive. Hotspots: NASA FIRMS, VIIRS (Suomi NPP).`;
  }
  function csvOutlook() {
    const st = S.st, r = olRun(st);
    if (!r || r.status !== "ok") return;
    const rows = ["state,county,fips,first_day,last_day,chance_any_hotspot,usual_chance,chance_without_weather,weather_ratio,ratio_to_usual"];
    r.rows.forEach((o, ci) => {
      const c = D.states[st].counties[ci];
      rows.push(
        [
          st,
          `"${c.name}"`,
          c.fips,
          o ? o.today : "",
          o ? r.end : "",
          o ? o.p.toFixed(4) : "",
          o ? o.base.toFixed(4) : "",
          o ? o.norm.toFixed(4) : "",
          o ? o.wx_ratio.toFixed(3) : "",
          o ? o.ratio.toFixed(3) : ""
        ].join(",")
      );
    });
    save(`outlook-14day_${st}_${r.today}.csv`, rows.join("\n"), $("olMsg"));
  }
  function olStart(st, force = false) {
    olLoad(st, () => S.st === st && render(), force);
  }
  function olEvents() {
    const retry = () => S.st && olStart(S.st, true);
    $("olRetry").onclick = retry;
    $("olRetryS").onclick = retry;
    document.querySelectorAll("#olSort button").forEach(
      (b) => b.onclick = () => {
        sortBy = b.dataset.sort === "ratio" ? "ratio" : "p";
        render();
      }
    );
    $("olMore").onclick = () => {
      showAll = !showAll;
      render();
    };
    $("olCsv").onclick = csvOutlook;
  }

  // src/sheet.ts
  function renderArea(R) {
    $("shTitle").textContent = placeName();
    $("shCrumb").textContent = (S.sel.type === "state" ? "State" : NAME[S.st]) + ` \xB7 ${span(S.yFrom, S.yTo)}`;
    const ytd = ytdFor(R, S.st, S.sel);
    $("shLead").textContent = leadText(R, ytd);
    if (R.total === 0) {
      $("a1").textContent = $("a2").textContent = "None";
      $("a1n").textContent = $("a2n").textContent = "";
    } else {
      const top2 = R.order.slice(0, 3);
      $("a1").textContent = top2.map((o) => MON[o.m]).join(", ");
      $("a1n").textContent = `These three months hold ${Math.round(top2.reduce((a, o) => a + o.sum, 0) / R.total * 100)}% of all hotspots. ${MONL[R.order[11].m]} is the quietest.`;
      $("a2").textContent = R.ranked.slice(0, 3).map((y) => y.y).join(", ");
      $("a2n").textContent = R.ranked.slice(0, 3).map((y) => `${y.y}: ${fmt(y.h)}${y.y < 2012 ? " (converted)" : ""}`).join(" \xB7 ") + `. An average year has ${fmt(R.mean)}.` + (R.partYear ? ` ${R.partYear.y} is left out until it is over.` : "") + (ytd ? ` ${ytd.y} so far: ${fmt(ytd.cur)} for ${ytd.span}, ${rankWords(ytd.rank, ytd.n)} for the same dates.` : "");
    }
    const v = verdict(R, S.focus, sameDaysFor(S.st, S.sel)), fi = (S.focus[0] - Y0) * 12 + S.focus[1];
    $("fM").value = String(S.focus[1]);
    $("fY").value = String(S.focus[0]);
    if (!v) {
      $("a3").textContent = fi > LAST_I ? "No data yet" : "Outside the chosen years";
      $("a3n").textContent = fi > LAST_I ? `The record runs to ${LAST_WORDS}.` : "";
    } else if (v.noSame) {
      $("a3").innerHTML = `<span class="pill">${v.label}</span>`;
      $("a3n").textContent = `${fmt(v.f.h)} hotspots in ${MONL[v.fm]} ${v.fy} so far, to ${LAST_WORDS}. A part month cannot be set against whole months. The same days of past years are kept for the whole state and each county: choose one of them to test it.`;
    } else if (v.same && v.same.cur === 0 && v.same.past.every((x) => x === 0)) {
      $("a3").textContent = "No hotspots";
      $("a3n").textContent = `No hotspots in ${v.same.span} in any year from ${v.same.years[0]}, so there is nothing to compare.`;
    } else if (v.same) {
      const sd = v.same;
      $("a3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
      $("a3n").textContent = `${MONL[v.fm]} ${v.fy} is not over: ${fmt(sd.cur)} hotspots in ${sd.span}` + (sd.hi - sd.lo >= 1 ? ` (likely ${fmt(sd.lo)} to ${fmt(sd.hi)})` : "") + `, against a normal ${fmt(sd.med)} for the same days of ${sd.years[0]}\u2013${sd.years[sd.years.length - 1]}. Rank ${v.rank} of ${v.n} years. Most of these days are from NOAA-20, converted to Suomi NPP terms` + (D.states[S.st].partial?.filled_years?.length ? `; the days Suomi NPP missed in ${D.states[S.st].partial.filled_years.join(", ")} are filled the same way.` : ".");
    } else {
      $("a3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
      $("a3n").textContent = `${fmt(v.f.h)} hotspots against a normal ${fmt(v.med)}. Rank ${v.rank} of ${v.n} years.` + (v.f.i < VI0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : fillNote(v.f.i, S.st) ? ` Seen by VIIRS: Suomi NPP, with ${fillNote(v.f.i, S.st)}.` : " Seen directly by VIIRS.");
    }
    const rk = riskFor(R, S.rm), mo = MONL[S.rm];
    $("rmSheet").value = String(S.rm);
    $("a4").textContent = rk.n ? `${Math.round(rk.p * 100)}%` : "No data";
    $("a4n").textContent = rk.n ? `Fire was detected here in ${rk.k} of the ${rk.n} ${mo}s from ${rk.a} to ${rk.b}.` + (rk.k ? ` When it burns, typically ${fmt(rk.typical)} hotspots; the worst was ${fmt(rk.worst.h)} in ${rk.worst.y}. Most recent: ${rk.last}.` : "") + " History, not a forecast." + notFireNote(S.st, selMask()) + forecastLine(S.st) : "";
    const share2 = (x) => x >= 0.095 ? Math.round(x * 100) + "%" : x >= 1e-3 ? (x * 100).toFixed(1) + "%" : x > 0 ? "<0.1%" : "0%", who = window.RESPONSE ? "Counties, and the stations that reach each place first by road," : "Counties";
    let watched;
    if (isFc() && fcOn(S.st)) {
      const yr = S.odds;
      $("watchTitle").textContent = `Where to watch in ${mo} ${yr}: forecast`;
      $("watchNote").textContent = `${who} ranked by their share of ${NAME[S.st]}'s forecast fire risk for ${mo} ${yr}: each hexagon counts by its chance of at least one hotspot. The forecast is built from fire history alone, not weather, and says nothing about how each station is staffed. Tap one to see it on the map.`;
      const wl = countyRiskFc(S.st, S.rm, yr).slice(0, 8);
      watched = wl.map((w) => w.ci);
      $("watch").innerHTML = wl.map(
        (w, i) => `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${share2(w.share)}</span><small>Chance of fire somewhere in the county ${pctP(w.p)} \xB7 about ${w.e < 10 ? w.e.toFixed(1) : fmt(w.e)} of its hexagons expected to burn${popSuffix(S.st, w.ci)}</small></button>`
      ).join("");
    } else {
      const wl = countyRisk(S.st, S.rm).slice(0, 8);
      watched = wl.map((w) => w.ci);
      $("watchTitle").textContent = `Where to watch in ${mo}: past odds`;
      $("watchNote").textContent = `${who} ranked by how often fire comes to their hexagons in ${mo}, ${rk.a}\u2013${rk.b}: each hexagon counts by its share of years with a hotspot, so a place that burns most years outweighs one huge fire. The percentage is their share of ${NAME[S.st]}'s. This is the historical pattern, not a forecast for this year. Hotspots are what satellites saw burning, not calls or incidents, and this says nothing about how a station is staffed. Tap one to see it on the map.`;
      $("watch").innerHTML = wl.map(
        (w, i) => `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${share2(w.share)}</span><small>Fire in ${w.k} of ${w.n} ${mo}s \xB7 about ${w.e < 10 ? w.e.toFixed(1) : fmt(w.e)} of its hexagons burn in an average ${mo} \xB7 about ${fmt(w.mean)} hotspots${popSuffix(S.st, w.ci)}</small></button>`
      ).join("");
    }
    const wp = popSentence(S.st, watched, (n) => n === 1 ? "This county" : `These ${n} counties`), sp = popState(S.st);
    $("watchPop").hidden = !wp;
    $("watchPop").textContent = wp + (wp && sp != null ? ` ${NAME[S.st]} as a whole has ${fmtPop(sp)}.` : "");
    renderForecastSheet();
    renderStaff();
    renderOutlookSheet();
    $("watch").querySelectorAll(".w").forEach(
      (b) => b.onclick = () => {
        closeSheet();
        S.layer = "chance";
        setCounty(+b.dataset.ci);
      }
    );
    const sh = S.show, ys = R.years, xs = ys.map((y) => y.y), pick2 = (show) => {
      stopPlay();
      S.layer = "count";
      S.show = show;
      render();
    };
    bars(
      $("chMonths"),
      MON,
      R.stats.map((z) => z.med),
      {
        aria: "Typical hotspots by calendar month",
        sel: sh.t === "cmonth" ? sh.m : -1,
        lo: R.stats.map((z) => z.q1),
        hi: R.stats.map((z) => z.q3),
        whisk: () => true,
        tip: (m) => `${MONL[m]}
Typical: ${fmt(R.stats[m].med)} hotspots
Half of years fall between ${fmt(R.stats[m].q1)} and ${fmt(R.stats[m].q3)}`,
        click: (m) => pick2(sh.t === "cmonth" && sh.m === m ? { t: "all" } : { t: "cmonth", m })
      }
    );
    const top = [];
    ys.map((y, i) => [y.part ? 0 : y.h, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).forEach((a) => {
      if (a[0] > 0 && !top.some((i) => Math.abs(i - a[1]) < 2)) top.push(a[1]);
    });
    bars(
      $("chYears"),
      xs,
      ys.map((y) => y.h),
      {
        aria: "Hotspots per year",
        step: Math.ceil(xs.length / 9),
        sel: sh.t === "year" ? sh.y - S.yFrom : -1,
        avg: R.mean,
        top,
        hatch: (i) => xs[i] < 2012,
        part: (i) => !!ys[i].part,
        lo: ys.map((y) => y.lo),
        hi: ys.map((y) => y.hi),
        whisk: (i) => xs[i] < 2012,
        tip: (i) => ys[i].part ? `${xs[i]} so far, to ${LAST_WORDS}: ${fmt(ys[i].h)} hotspots
The year is not over, so it is not set against whole years` + (ytd ? `
${ytd.span}: ${rankWords(ytd.rank, ytd.n)} for the same dates` : "") : `${xs[i]}: ${fmt(ys[i].h)} hotspots
${R.mean > 0 ? (ys[i].h >= R.mean ? "+" : "") + Math.round((ys[i].h / R.mean - 1) * 100) + "% against the average year" : ""}` + (xs[i] < 2012 ? `
Converted from MODIS, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "\nSeen by VIIRS"),
        click: (i) => pick2(sh.t === "year" && sh.y === xs[i] ? { t: "all" } : { t: "year", y: xs[i] })
      }
    );
    calendarInto($("cal"), R, {
      mode: S.mode,
      focus: true,
      click: (r) => {
        stopPlay();
        S.focus = [r.y, r.m];
        S.layer = "count";
        S.show = { t: "ym", y: r.y, m: r.m };
        render();
      }
    });
    $("calNote").textContent = (S.mode === "count" ? "Every month of every year, newest at the top. Brighter means more hotspots. Tap a month to test whether it was unusual and to put it on the map." : "Red months ran above what is normal for that month, blue months below. Tap a month to test it.") + (R.partYear ? ` The record runs to ${LAST_WORDS}: the dashed month is not over and is compared with the same days of past years, and later months are blank, not zero. Months marked \xB7 have days filled from NOAA-20.` : "");
    paintRamp("calRamp", S.mode === "count" ? seq : (t) => div(t * 2 - 1));
    $("calLo").textContent = S.mode === "count" ? "fewer" : "\u215B\xD7 normal";
    $("calHi").textContent = S.mode === "count" ? "more (log scale)" : "8\xD7 normal";
    const fy = ys.filter((y) => !y.part), fx = fy.map((y) => y.y);
    lines(
      $("chSeam"),
      fx,
      [
        { v: fy.map((y) => y.naive), c: "#6fa8ff" },
        { v: fy.map((y) => y.h), c: "#ff8a3d" }
      ],
      {
        W: 660,
        vline: fx.indexOf(2012),
        aria: "Raw joined counts against the harmonized record",
        tip: (i) => `${fx[i]}
Harmonized: ${fmt(fy[i].h)}
Raw counts: ${fmt(fy[i].naive)}`
      }
    );
    const avg = (a, b, k) => {
      const r = ys.filter((y) => y.y >= a && y.y <= b);
      return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
    };
    const n0 = avg(2007, 2011, "naive"), n1 = avg(2012, 2016, "naive"), h0 = avg(2007, 2011, "h"), h1 = avg(2012, 2016, "h");
    $("seamNote").textContent = n0 && h0 && n1 != null && h1 != null && S.sel.type === "state" ? `Raw counts make 2012\u20132016 look ${(n1 / n0).toFixed(1)}\xD7 busier than 2007\u20132011. In the harmonized record the step is ${(h1 / h0).toFixed(1)}\xD7.` : "The blue line jumps in 2012 only because the sensor changed. Choose the whole state and all years to measure the step.";
    const s2 = D.states[S.st], val = s2.val, pc4 = (x) => Math.round(x * 100) + "%";
    $("tiles").innerHTML = `<div class="tile"><b>${val.raw_factor.toFixed(1)}\xD7</b><span>more hotspots from VIIRS than MODIS for the same fires in ${NAME[S.st]}</span></div><div class="tile"><b>${pc4(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div><div class="tile"><b>${pc4(val.annual_max_err)}</b><span>error in the worst tested year</span></div>`;
    $("maskTxt").textContent = `${s2.mask.static_sites} sites removed in ${NAME[S.st]}.`;
    $("satRule").textContent = SAT_RULE;
    $("rates").innerHTML = `<tr><th>Rate</th>${MON.map((m) => `<th>${m}</th>`).join("")}</tr><tr><td>Terra+Aqua</td>${s2.r_ta.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr><tr><td>Terra only</td>${s2.r_t.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
    $("mapNote").hidden = sh.t === "all" || S.layer === "chance";
    $("mapNoteTxt").textContent = "The map behind now shows: " + showLabel().toLowerCase() + ".";
  }
  function cmpStats(st) {
    const R = analyseFor(st, { type: "state" }), s2 = D.states[st], tot = new Float64Array(s2.counties.length), i0 = (S.yFrom - Y0) * 12, i1 = R.partYear && R.ranked.length && !R.ranked[0].part ? Math.min((S.yTo - Y0 + 1) * 12, (R.partYear.y - Y0) * 12) : (S.yTo - Y0 + 1) * 12, rows = s2.county_rows;
    for (let p = 0; p < rows.length; p += 5) {
      const i = rows[p + 1];
      if (i >= i0 && i < i1) tot[rows[p]] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
    }
    let k = 0;
    for (let c = 1; c < tot.length; c++) if (tot[c] > tot[k]) k = c;
    let acc = 0, season2 = 0;
    for (const o of R.order) {
      if (acc >= 0.8 * R.total) break;
      acc += o.sum;
      season2++;
    }
    return {
      st,
      R,
      mean: R.mean,
      dens: R.mean / LAND_KM2[st] * 1e3,
      peak: R.order[0].m,
      season: season2,
      worst: R.ranked[0],
      worstX: R.mean ? R.ranked[0].h / R.mean : 0,
      county: s2.counties[k].name,
      countyShare: R.total ? tot[k] / R.total : 0,
      ytd: ytdFor(R, st, { type: "state" })
    };
  }
  function renderCompare() {
    const C = STS.map(cmpStats), big2 = C.slice().sort((a, b) => b.mean - a.mean)[0], small = C.find((c) => c !== big2);
    $("shTitle").textContent = STS.map((k) => NAME[k]).join(" and ");
    $("shCrumb").textContent = `Compare states \xB7 ${span(S.yFrom, S.yTo)}`;
    $("cmpLead").textContent = small.mean > 0 ? `${NAME[big2.st]} records about ${Math.round(big2.mean / small.mean)} times as many fire hotspots as ${NAME[small.st]} in an average year, and ${Math.round(big2.dens / small.dens)} times as many for its size. ${NAME[small.st]} burns mostly in ${MONL[small.peak]}; ${NAME[big2.st]} in ${MONL[big2.peak]}.` : "";
    const rowsDef = [
      ["Hotspots in an average year", (c) => fmt(c.mean), (c) => c.mean, ""],
      ["Per 1,000 km\xB2 of land, per year", (c) => fmt(c.dens), (c) => c.dens, ""],
      ["Busiest month", (c) => MONL[c.peak], null, (c) => `${Math.round(c.R.order[0].sum / c.R.total * 100)}% of the year's hotspots`],
      ["Months that hold 80% of the fire", (c) => c.season + (c.season === 1 ? " month" : " months"), (c) => c.season, ""],
      [
        "Worst year",
        (c) => String(c.worst.y),
        (c) => c.worstX,
        (c) => `${times(c.worstX)} an average year${c.worst.y < 2012 ? " (converted)" : ""}`
      ],
      ["Most active county", (c) => c.county, null, (c) => `${Math.round(c.countyShare * 100)}% of the state's hotspots`]
    ];
    if (STS.every((st) => popState(st) != null))
      rowsDef.push(["Population", (c) => fmtPop(popState(c.st)), (c) => popState(c.st), () => popWhen()]);
    if (C.every((c) => c.ytd))
      rowsDef.push([
        `${C[0].ytd.y} so far (${C[0].ytd.span})`,
        (c) => fmt(c.ytd.cur),
        (c) => c.ytd.med > 0 ? c.ytd.cur / c.ytd.med : 0,
        (c) => `${c.ytd.med > 0 ? times(c.ytd.cur / c.ytd.med) + " the typical " + c.ytd.span + ", " : ""}${rankWords(c.ytd.rank, c.ytd.n)} for the same dates`
      ]);
    let h2 = `<div class="sh"></div>` + C.map((c) => `<div class="sh"><i style="background:${STC[c.st]}"></i>${NAME[c.st]}</div>`).join("");
    for (const [label, val, num4, sub] of rowsDef) {
      const mx = num4 ? Math.max(...C.map(num4)) : 0;
      h2 += `<div class="sl">${label}</div>` + C.map(
        (c) => `<div class="sv"><b>${val(c)}</b>${sub ? `<small>${sub(c)}</small>` : ""}${num4 ? `<div class="bar" style="width:${mx ? Math.max(0.5, num4(c) / mx * 100) : 0}%;background:${STC[c.st]}"></div>` : ""}</div>`
      ).join("");
    }
    $("score").innerHTML = h2;
    const key = C.map((c) => `<span><i style="background:${STC[c.st]};height:3px"></i>${NAME[c.st]}</span>`).join("");
    $("cmpKey1").innerHTML = $("cmpKey2").innerHTML = key;
    const share2 = (c) => c.R.stats.map((z) => c.R.total ? z.sum / c.R.total * 100 : 0), idx = (c) => c.R.years.filter((y) => !y.part).map((y) => c.mean ? y.h / c.mean : 0), xs = C[0].R.years.filter((y) => !y.part).map((y) => y.y);
    lines(
      $("chCmpMonths"),
      MON,
      C.map((c) => ({ name: NAME[c.st], c: STC[c.st], v: share2(c) })),
      {
        W: 560,
        h: 250,
        labels: true,
        every: 12,
        fy: (v) => Math.round(v) + "%",
        aria: "Share of yearly hotspots by month, by state",
        tip: (m) => MONL[m] + "\n" + C.map((c) => `${NAME[c.st]}: ${share2(c)[m].toFixed(1)}% of its year`).join("\n")
      }
    );
    lines(
      $("chCmpYears"),
      xs,
      C.map((c) => ({ name: NAME[c.st], c: STC[c.st], v: idx(c) })),
      {
        W: 560,
        h: 250,
        labels: true,
        base: 1,
        every: 9,
        fy: (v) => v + "\xD7",
        aria: "Each year against the state's own average",
        tip: (i) => xs[i] + "\n" + C.map((c) => `${NAME[c.st]}: ${times(idx(c)[i])} its average (${fmt(c.R.years[i].h)} hotspots)`).join("\n")
      }
    );
    $("twoCal").innerHTML = C.map(
      (c) => `<div><h4><span>${NAME[c.st]}</span><button class="link" type="button" data-open="${c.st}">Open ${NAME[c.st]}</button></h4><div class="cal compact" id="cal${c.st}"></div></div>`
    ).join("");
    C.forEach((c) => calendarInto($("cal" + c.st), c.R, { compact: true, mode: "count" }));
    $("twoCal").querySelectorAll("[data-open]").forEach(
      (b) => b.onclick = () => {
        closeSheet(true);
        location.hash = SLUG[b.dataset.open];
      }
    );
    $("mapNote").hidden = true;
  }
  function openSheet(tab) {
    S.sheet = tab;
    const w = $("sheetWrap");
    w.hidden = false;
    $("tabs").hidden = !S.st;
    $("tabArea").textContent = S.st ? placeName() : "";
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
    $("paneArea").hidden = tab !== "area";
    $("paneCmp").hidden = tab !== "compare";
    $("sheet").scrollTop = 0;
    render();
    if (tab === "area" && S.st) olStart(S.st);
    $("shClose").focus();
  }
  function closeSheet(silent) {
    if (!S.sheet) return;
    S.sheet = null;
    $("sheetWrap").hidden = true;
    hideTip();
    if (!silent && location.hash === "#compare") location.hash = "";
  }

  // src/play.ts
  var playT = null;
  function stopPlay() {
    if (playT) {
      clearInterval(playT);
      playT = null;
    }
    $("playMap").textContent = "\u25B6";
  }
  function startPlay() {
    closeSheet();
    S.layer = "count";
    let y = S.show.t === "year" && S.show.y < S.yTo ? S.show.y + 1 : S.yFrom;
    const tick = () => {
      if (y > S.yTo) {
        stopPlay();
        return;
      }
      S.show = { t: "year", y };
      render();
      y++;
    };
    $("playMap").textContent = "\u25A0";
    tick();
    playT = setInterval(tick, reduced ? 1300 : 750);
  }
  var togglePlay = () => playT ? stopPlay() : startPlay();

  // src/fcui.ts
  var esc3 = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var NY_WHY = "The large-fire switch is California only: it needs official fire boundary maps, which this site has only from CAL FIRE.";
  var verdictWord = (s2) => s2 >= 0.1 ? "clearly better than" : s2 >= 0.02 ? "modestly better than" : s2 > 5e-3 ? "slightly better than" : s2 > -5e-3 ? "about the same as" : "worse than";
  var largeSkill2 = (b) => 1 - b.model.brier / b.history_alone.brier;
  var runsLow = (st) => {
    const b = fcData().backtest[st].hex.model;
    return 1 - b.mean_p / b.base_rate;
  };
  function renderOdds() {
    const st = S.st, ch = S.layer === "chance", fc = fcOn(st), L2 = largeOf(st);
    $("oddsBar").hidden = !ch;
    $("playMap").hidden = $("tlMain").hidden = S.layer !== "count";
    ["oddsSeg", "oddsSheet"].forEach(
      (id) => document.querySelectorAll(`#${id} button`).forEach((b) => {
        b.hidden = b.dataset.odds !== "past" && !fc;
        b.setAttribute("aria-pressed", String(b.dataset.odds === String(S.odds)));
      })
    );
    $("oddsSheet").hidden = !fc;
    $("fireSeg").hidden = !L2;
    document.querySelectorAll("#fireSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fire === S.fire)));
    if (!ch) return;
    const big2 = S.fire === "large", F2 = fcData(), mo = MONL[S.rm];
    let h2;
    if (isFc()) {
      const bt = F2.backtest[st].hex, low = runsLow(st);
      h2 = big2 ? `<b>Forecast for ${monthWhen()}</b>: chance a large fire starts and reaches each hexagon, from fire history alone, not weather.<span class="more"> It picks out the likelier places and months better than past odds but cannot tell a big fire year from a quiet one.</span>` : `<b>Forecast for ${monthWhen()}</b>: chance of at least one hotspot, from fire history alone, not weather.<span class="more"> Tested on 2018\u20132025, ${verdictWord(bt.brier_skill_vs_history)} past odds.</span>` + (low > 0.1 ? ` In tests it ran ${Math.round(low * 100)}% low overall.` : "");
      if (S.odds === 2027 && fcSame(st, big2 ? "large" : "any"))
        h2 += ` <span class="more">The 2027 map equals 2026's: the model found no trend to carry forward here.</span>`;
    } else if (big2) {
      const [a, b] = largeYears();
      h2 = `<b>Past odds of a large fire</b> (1,000+ acres)<span class="more"> on CAL FIRE's fire perimeter maps</span> in ${mo}, ${a}\u2013${b}. History, not a forecast.`;
    } else {
      const [a, b] = riskYears();
      h2 = `<b>Past odds</b>: share of ${mo}s ${a < b ? `${a}\u2013${b}` : a} with a hotspot<span class="more">, complete years only</span>. History, not a forecast.`;
    }
    if (!L2) h2 += ` <span title="${esc3(NY_WHY)}">Large fires: California only.</span>`;
    $("oddsNote").innerHTML = h2;
    $("oddsNote").title = L2 ? "" : NY_WHY;
  }
  function chanceCard(R) {
    const st = S.st, sl = S.sel, mo = MON[S.rm], big2 = S.fire === "large" && !!largeOf(st);
    if (!isFc() || !fcOn(st)) {
      if (big2) {
        const [a, b] = largeYears(), r = pastLargeIn(st, selMask(), S.rm, a, b);
        return {
          q: `Large fire in ${mo}, past`,
          v: pctP(r.k / r.n, true),
          title: `A large fire (1,000+ acres) started and reached this area in ${r.k} of the ${r.n} ${MONL[S.rm]}s ${a}\u2013${b}. History, not a forecast.`
        };
      }
      const rk = riskFor(R, S.rm);
      return {
        q: `Chance of fire in ${mo}`,
        v: rk.n ? Math.round(rk.p * 100) + "%" : "n/a",
        title: `Share of the ${MONL[S.rm]}s ${rk.a}\u2013${rk.b} with a hotspot here. History, not a forecast.${notFireNote(st, selMask())}`
      };
    }
    const year = S.odds, fire = big2 ? "large" : "any", w = fcHex(st, fire, year, S.rm), what = big2 ? "a large fire" : "fire", q = `${big2 ? "Large fire" : "Fire"}, ${mo} ${year} forecast`;
    if (sl.type === "hex")
      return { q, v: pctP(w[sl.k]), title: `Forecast chance of ${what} in this hexagon in ${MONL[S.rm]} ${year}, from fire history alone.` };
    if (sl.type === "county") {
      const c = fcHex(st, fire, year, S.rm, true), hx = hexState(st);
      let top = 0;
      for (let k = 0; k < hx.n; k++) if (hx.c[k] === sl.ci && w[k] > top) top = w[k];
      return {
        q,
        v: pctP(Math.max(c ? c[sl.ci] : 0, top)),
        title: `Forecast chance of ${what} somewhere in the county in ${MONL[S.rm]} ${year}, from fire history alone.`
      };
    }
    const m = selMask();
    let s2 = 0, n = 0;
    for (let k = 0; k < w.length; k++)
      if (m[k]) {
        s2 += w[k];
        n++;
      }
    return {
      q: `Hexagons with ${big2 ? "large " : ""}fire, ${mo} ${year}`,
      v: "\u2248 " + (s2 < 10 ? s2.toFixed(1) : fmt(s2)),
      title: `Expected number of the ${fmt(n)} hexagons here with ${big2 ? "a large fire" : "at least one hotspot"} in ${MONL[S.rm]} ${year}: the sum of their forecast chances.` + (!big2 && runsLow(st) > 0.1 ? ` In tests ${NAME[st]} totals ran about ${Math.round(runsLow(st) * 100)}% low, so this is probably too low.` : "")
    };
  }
  function forecastLine(st) {
    if (!fcOn(st)) return "";
    const sl = S.sel, hx = hexState(st), mo = MONL[S.rm], val = (y) => {
      const w = fcHex(st, "any", y, S.rm);
      if (sl.type === "hex") return pctP(w[sl.k]);
      if (sl.type === "county") {
        const c = fcHex(st, "any", y, S.rm, true);
        let top = 0;
        for (let k = 0; k < hx.n; k++) if (hx.c[k] === sl.ci && w[k] > top) top = w[k];
        return pctP(Math.max(c[sl.ci], top));
      }
      const m = selMask();
      let s2 = 0;
      for (let k = 0; k < w.length; k++) if (m[k]) s2 += w[k];
      return "about " + (s2 < 10 ? s2.toFixed(1) : fmt(s2)) + " hexagons with fire";
    };
    return ` The forecast, from fire history alone: ${FC_YEARS.map((y) => `${mo} ${y} ${val(y)}`).join(", ")}.`;
  }
  var br = (x) => x.toPrecision(3);
  var auc = (x) => x == null ? "\u2013" : x.toFixed(3);
  function renderForecastSheet() {
    const st = S.st, F2 = fcData();
    $("fcSec").hidden = !fcOn(st);
    $("dlFcBox").hidden = !fcOn(st);
    if (!F2 || !fcOn(st)) return;
    const B = F2.backtest[st], L2 = largeOf(st), h2 = B.hex, c = B.county, lh = L2 ? L2.backtest.hex.horizon_1y : null, lc = L2 ? L2.backtest.county.horizon_1y : null;
    let v = `Any fire: <b>${verdictWord(Math.min(h2.brier_skill_vs_history, c.brier_skill_vs_history))} past odds</b>. Predicting each year 2018\u20132025 from the years before it, its Brier score was ${pctGain(h2.brier_skill_vs_history)} lower for hexagons (better in ${h2.years_model_better_brier} years) and ${pctGain(c.brier_skill_vs_history)} lower for counties.`;
    if (lh && lc)
      v += ` Large fires: <b>${verdictWord(lh.brier_skill_vs_history_alone)} past odds</b> for hexagons (${pctGain(lh.brier_skill_vs_history_alone)} lower), only ${pctGain(lh.brier_skill_vs_state_seasonal_average)} better than the state's plain seasonal average, and ${verdictWord(lc.brier_skill_vs_history_alone)} past odds for counties.`;
    $("fcVerdict").innerHTML = v;
    const same = [fcSame(st, "any") && "hexagons", fcSame(st, "any", true) && "counties"].filter(Boolean);
    $("fcNote").textContent = `It gives the chance of at least one hotspot in each hexagon and county, in each month of 2026 and 2027${L2 ? ", and in California the chance that a large fire (1,000+ acres) starts and reaches it" : ""}. It is built from fire history alone, to December 2025: no weather, fuel or ignitions, and none of the 2026 data now on the calendar. So it is the long-run chance for the month, not a warning that a given month will be unusual. Pick Forecast 2026 or 2027 on the map's Chance of fire layer, or above, to use it.` + (same.length ? ` For ${NAME[st]} ${same.join(" and ")}, any fire, 2027's chances are the same as 2026's: the backtest chose no trend term there, so the two years differ only in how far ahead they were tested.` : "");
    $("dlFcNote").textContent = "The forecast for every month of 2026 and 2027, for the area chosen above, with past odds alongside. Chances run from 0 to 1; 0 means under 0.0005." + (same.length ? ` For ${NAME[st]} ${same.join(" and ")}, the 2027 rows repeat 2026's any-fire chances.` : "") + " The county file gives a county at least its likeliest hexagon's chance, as the page does.";
    const row2 = (u, m) => `<tr><td class="u">${u}</td><td>${br(m.model.brier)}</td><td>${br(m.history_alone.brier)}</td><td class="em">${pctGain(m.brier_skill_vs_history)}</td><td>${auc(m.model.auc)}</td><td>${auc(m.history_alone.auc)}</td><td>${m.years_model_better_brier}</td><td>${pctGain(m.horizon2.brier_skill_vs_history)}</td></tr>`;
    const lrow = (u, b) => `<tr><td class="u">${u}</td><td>${br(b.horizon_1y.model.brier)}</td><td>${br(b.horizon_1y.history_alone.brier)}</td><td class="em">${pctGain(b.horizon_1y.brier_skill_vs_history_alone)}</td><td>${auc(b.horizon_1y.model.auc)}</td><td>${auc(b.horizon_1y.history_alone.auc)}</td><td>\u2013</td><td>${pctGain(largeSkill2(b.horizon_2y))}</td></tr>`;
    $("fcTable").innerHTML = `<tr><th>Tested on 2018\u20132025</th><th>Brier, forecast</th><th>Brier, past odds</th><th>Lower by</th><th>AUC, forecast</th><th>AUC, past odds</th><th>Years better</th><th>2 years ahead, lower by</th></tr><tr class="grp"><td colspan="8">Any fire: at least one hotspot</td></tr>` + row2("Hexagons", h2) + row2("Counties", c) + (L2 ? `<tr class="grp"><td colspan="8">Large fires: 1,000+ acres, CAL FIRE perimeters</td></tr>` + lrow("Hexagons", L2.backtest.hex) + lrow("Counties", L2.backtest.county) : "");
    $("fcKey").textContent = "Brier score: the average squared gap between the chance given and what happened; lower is better. AUC: how often a place that burned was given a higher chance than one that did not; 0.5 is a coin toss, 1 is perfect. Past odds: the share of earlier years with fire in that place and month, which is what the map shows under Past odds. 2 years ahead is the 2027 case: trained on years up to two before the test year." + (L2 ? " Large fires have no per-year Brier table, so that column is blank." : "");
    const anyRel = relChart(`Any fire, hexagons`, norm(h2.model.reliability || []), norm(h2.history_alone.reliability || []));
    const largeRel = L2 && lh ? relChart(
      `Large fires, hexagons`,
      lh.reliability_model.map((r) => ({ lo: r.pred_range[0], hi: r.pred_range[1], n: r.n, p: r.mean_pred, o: r.observed })),
      lh.reliability_history_alone.map((r) => ({ lo: r.pred_range[0], hi: r.pred_range[1], n: r.n, p: r.mean_pred, o: r.observed }))
    ) : "";
    $("fcRel").innerHTML = anyRel + largeRel;
    $("fcRel").querySelectorAll("circle[data-tip]").forEach((el) => {
      el.onmousemove = (e) => showTip(e, el.dataset.tip);
      el.onmouseleave = hideTip;
    });
    const lim = [];
    const py = h2.per_year, g = (r) => 1 - r.brier_model / r.brier_history;
    if (py.length > 1)
      lim.push(
        `<b>The gain is shrinking</b> as history piles up: for hexagons it was ${pctGain(g(py[0]))} in ${py[0].year} and ${pctGain(g(py[py.length - 1]))} in ${py[py.length - 1].year}, so expect the low end for 2026.`
      );
    const low = (h2.model.reliability || []).filter((r) => r.bin[1] <= 0.01 && r.n >= 50 && r.mean_p && r.observed != null);
    if (low.length) {
      const ratios = low.map((r) => r.observed / r.mean_p), obs = low.map((r) => r.observed);
      lim.push(
        `<b>Small chances run low.</b> Where the forecast said under 1%, fire came ${Math.min(...ratios).toFixed(1)}\u2013${Math.max(...ratios).toFixed(1)} times as often as it said, though still only ${pctP(Math.min(...obs))}\u2013${pctP(Math.max(...obs))} of the time.`
      );
    }
    const z = (h2.history_alone.reliability || []).find((r) => r.bin[0] === 0 && r.n > 0);
    if (z && z.observed)
      lim.push(
        `Past odds said 0% for ${fmt(z.n)} of the ${fmt(h2.history_alone.n)} test hexagon-months; fire came in ${pctP(z.observed)} of them. The forecast gives such places a small chance instead of none.`
      );
    const ratio = h2.model.mean_p / h2.model.base_rate;
    if (ratio < 0.9)
      lim.push(
        `<b>${NAME[st]} runs low overall.</b> In the tests the forecast expected ${pctP(h2.model.mean_p)} of hexagon-months to have fire; ${pctP(h2.model.base_rate)} did, because fire there has been rising. Treat any ${NAME[st]} total as probably too low.`
      );
    if (L2 && lh) {
      const ev = Object.entries(lh.model.expected_vs_observed_by_year).map(([y, [e, o]]) => ({ y, e, o, r: o / Math.max(1, e) })), hi = ev.reduce((a, b) => b.r > a.r ? b : a), lo = ev.reduce((a, b) => b.r < a.r ? b : a);
      lim.push(
        `<b>Large fires: it cannot tell a big year from a quiet one.</b> It expected about ${Math.round(hi.e)} large-fire hexagon-months in ${hi.y}, which had ${hi.o}, and about ${Math.round(lo.e)} in ${lo.y}, which had ${lo.o}. Read it as typical odds for the place and month. Its strength is ranking: ${pctGain(lh.model.share_of_events_in_top_risk.top_5pct)} of the hexagon-months that had a large fire were in its top 5%, against ${pctGain(lh.history_alone.share_of_events_in_top_risk.top_5pct)} for past odds and ${pctGain(lh.state_seasonal_average.share_of_events_in_top_risk.top_5pct)} for the state's seasonal average. Much of its AUC (${auc(lh.model.auc)}) comes from the season alone: a rule that knows only the month scores ${auc(lh.state_seasonal_average.auc)}, and past odds ${auc(lh.history_alone.auc)}.`
      );
    }
    lim.push(
      `Counties and hexagons are forecast separately (${esc3(B.county_below_its_likeliest_hex)} have a county chance below that of its likeliest hexagon); the page shows the higher of the two for a county.`
    );
    $("fcLimits").innerHTML = lim.map((t) => `<li>${t}</li>`).join("");
    $("fcMethod").innerHTML = `<p>${esc3(F2.method)}</p><p class="note small" style="margin-top:6px">Settings for ${NAME[st]}: hexagons ${esc3(h2.final_settings_label)}; counties ${esc3(c.final_settings_label)}. Settings for each test year were chosen only on earlier years (${esc3(h2.settings_chosen_on)}).</p>` + (L2 ? `<p style="margin-top:8px"><b>Large fires.</b> ${esc3(L2.definition)} ${esc3(L2.method)}</p><ul class="steps">${L2.limits.map((t) => `<li>${esc3(t)}</li>`).join("")}<li>${Math.round(L2.firms_inside.viirs * 100)}% of California's VIIRS hotspots fall inside a large-fire perimeter while it burned, but far fewer in quiet years, so large fires and all fires make different maps.</li></ul><p class="note small" style="margin-top:6px">${esc3(L2.credit)} <a href="${esc3(L2.source_page)}" target="_blank" rel="noopener">CAL FIRE FRAP fire perimeters</a>, retrieved ${esc3(L2.retrieved)}.</p>` : `<p class="note small" style="margin-top:6px">${esc3(NY_WHY)}</p>`);
  }
  var norm = (r) => r.map((b) => ({ lo: b.bin[0], hi: b.bin[1], n: b.n, p: b.mean_p, o: b.observed }));
  function relChart(title, model, hist) {
    const W = 540, H = 330, ml = 50, mr = 14, mt = 26, mb = 40, ok = (r) => r.n >= 20 && r.p != null && r.o != null, pts2 = [...model.filter(ok), ...hist.filter(ok)], top = Math.max(0.01, ...pts2.map((r) => Math.max(r.p, r.o))) * 1.08, sc = (v) => Math.sqrt(Math.max(0, v) / top), X = (v) => ml + sc(v) * (W - ml - mr), Y = (v) => H - mb - sc(v) * (H - mt - mb), nMax = Math.max(1, ...pts2.map((r) => r.n)), lab = (v) => v === 0 ? "0" : v >= 0.01 ? Math.round(v * 100) + "%" : (v * 100).toFixed(1) + "%";
    let g = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(top)}" y2="${Y(top)}" stroke="rgba(255,255,255,.35)" stroke-dasharray="4 4"/>`;
    let last = -99;
    for (const t of [0, 1e-3, 3e-3, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1]) {
      if (t > top) break;
      if (X(t) - last < 34) continue;
      last = X(t);
      g += `<line x1="${X(t)}" x2="${X(t)}" y1="${Y(0)}" y2="${Y(0) + 4}" stroke="rgba(255,255,255,.4)"/><text x="${X(t)}" y="${Y(0) + 16}" text-anchor="middle">${lab(t)}</text><line x1="${ml - 4}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}" stroke="rgba(255,255,255,${t ? 0.07 : 0.3})"/><text x="${ml - 7}" y="${Y(t) + 4}" text-anchor="end">${lab(t)}</text>`;
    }
    g += `<text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle">chance given</text><text x="${ml - 7}" y="12" text-anchor="end">fire came</text><text x="${X(top) - 4}" y="${Y(top) + 14}" text-anchor="end" style="fill:rgba(255,255,255,.5)">dashed line: fire came as often as said</text>`;
    const series = (rs, col, who) => {
      const r = rs.filter(ok);
      let s2 = `<polyline fill="none" stroke="${col}" stroke-width="1.6" stroke-opacity=".7" points="${r.map((b) => `${X(b.p).toFixed(1)},${Y(b.o).toFixed(1)}`).join(" ")}"/>`;
      for (const b of r)
        s2 += `<circle cx="${X(b.p).toFixed(1)}" cy="${Y(b.o).toFixed(1)}" r="${(2.5 + 5 * Math.sqrt(b.n / nMax)).toFixed(1)}" fill="${col}" stroke="#000" stroke-width="1" data-tip="${esc3(`${who} said ${lab(b.lo)}\u2013${lab(b.hi)}
${fmt(b.n)} hexagon-months, ${pctP(b.p, true)} on average
Fire came in ${pctP(b.o, true)}`)}"/>`;
      return s2;
    };
    g += series(hist, "#6fa8ff", "Past odds") + series(model, "#ff8a3d", "Forecast");
    return `<div><h4>${title}: how often fire came, by chance given</h4><div class="key"><span><i style="background:var(--ember)"></i>Forecast</span><span><i style="background:var(--cool)"></i>Past odds</span><span>Dot size: number of cases. Groups of under 20 left out.</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc3(title)}: observed share of fire against the chance given, for the forecast and for past odds">${g}</svg></div>`;
  }
  function oddsEvents() {
    const setOdds = (b) => {
      S.odds = b.dataset.odds === "past" ? "past" : +b.dataset.odds;
      render();
    };
    ["oddsSeg", "oddsSheet"].forEach(
      (id) => document.querySelectorAll(`#${id} button`).forEach((b) => b.onclick = () => setOdds(b))
    );
    document.querySelectorAll("#fireSeg button").forEach(
      (b) => b.onclick = () => {
        stopPlay();
        S.fire = b.dataset.fire === "large" ? "large" : "any";
        render();
      }
    );
  }
  function countyRiskFc(st, m, year) {
    const w = fcHex(st, "any", year, m), cp = fcHex(st, "any", year, m, true), hx = hexState(st), cs = D.states[st].counties, sum2 = new Float64Array(cs.length), top = new Float32Array(cs.length);
    let all = 0;
    for (let k = 0; k < hx.n; k++) {
      sum2[hx.c[k]] += w[k];
      all += w[k];
      if (w[k] > top[hx.c[k]]) top[hx.c[k]] = w[k];
    }
    return cs.map((c, ci) => ({ ci, name: c.name, e: sum2[ci], share: all ? sum2[ci] / all : 0, p: Math.max(cp ? cp[ci] : 0, top[ci]) })).sort((x, y) => y.e - x.e || y.p - x.p);
  }

  // src/card.ts
  function renderCard(R) {
    const hx = hexState(S.st), sl = S.sel, cty = (ci) => D.states[S.st].counties[ci].name + " County";
    $("place").textContent = placeName();
    $("lead").textContent = leadText(R, ytdFor(R, S.st, sl));
    $("crumb").innerHTML = (sl.type === "state" ? "State" : `<button type="button" data-go="state">${NAME[S.st]}</button>` + (sl.type === "hex" ? ` \u203A <button type="button" data-ci="${hx.c[sl.k]}">${cty(hx.c[sl.k])}</button>` : "")) + ` \xB7 ${span(S.yFrom, S.yTo)}`;
    $("crumb").querySelectorAll("button").forEach((b) => b.onclick = () => setCounty(b.dataset.go ? null : +b.dataset.ci));
    const sf = stationsFor(S.st, sl);
    $("c5q").textContent = sf.rad ? `Fire stations within ${sf.rad} km` : "Fire and EMS stations";
    $("c5").textContent = sf.n.toLocaleString("en-US") + (sf.near != null && sf.near < 1e8 ? ` \xB7 nearest ${sf.near < 10 ? sf.near.toFixed(1) : Math.round(sf.near)} km` : "");
    $("hint").textContent = sl.type === "state" ? "Click a county, then a hexagon, to zoom in. Scroll to zoom, drag to move." : sl.type === "county" ? "Click a hexagon in this county to zoom into it." : "Click a small hexagon to go closer. Blue squares are fire and EMS stations.";
    $("c1").textContent = R.total ? R.order.slice(0, 3).map((o) => MON[o.m]).join(", ") : "None";
    $("c2").textContent = R.total ? R.ranked.slice(0, 3).map((y) => y.y).join(", ") : "None";
    const v = verdict(R, S.focus, sameDaysFor(S.st, sl)), future = (S.focus[0] - Y0) * 12 + S.focus[1] > LAST_I;
    $("c3q").textContent = `${MON[S.focus[1]]} ${S.focus[0]}` + (v?.same ? ` (${v.same.span})` : "");
    $("c3").innerHTML = v ? `<span class="pill ${v.cls}" style="margin:0">${v.label}</span>` : future ? `No data yet` : "Outside these years";
    $("c3").parentElement.title = v?.same ? `${v.same.span} ${S.focus[0]} so far, against the same days of ${v.same.years[0]}\u2013${v.same.years[v.same.years.length - 1]}` : v?.noSame ? `The month is not over: the record runs to ${LAST_WORDS}. Choose the state or a county to compare its first days with the same days of past years.` : "";
    const pr = popCard(hx.c);
    $("popRow").hidden = !pr;
    if (pr) {
      $("c6q").textContent = pr.q;
      $("c6").textContent = pr.v;
      $("popRow").title = pr.title;
    }
    const cc = olCard() || chanceCard(R);
    $("c4q").textContent = cc.q;
    $("c4").textContent = cc.v;
    $("c4").parentElement.title = cc.title;
    $("openCmp").textContent = "Compare with " + NAME[STS.find((k) => k !== S.st)];
  }
  function popCard(hexCounty) {
    const st = S.st, sl = S.sel, ci = sl.type === "county" ? sl.ci : sl.type === "hex" ? hexCounty[sl.k] : -1, n = sl.type === "state" ? popState(st) : ci >= 0 ? popCounty(st, ci) : null;
    if (n == null) return null;
    const county2 = ci >= 0 ? D.states[st].counties[ci].name + " County" : "";
    if (sl.type === "hex")
      return {
        q: `${county2} population`,
        v: fmtPop(n),
        title: `Everyone living in ${county2}, which this hexagon is in, not the people in the hexagon: ${exactPop(n)}.`
      };
    return {
      q: `Population (${popWhen(true)})`,
      v: fmtPop(n),
      title: `${exactPop(n)}. Everyone living in ${sl.type === "state" ? NAME[st] : county2}, not only the people near fire.`
    };
  }
  function renderTimeline(R) {
    const ys = R.years, n = ys.length, W = 600, bw = W / n, mx = Math.max(1, ...ys.map((y) => y.h)), cur2 = S.show.t === "year" && S.layer === "count" ? S.show.y : null;
    let g = "";
    ys.forEach((y, i) => {
      const h2 = Math.max(2, 32 * Math.sqrt(y.h / mx)), on = y.y === cur2, fill = on ? "#ff8a3d" : cur2 == null ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.28)";
      g += y.part ? `<rect x="${i * bw + 2}" y="${38.5 - h2}" width="${bw - 4}" height="${h2 - 1}" rx="2" fill="${on ? fill : "none"}" stroke="${on ? "#ff8a3d" : fill}" stroke-width="1" stroke-dasharray="2 1.5"/>` : `<rect x="${i * bw + 1.5}" y="${38 - h2}" width="${bw - 3}" height="${h2}" rx="2" fill="${fill}"/>`;
      if (on || i % 4 === 0 && (cur2 == null || Math.abs(y.y - cur2) > 2))
        g += `<text x="${(i + 0.5) * bw}" y="51" text-anchor="middle" ${on ? 'class="hl"' : ""}>${y.y}</text>`;
    });
    if (cur2 != null) {
      const x = (cur2 - S.yFrom + 0.5) * bw;
      g += `<line x1="${x}" x2="${x}" y1="4" y2="40" stroke="#fff" stroke-width="2"/><circle cx="${x}" cy="5" r="5" fill="#fff"/>`;
    }
    const tr = $("tlTrack");
    tr.innerHTML = `<svg viewBox="0 0 ${W} 54" aria-hidden="true">${g}</svg>`;
    tr.setAttribute("aria-valuemin", String(S.yFrom));
    tr.setAttribute("aria-valuemax", String(S.yTo));
    tr.setAttribute("aria-valuenow", String(cur2 == null ? S.yTo : cur2));
    tr.setAttribute("aria-valuetext", cur2 == null ? "All years" : String(cur2));
    const yr = cur2 != null ? ys.find((y) => y.y === cur2) ?? null : null;
    $("tlLabel").innerHTML = yr ? `<b>${cur2}</b>${fmt(yr.h)} hotspots${cur2 < 2012 ? " (converted from MODIS)" : yr.part ? ` so far, to ${LAST_WORDS}` : ""}` : S.layer === "chance" ? "Drag along the years to see where each one burned" : S.show.t === "all" ? "Drag along the years to see where each one burned" : "Map shows: " + showLabel();
    $("showReset").hidden = S.layer === "chance" || S.show.t === "all";
  }

  // src/render.ts
  function render() {
    oddsFix();
    if (S.st && S.layer === "outlook" && !olOn(S.st)) S.layer = "count";
    document.querySelectorAll("#modeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
    document.querySelectorAll("#layerSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === S.layer)));
    $("rmMap").value = String(S.rm);
    if (S.st) {
      selFocus();
      const R = analyseFor(S.st, S.sel);
      renderCard(R);
      renderOdds();
      renderOutlookBar();
      renderResp();
      renderTimeline(R);
      if (S.sheet === "area") {
        $("tabArea").textContent = placeName();
        renderArea(R);
      }
      mapValues();
      mapDraw();
    }
    if (S.sheet === "compare") renderCompare();
  }

  // src/map.ts
  var V = {
    cx: 0,
    cy: 0,
    s: 1,
    W: 0,
    H: 0,
    fit: 1,
    anim: null,
    hover: -1,
    hoverF: -1,
    drag: null,
    vals: null,
    max: 1,
    chN: 1,
    fineOn: false,
    selC: null,
    mask: null,
    dpr: 1
  };
  var CH = null;
  var FINE_YEARS = Y1 - 2012 + 1;
  var FINE_SPAN = isPartYear(Y1) ? `2012 to ${LAST_WORDS}` : `2012\u2013${Y1}`;
  var FINE_FULL = FULL_Y1 - 2012 + 1;
  var FINE_FULL_BITS = (1 << FINE_FULL) - 1;
  var chT = (v) => CH ? Math.min(1, Math.pow(v / CH.max, CH.pow)) : v;
  var fineFits = () => S.layer === "count" || S.layer === "chance" && S.odds === "past" && S.fire === "any";
  var sx = (X) => V.W / 2 + (X - V.cx) * V.s;
  var sy = (Y) => V.H / 2 - (Y - V.cy) * V.s;
  var ix = (x) => V.cx + (x - V.W / 2) / V.s;
  var iy = (y) => V.cy - (y - V.H / 2) / V.s;
  function mapSize() {
    const cv = $("map"), dpr = Math.min(2, devicePixelRatio || 1);
    V.W = cv.clientWidth;
    V.H = cv.clientHeight;
    cv.width = V.W * dpr;
    cv.height = V.H * dpr;
    V.dpr = dpr;
  }
  var inset = () => V.W > 900 ? 388 : 0;
  var onScreen = (X, Y) => {
    const x = sx(X), y = sy(Y);
    return x > 0 && x < V.W - inset() && y > 0 && y < V.H;
  };
  function fitView(b) {
    const pad2 = 70, s2 = Math.min((V.W - inset() - 2 * pad2) / (b.x1 - b.x0), (V.H - 216) / (b.y1 - b.y0));
    return { cx: (b.x0 + b.x1) / 2 + inset() / 2 / s2, cy: (b.y0 + b.y1) / 2 - 30 / s2, s: s2 };
  }
  function flyTo(t, ms) {
    if (reduced || !ms) {
      Object.assign(V, t);
      mapDraw();
      return;
    }
    const a = { cx: V.cx, cy: V.cy, s: V.s }, t0 = performance.now();
    V.anim = t0;
    const step = (now) => {
      if (V.anim !== t0) return;
      const u = Math.min(1, (now - t0) / ms), e = ease(u);
      V.cx = a.cx + (t.cx - a.cx) * e;
      V.cy = a.cy + (t.cy - a.cy) * e;
      V.s = Math.exp(Math.log(a.s) + (Math.log(t.s) - Math.log(a.s)) * e);
      mapDraw();
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  var centerOn = (lon, lat, s2, ms) => flyTo({ cx: lon * hexState(S.st).K + inset() / 2 / s2, cy: lat, s: s2 }, ms || 1300);
  function selFocus() {
    const hx = hexState(S.st), m = V.mask = selMask();
    V.selC = null;
    if (S.sel.type === "state") return;
    let ax = 0, ay = 0, n = 0;
    for (let k = 0; k < hx.n; k++)
      if (m[k]) {
        ax += hx.X[k];
        ay += hx.Y[k];
        n++;
      }
    if (!n) return;
    ax /= n;
    ay /= n;
    let r = 0;
    for (let k = 0; k < hx.n; k++) if (m[k]) r = Math.max(r, Math.hypot(hx.X[k] - ax, hx.Y[k] - ay));
    V.selC = { x: ax, y: ay, r };
  }
  function selBounds() {
    const hx = hexState(S.st);
    if (S.sel.type === "state") return hx;
    const m = selMask();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < hx.n; k++)
      if (m[k]) {
        x0 = Math.min(x0, hx.X[k]);
        x1 = Math.max(x1, hx.X[k]);
        y0 = Math.min(y0, hx.Y[k]);
        y1 = Math.max(y1, hx.Y[k]);
      }
    if (x0 > x1) return hx;
    const p = hx.R * 7;
    return { x0: x0 - p, x1: x1 + p, y0: y0 - p, y1: y1 + p };
  }
  var showLabel = () => {
    const sh = S.show;
    return sh.t === "all" ? `All hotspots, ${span(S.yFrom, S.yTo)}` : sh.t === "year" ? `Hotspots in ${sh.y}${isPartYear(sh.y) ? ` so far, to ${LAST_WORDS}` : ""}` : sh.t === "cmonth" ? `A typical ${MONL[sh.m]}` : `${MONL[sh.m]} ${sh.y}`;
  };
  function mapValues() {
    const hx = hexState(S.st), v = new Float32Array(hx.n), sh = S.show, i0 = (S.yFrom - Y0) * 12, i1 = (S.yTo - Y0 + 1) * 12;
    let max = 0;
    if (S.layer === "outlook") {
      max = 1;
    } else if (S.layer === "chance") {
      CH = chanceNow(S.st);
      V.chN = CH.years ? CH.years[1] - CH.years[0] + 1 : 0;
      max = 1;
      v.set(CH.v);
    } else {
      for (let k = 0; k < hx.n; k++) {
        const b = k * NM;
        let a = 0;
        if (sh.t === "all") for (let i = i0; i < i1; i++) a += hx.H[b + i];
        else if (sh.t === "year") for (let i = (sh.y - Y0) * 12, e = i + 12; i < e; i++) a += hx.H[b + i];
        else if (sh.t === "cmonth") {
          let n = 0;
          for (let i = i0 + sh.m; i < i1 && i <= FULL_I; i += 12, n++) a += hx.H[b + i];
          a /= Math.max(1, n);
        } else a = hx.H[b + (sh.y - Y0) * 12 + sh.m];
        v[k] = a;
        if (a > max) max = a;
      }
      if (sh.t === "year") {
        max = 0;
        for (let k = 0; k < hx.n; k++)
          for (let y = S.yFrom; y <= S.yTo; y++) {
            let a = 0;
            const b = k * NM + (y - Y0) * 12;
            for (let i = 0; i < 12; i++) a += hx.H[b + i];
            if (a > max) max = a;
          }
      }
    }
    V.vals = v;
    V.max = Math.max(1, max);
    legend();
  }
  var chLabel = (t, top) => {
    if (!CH) return Math.round(t * 100) + "%";
    const v = CH.max * Math.pow(t, 1 / CH.pow), s2 = v >= 0.02 ? Math.round(v * 100) + "%" : (v * 100).toFixed(1) + "%";
    return s2 + (top && CH.max < 1 ? "+" : "");
  };
  function legend() {
    if (S.layer === "outlook") {
      olLegend();
      return;
    }
    const ch = S.layer === "chance", f = V.fineOn, sh = S.show, [a, b] = CH && CH.years ? CH.years : riskYears(), big2 = S.fire === "large", lut2 = LUT(), mx = f ? hexState(S.st).f.max : V.max;
    $("legTitle").textContent = f ? ch ? "How often each 2 km hexagon has burned since 2012" : "Hotspots per 2 km hexagon since 2012" : ch ? isFc() ? `Forecast for ${monthWhen()}: chance of ${big2 ? "a large fire (1,000+ acres) starting and reaching the hexagon" : "at least one hotspot"}` : big2 ? `Large fires in ${MONL[S.rm]}: share of years ${a} to ${b} when one (1,000+ acres) started and reached the hexagon` : `Chance of fire in ${MONL[S.rm]}: share of years ${a} to ${b} with a hotspot` : sh.t === "cmonth" ? `Average hotspots per hexagon in ${MONL[sh.m]}` : `Hotspots per hexagon, ${sh.t === "year" ? sh.y + (isPartYear(sh.y) ? " so far" : "") : sh.t === "ym" ? MON[sh.m] + " " + sh.y + ((sh.y - Y0) * 12 + sh.m > FULL_I ? " so far" : "") : span(S.yFrom, S.yTo)}`;
    let g = "";
    [0, 0.25, 0.5, 0.75, 1].forEach((t, i) => {
      const r = 5.5 + 7.5 * t, x = 24 + i * 49, pts2 = [];
      for (let q = 0; q < 6; q++) {
        const an = Math.PI / 180 * (30 + 60 * q);
        pts2.push((x + r * Math.cos(an)).toFixed(1) + "," + (15 - r * Math.sin(an)).toFixed(1));
      }
      g += `<polygon points="${pts2.join(" ")}" fill="${colT(lut2, t)}"/><text x="${x}" y="42" text-anchor="middle">${ch ? i ? chLabel(t, i === 4) : "rare" : short(Math.max(1, Math.round(Math.expm1(t * Math.log1p(mx)))))}</text>`;
    });
    $("legSw").innerHTML = `<svg viewBox="0 0 244 46" role="img" aria-label="Larger, stronger-coloured hexagons mean more fire">${g}</svg>`;
    $("legCap").textContent = (S.pal === "fire" ? "Bigger and redder" : "Bigger and brighter") + (ch ? big2 ? " means large fires more often." : " means fire more often." : " means more fire.") + (ch && isFc() ? " From fire history alone, not weather." : "") + (ch && big2 ? " Fire perimeters: CAL FIRE." : "") + (V.early ? " 2 km detail starts in 2012." : "");
  }
  var TILES = { ok: null, cache: /* @__PURE__ */ new Map() };
  var tileUrl = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  var drawQueued = false;
  var queueDraw = () => {
    if (!drawQueued) {
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        mapDraw();
      });
    }
  };
  function tileProbe() {
    const im = new Image();
    im.onload = () => {
      TILES.ok = true;
      queueDraw();
    };
    im.onerror = () => {
      TILES.ok = false;
    };
    im.src = tileUrl(3, 1, 2);
  }
  function drawTiles(c, hx, zf) {
    const z = Math.max(0, Math.min(18, Math.round(zf))), n = Math.pow(2, z), lon02 = ix(0) / hx.K, lon1 = ix(V.W) / hx.K, lat1 = iy(0), lat0 = iy(V.H);
    const tx = (lon) => Math.floor((lon + 180) / 360 * n), ty = (lat) => {
      const r = lat * Math.PI / 180;
      return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    };
    const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, x0 = tx(lon02), x1 = tx(lon1), y0 = ty(lat1), y1 = ty(lat0);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return false;
    const dark = "filter" in c;
    c.globalAlpha = Math.min(1, (zf - 8.8) / 0.8) * (dark ? 1 : 0.45);
    if (dark) c.filter = "invert(1) hue-rotate(180deg) brightness(1.15) contrast(.95) saturate(.45)";
    let any = false;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = z + "/" + x + "/" + y;
        let t = TILES.cache.get(k);
        if (!t) {
          t = new Image();
          t.onload = queueDraw;
          t.src = tileUrl(z, x, y);
          TILES.cache.set(k, t);
          if (TILES.cache.size > 500) TILES.cache.delete(TILES.cache.keys().next().value);
        }
        if (t.complete && t.naturalWidth) {
          const xa = sx((x / n * 360 - 180) * hx.K), xb = sx(((x + 1) / n * 360 - 180) * hx.K), ya = sy(latOf(y)), yb = sy(latOf(y + 1));
          c.drawImage(t, xa, ya, xb - xa + 0.6, yb - ya + 0.6);
          any = true;
        }
      }
    c.globalAlpha = 1;
    if (dark) c.filter = "none";
    return any;
  }
  var ctxCan = null;
  function drawContext(c, hx, rr, ox, oy, dim) {
    const canBlur = "filter" in c;
    if (!ctxCan) ctxCan = document.createElement("canvas");
    if (ctxCan.width !== c.canvas.width || ctxCan.height !== c.canvas.height) {
      ctxCan.width = c.canvas.width;
      ctxCan.height = c.canvas.height;
    }
    const o = ctxCan.getContext("2d");
    for (const [b0, b1, blur] of [
      [0, 4, 0.5],
      [5, 9, 2.5],
      [10, 15, 6]
    ]) {
      o.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
      o.clearRect(0, 0, V.W, V.H);
      o.fillStyle = "#212c42";
      for (let b = b0; b <= b1; b++) {
        o.globalAlpha = 0.95 * Math.pow(1 - b / 16, 1.6) * dim;
        o.beginPath();
        for (let j = 0; j < hx.cn; j++)
          if (hx.cB[j] === b) {
            const x = sx(hx.cX[j]), y = sy(hx.cY[j]);
            if (x < -rr || y < -rr || x > V.W + rr || y > V.H + rr) continue;
            o.moveTo(x + ox[0], y - oy[0]);
            for (let a = 1; a < 6; a++) o.lineTo(x + ox[a], y - oy[a]);
            o.closePath();
          }
        o.fill();
      }
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (canBlur) c.filter = `blur(${blur * V.dpr}px)`;
      c.drawImage(ctxCan, 0, 0);
      c.restore();
    }
  }
  function drawLabels(c, hx) {
    const zr = V.s / V.fit, K = Math.min(hx.towns.length, Math.round(80 * Math.pow(zr, 1.6))), pad2 = Math.max(5, 15 - 2.5 * zr), cap5 = Math.round(12 + 5 * zr), boxes = [];
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    for (let i = 0; i < K && boxes.length < cap5; i++) {
      const t = hx.towns[i], x = sx(t.X), y = sy(t.Y);
      if (x < 4 || y < 12 || x > V.W - 30 || y > V.H - 12) continue;
      const big2 = t.pop >= 1e5, w = (big2 ? 7.6 : 6.6) * t.n.length, hit = (b2) => boxes.some((o) => b2[0] < o[2] && b2[2] > o[0] && b2[1] < o[3] && b2[3] > o[1]);
      let b = [x - 6 - pad2, y - 9 - pad2, x + 9 + w + pad2, y + 9 + pad2], left = false;
      if (hit(b)) {
        b = [x - 9 - w - pad2, y - 9 - pad2, x + 6 + pad2, y + 9 + pad2];
        left = true;
        if (hit(b) || b[0] < 4) continue;
      }
      boxes.push(b);
      c.font = (big2 ? "600 14px" : "500 12.5px") + " 'Instrument Sans',sans-serif";
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(x, y, big2 ? 3 : 2.3, 0, 7);
      c.fill();
      c.textAlign = left ? "right" : "left";
      const tx = left ? x - 7 : x + 7;
      c.strokeStyle = "rgba(0,0,0,.92)";
      c.lineWidth = 3.5;
      c.strokeText(t.n, tx, y);
      c.fillStyle = "#f1f4f9";
      c.fillText(t.n, tx, y);
    }
  }
  function mapDraw() {
    if (!S.st || !V.mask) return;
    const hx = hexState(S.st), cv = $("map"), c = cv.getContext("2d"), mask = V.mask, lmax = Math.log1p(V.max), ch = S.layer === "chance", lut2 = LUT(), sh = S.show;
    c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    c.clearRect(0, 0, V.W, V.H);
    const R = hx.R * V.s, rr = R * (R > 5 ? 0.93 : 1), early = !ch && (sh.t === "year" || sh.t === "ym") && sh.y < 2012, fineT = early || !fineFits() ? 0 : Math.max(0, Math.min(1, (R - 20) / 16)), zf = Math.log2(360 * hx.K * V.s / 256);
    const corners = (r) => {
      const ox2 = [], oy2 = [];
      for (let a = 0; a < 6; a++) {
        const t = Math.PI / 180 * (30 + 60 * a);
        ox2.push(r * Math.cos(t));
        oy2.push(r * Math.sin(t));
      }
      return [ox2, oy2];
    };
    const hexPath = (x, y, ox2, oy2, k) => {
      c.beginPath();
      c.moveTo(x + ox2[0] * k, y - oy2[0] * k);
      for (let a = 1; a < 6; a++) c.lineTo(x + ox2[a] * k, y - oy2[a] * k);
      c.closePath();
    };
    const [ox, oy] = corners(rr), fOn = fineT > 0.5;
    if (fOn !== V.fineOn || early !== V.early) {
      V.fineOn = fOn;
      V.early = early;
      legend();
    }
    const tiles = TILES.ok && zf >= 8.8 ? drawTiles(c, hx, zf) : false;
    $("attrib").hidden = !tiles;
    if (R < 70) drawContext(c, hx, rr, ox, oy, (S.sel.type === "state" ? 1 : 0.6) * (tiles ? 0.35 : 1));
    const olReady = S.layer === "outlook" && olRun(S.st)?.status === "ok";
    if (fineT < 1 && !olReady) {
      const sc = V.selC, base2 = (1 - fineT) * (tiles ? 0.62 : 1);
      for (let k = 0; k < hx.n; k++) {
        const x = sx(hx.X[k]), y = sy(hx.Y[k]);
        if (x < -rr || y < -rr || x > V.W + rr || y > V.H + rr) continue;
        const v = V.vals[k];
        let a = 1;
        if (sc && !mask[k]) {
          const d = Math.max(0, Math.hypot(hx.X[k] - sc.x, hx.Y[k] - sc.y) - sc.r);
          a = Math.max(0.08, 0.4 * Math.exp(-d / (hx.R * 8)));
        }
        c.globalAlpha = a * base2 * (tiles ? 0.45 : 1);
        c.fillStyle = "#141a27";
        hexPath(x, y, ox, oy, 1);
        c.fill();
        if (v > 0) {
          const t = ch ? chT(v) : Math.log1p(v) / lmax;
          c.globalAlpha = a * base2;
          c.fillStyle = colT(lut2, t);
          hexPath(x, y, ox, oy, 0.46 + 0.54 * t);
          c.fill();
        }
      }
    }
    if (fineT > 0) {
      const f = hx.f, fr = f.R * V.s * 0.94, [fx, fy] = corners(fr), lm = Math.log1p(f.max), yb = !ch && (sh.t === "year" || sh.t === "ym") ? 1 << sh.y - 2012 : 0, mb = !ch && (sh.t === "cmonth" || sh.t === "ym") ? 1 << sh.m : 0;
      c.globalAlpha = fineT * (tiles ? 0.5 : 0.94);
      for (let j = 0; j < f.n; j++) {
        if (yb && !(f.ym[j] & yb) || mb && !(f.mm[j] & mb)) continue;
        const x = sx(f.X[j]), y = sy(f.Y[j]);
        if (x < -fr || y < -fr || x > V.W + fr || y > V.H + fr) continue;
        const t = ch ? pop(f.ym[j] & FINE_FULL_BITS) / FINE_FULL : Math.log1p(f.c[j]) / lm;
        c.fillStyle = colT(lut2, t);
        hexPath(x, y, fx, fy, 0.5 + 0.5 * t);
        c.fill();
      }
    }
    c.globalAlpha = 1;
    const path = (r) => {
      c.beginPath();
      for (const g of r) {
        for (let i = 0; i < g.length; i += 2) i ? c.lineTo(sx(g[i] * hx.K), sy(g[i + 1])) : c.moveTo(sx(g[i] * hx.K), sy(g[i + 1]));
        c.closePath();
      }
    };
    if (S.layer === "outlook") {
      const ciOf = new Map(D.states[S.st].counties.map((cty, i) => [cty.fips, i])), sl = S.sel, on = sl.type === "county" ? sl.ci : sl.type === "hex" ? hx.c[sl.k] : -1;
      for (const g of hx.geo) {
        const ci = ciOf.get(g.f), f = ci === void 0 ? null : olFill(S.st, ci);
        if (!f) continue;
        c.globalAlpha = f.a * (tiles ? 0.55 : 1) * (on < 0 || on === ci ? 1 : 0.45);
        c.fillStyle = f.c;
        path(g.r);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    c.strokeStyle = "rgba(255,255,255," + (V.s > V.fit * 1.6 ? 0.24 : 0.09) + ")";
    c.lineWidth = 1;
    for (const g of hx.geo) {
      path(g.r);
      c.stroke();
    }
    if (R < 40) {
      c.strokeStyle = "rgba(255,255,255,.07)";
      path(D.globe.us);
      c.stroke();
    }
    c.strokeStyle = "rgba(255,255,255,.5)";
    c.lineWidth = 1.3;
    path(D.globe.plate[S.st]);
    c.stroke();
    if (!tiles && R >= 9) {
      c.lineJoin = "round";
      for (const pass of [2, 1]) {
        c.beginPath();
        for (const rd of hx.roads) {
          if (rd[0] !== pass) continue;
          const p = rd[1];
          for (let i = 0; i < p.length; i += 2) i ? c.lineTo(sx(p[i] * hx.K), sy(p[i + 1])) : c.moveTo(sx(p[i] * hx.K), sy(p[i + 1]));
        }
        c.strokeStyle = pass === 1 ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.3)";
        c.lineWidth = pass === 1 ? 1.8 : 1;
        c.stroke();
      }
    }
    c.strokeStyle = "#fff";
    c.lineWidth = 2;
    const sel = S.sel;
    if (sel.type === "county") {
      path(hx.geoByFips[D.states[S.st].counties[sel.ci].fips].r);
      c.stroke();
    }
    if (sel.type === "hex") {
      const [hx1, hy1] = corners(R);
      hexPath(sx(hx.X[sel.k]), sy(hx.Y[sel.k]), hx1, hy1, 1);
      c.stroke();
    }
    const box2 = V.drag && V.drag.box ? V.drag.box : sel.type === "box" ? sel : null;
    if (box2) c.strokeRect(sx(box2.w * hx.K), sy(box2.n), sx(box2.e * hx.K) - sx(box2.w * hx.K), sy(box2.s) - sy(box2.n));
    if (sel.type === "circle") {
      c.beginPath();
      c.ellipse(
        sx(sel.lon * hx.K),
        sy(sel.lat),
        sel.rad / (111.32 * Math.cos(sel.lat * Math.PI / 180)) * hx.K * V.s,
        sel.rad / 110.57 * V.s,
        0,
        0,
        7
      );
      c.stroke();
    }
    c.lineWidth = 1.5;
    if (V.fineOn && V.hoverF >= 0) {
      const [fx, fy] = corners(hx.f.R * V.s * 0.94);
      hexPath(sx(hx.f.X[V.hoverF]), sy(hx.f.Y[V.hoverF]), fx, fy, 1);
      c.stroke();
    } else if (!V.fineOn && V.hover >= 0) {
      hexPath(sx(hx.X[V.hover]), sy(hx.Y[V.hover]), ox, oy, 1);
      c.stroke();
    }
    if (S.stn && R >= 14) {
      const st = hx.stn, z = R >= 60 ? 4.5 : 3;
      c.fillStyle = "#7fd8ff";
      c.strokeStyle = "#04121c";
      c.lineWidth = 1;
      const only = V.fineOn || R >= 40 ? -1 : sel.type === "county" ? sel.ci : sel.type === "hex" ? hx.c[sel.k] : -2;
      for (let i = 0; i < st.n; i++) {
        if (only !== -1 && st.c[i] !== only) continue;
        const x = sx(st.X[i]), y = sy(st.Y[i]);
        if (x < -5 || y < -5 || x > V.W + 5 || y > V.H + 5) continue;
        c.beginPath();
        c.rect(x - z, y - z, 2 * z, 2 * z);
        c.fill();
        c.stroke();
      }
    }
    c.textBaseline = "middle";
    c.textAlign = "center";
    c.font = "500 11px 'JetBrains Mono',monospace";
    c.fillStyle = "rgba(255,255,255,.42)";
    if (R < 40) for (const [n, la, lo] of NBR[S.st]) c.fillText(n.toUpperCase().split("").join("\u200A"), sx(lo * hx.K), sy(la));
    drawLabels(c, hx);
    drawResponse(c, sx, sy, R);
  }
  function chanceTip(k) {
    const big2 = S.fire === "large", past = (c) => c.years ? `${big2 ? "a large fire started and reached here" : "fire detected here"} in ${Math.round(c.v[k] * (c.years[1] - c.years[0] + 1))} of ${c.years[1] - c.years[0] + 1} ${MONL[S.rm]}s, ${c.years[0]}\u2013${c.years[1]}` : "";
    if (!CH) return "";
    if (!isFc()) return `${past(CH).replace(/^./, (c) => c.toUpperCase())} (${pctP(CH.v[k], true)})`;
    return `Forecast for ${monthWhen()}: ${pctP(CH.v[k])} chance of ${big2 ? "a large fire reaching here" : "at least one hotspot"}
Past: ${past(chanceNow(S.st, S.rm, "past", S.fire))}`;
  }
  var notFireTip = (k) => {
    const n = k >= 0 ? notFireName(S.st, k) : "";
    return n ? `
Most hotspots here are heat from ${n}, not fire; the chance of fire and the tools leave it out` : "";
  };
  var hexAt = (px, py) => {
    const hx = hexState(S.st), k = hx.key.get(hexKey(ix(px), iy(py), hx.R));
    return k === void 0 ? -1 : k;
  };
  var fineAt = (px, py) => {
    const f = hexState(S.st).f, k = f.key.get(hexKey(ix(px), iy(py), f.R));
    return k === void 0 ? -1 : k;
  };
  function mapEvents() {
    const cv = $("map"), loc = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }, zmax = () => V.fit * 320;
    cv.onpointerdown = (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = loc(e);
      V.anim = null;
      V.drag = { p0: p, c0: [V.cx, V.cy], moved: false, ll: [ix(p[0]) / hexState(S.st).K, iy(p[1])] };
    };
    cv.onpointermove = (e) => {
      const p = loc(e), d = V.drag, hx = hexState(S.st);
      if (d) {
        if (Math.hypot(p[0] - d.p0[0], p[1] - d.p0[1]) > 5) d.moved = true;
        if (!d.moved) return;
        hideTip();
        if (S.draw) {
          const lo = ix(p[0]) / hx.K, la = iy(p[1]);
          d.box = { w: Math.min(lo, d.ll[0]), e: Math.max(lo, d.ll[0]), s: Math.min(la, d.ll[1]), n: Math.max(la, d.ll[1]) };
        } else {
          V.cx = d.c0[0] - (p[0] - d.p0[0]) / V.s;
          V.cy = d.c0[1] + (p[1] - d.p0[1]) / V.s;
        }
        mapDraw();
        return;
      }
      const k = hexAt(p[0], p[1]), j = V.fineOn ? fineAt(p[0], p[1]) : -1, county2 = k >= 0 ? D.states[S.st].counties[hx.c[k]].name + " County" : "";
      if (k !== V.hover || j !== V.hoverF) {
        V.hover = k;
        V.hoverF = j;
        mapDraw();
      }
      if (S.stn && hx.R * V.s >= 14) {
        const st = hx.stn, sl = S.sel, only = V.fineOn || hx.R * V.s >= 40 ? -1 : sl.type === "county" ? sl.ci : sl.type === "hex" ? hx.c[sl.k] : -2;
        let b = -1, bd = 81;
        for (let i = 0; i < st.n; i++) {
          if (only !== -1 && st.c[i] !== only) continue;
          const dx = sx(st.X[i]) - p[0], dy = sy(st.Y[i]) - p[1], q = dx * dx + dy * dy;
          if (q < bd) {
            bd = q;
            b = i;
          }
        }
        if (b >= 0) {
          showTip(e, `${st.names[b][0]}
Fire or EMS station${st.names[b][1] ? " \xB7 " + st.names[b][1] : ""}`);
          return;
        }
      }
      if (V.fineOn) {
        const f = hx.f;
        if (j >= 0)
          showTip(
            e,
            `${county2 ? county2 + "\n" : ""}${fmt(f.c[j])} hotspots in this 2 km hexagon since 2012
Burned in ${pop(f.ym[j])} of ${FINE_YEARS} years (${FINE_SPAN}), last in ${2012 + 31 - Math.clz32(f.ym[j])}
Months with fire: ${MON.filter((_, m) => f.mm[j] >> m & 1).join(", ")}${notFireTip(k)}${respTip(k) || "\nClick to zoom in"}`
          );
        else if (k >= 0) showTip(e, `${county2}
No hotspots detected here since 2012${respTip(k)}`);
        else hideTip();
      } else if (k >= 0)
        showTip(
          e,
          (S.layer === "outlook" ? `${county2}
${olTip(hx.c[k])}` : S.layer === "chance" ? `${county2}
${chanceTip(k)}` : `${county2}
${fmt(V.vals[k])} hotspots in this hexagon
${showLabel()}`) + notFireTip(k) + (respTip(k) || "\nClick to zoom in")
        );
      else hideTip();
    };
    cv.onpointerleave = () => {
      hideTip();
      if (V.hover >= 0 || V.hoverF >= 0) {
        V.hover = V.hoverF = -1;
        mapDraw();
      }
    };
    cv.onpointerup = (e) => {
      const d = V.drag;
      V.drag = null;
      if (!d) return;
      if (d.box) {
        S.sel = Object.assign({ type: "box" }, d.box);
        setDraw(false);
        zoomSel();
        render();
        return;
      }
      if (d.moved) return;
      const p = loc(e), k = hexAt(p[0], p[1]);
      if (respClick(ix(p[0]) / hexState(S.st).K, iy(p[1]), k)) return;
      if (k < 0) return;
      const hx = hexState(S.st), ci = hx.c[k], s2 = S.sel;
      if (V.fineOn) {
        S.sel = { type: "hex", k };
        render();
        const z = Math.min(zmax(), V.s * 2.2);
        flyTo({ cx: ix(p[0]) + inset() / 2 / z, cy: iy(p[1]), s: z }, 700);
      } else if (s2.type === "county" && s2.ci === ci || s2.type === "hex") {
        S.sel = { type: "hex", k };
        render();
        centerOn(hx.X[k] / hx.K, hx.Y[k], 150 / hx.R, 900);
      } else setCounty(ci);
    };
    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = loc(e), X = ix(p[0]), Y = iy(p[1]), f = Math.exp(-e.deltaY * 15e-4);
        V.anim = null;
        V.s = Math.max(V.fit * 0.6, Math.min(zmax(), V.s * f));
        V.cx = X - (p[0] - V.W / 2) / V.s;
        V.cy = Y + (p[1] - V.H / 2) / V.s;
        mapDraw();
      },
      { passive: false }
    );
    $("zin").onclick = () => flyTo({ cx: V.cx, cy: V.cy, s: Math.min(zmax(), V.s * 2) }, 300);
    $("zout").onclick = () => flyTo({ cx: V.cx, cy: V.cy, s: Math.max(V.fit * 0.6, V.s / 2) }, 300);
  }
  function zoomSel() {
    const f = fitView(selBounds());
    if (S.sel.type === "state") V.fit = f.s;
    else f.s = Math.min(f.s, V.fit * 4.5);
    flyTo(f, 750);
  }
  function setDraw(on) {
    S.draw = on;
    $("drawBtn").setAttribute("aria-pressed", String(on));
    $("drawBtn").classList.toggle("on", on);
    $("drawBtn").textContent = on ? "Drag a box on the map" : "Draw an area";
    $("map").style.cursor = on ? "crosshair" : "pointer";
  }
  function setCounty(ci) {
    S.sel = ci == null ? { type: "state" } : { type: "county", ci };
    zoomSel();
    render();
  }

  // src/hf.ts
  var HF_DATASET = "rogeryzd/firms-active-fire-by-country";
  var HF_PAGE = `https://huggingface.co/datasets/${HF_DATASET}`;
  var SUMMARY_DIR = "summary/v3";
  var FALLBACK_DIR = "summary/v2";
  var summaryPath = (k, dir = SUMMARY_DIR) => `${dir}/${encodeURIComponent(k)}.json`;
  var pathOf = (d) => summaryPath(d.country, `summary/v${d.v}`);
  var fileUrl = (path) => `${HF_PAGE}/resolve/main/${path}`;
  var wait = (ms) => new Promise((res) => setTimeout(res, ms));
  async function fetchOnce(url) {
    const res = await fetch(url);
    if (res.status !== 429) return res;
    const after = Number(res.headers.get("retry-after"));
    await wait(after > 0 ? Math.min(8, after) * 1e3 : 2500);
    return fetch(url);
  }
  async function fetchText(url, onProgress) {
    const res = await fetchOnce(url);
    if (!res.ok) throw new Error(res.status === 429 ? "Hugging Face is busy (too many requests)" : `Hugging Face answered ${res.status}`);
    const total2 = Number(res.headers.get("content-length")) || null;
    if (!res.body) return res.text();
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress()?.(got, total2);
    }
    const all = new Uint8Array(got);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return new TextDecoder().decode(all);
  }
  var isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  var isNums = (x, n) => Array.isArray(x) && (n === void 0 || x.length === n) && x.every((v) => typeof v === "number");
  var isNumOrNull = (x) => x === null || typeof x === "number";
  function isSummary(x, k) {
    if (!isObj(x) || x.v !== 2 && x.v !== 3 || x.country !== k || typeof x.name !== "string") return false;
    if (typeof x.y0 !== "number" || typeof x.y1 !== "number" || x.y1 < x.y0) return false;
    if (x.v === 3 && !isV3(x)) return false;
    const nm = x.v === 3 ? x.n_months : (x.y1 - x.y0 + 1) * 12, mo = x.monthly, val = x.val, src = x.source, tot = x.totals;
    return isNums(x.viirs_from, 2) && isNums(x.aqua_from, 2) && isNums(x.bins) && typeof x.filter === "string" && isObj(mo) && ["T", "A", "V", "N20"].every((s2) => isNums(mo[s2], nm)) && ["r_ta", "r_t", "r_ta_lo", "r_ta_hi"].every((s2) => isNums(x[s2], 12)) && typeof x.r_all === "number" && Array.isArray(x.pi) && x.pi.length === x.bins.length + 1 && x.pi.every((p) => isNums(p, 2)) && typeof x.zero_hi === "number" && typeof x.rate_note === "string" && isObj(val) && ["raw_factor", "annual_med_err", "annual_max_err", "monthly_wape"].every((s2) => isNumOrNull(val[s2])) && Array.isArray(val.loyo) && val.loyo.every((r) => isObj(r) && ["y", "obs", "pred", "modis"].every((s2) => typeof r[s2] === "number")) && isNums(x.bbox, 4) && typeof x.cell === "number" && x.cell > 0 && isNums(x.cells) && isNums(x.cell_rows) && x.cell_rows.length % 5 === 0 && isObj(tot) && isObj(src) && typeof src.firms_updated === "string" && typeof src.files === "number";
  }
  function isV3(x) {
    const p = x.partial, y = x.y2026, nm = x.n_months;
    if (typeof nm !== "number" || typeof x.last_date !== "string" || !isObj(p) || !isObj(y)) return false;
    if (typeof x.y0 !== "number" || nm > (x.y1 - x.y0 + 1) * 12 || p.i !== nm - 1) return false;
    const sd = y.same_days, ytd = y.ytd, jc = y.join_check_2025;
    const cmp = (c) => isObj(c) && isNums(c.V) && isObj(c.V_stats) && ["cur", "cur_lo", "cur_hi", "rank"].every((s2) => typeof c[s2] === "number") && isNums(c.years, 2);
    return ["v_obs", "v_conv", "v_lo", "v_hi"].every((s2) => isNums(y[s2])) && Array.isArray(y.conv_months) && y.conv_months.every((c) => isObj(c) && typeof c.i === "number" && isNums(c.days)) && cmp(sd) && cmp(ytd) && isObj(jc) && typeof jc.warn === "boolean" && (y.hist_gaps === void 0 || Array.isArray(y.hist_gaps) && y.hist_gaps.every((g) => isObj(g) && ["i", "filled", "lo", "hi"].every((k) => typeof g[k] === "number") && isNums(g.days)));
  }
  var isIndexEntry = (x) => isObj(x) && typeof x.country === "string" && typeof x.name === "string" && typeof x.file === "string";
  var SUMMARIES = /* @__PURE__ */ new Map();
  function loadSummary(k, onProgress) {
    const had = SUMMARIES.get(k);
    if (had) {
      had.tell.listen = onProgress;
      return had.p;
    }
    const tell = { listen: onProgress }, get = (dir) => fetchText(fileUrl(summaryPath(k, dir)), () => tell.listen).then((text2) => {
      const data = JSON.parse(text2);
      if (!isSummary(data, k)) throw new Error("The file from Hugging Face is not in the expected format");
      return data;
    }), p = get(SUMMARY_DIR).catch(() => get(FALLBACK_DIR));
    p.catch(() => SUMMARIES.delete(k));
    SUMMARIES.set(k, { p, tell });
    return p;
  }
  var index = null;
  function loadIndex() {
    if (!index) {
      const get = (dir) => fetchText(fileUrl(`${dir}/index.json`), () => null).then((text2) => {
        const data = JSON.parse(text2);
        if (!isObj(data) || !Array.isArray(data.countries)) throw new Error("The country index is not in the expected format");
        return data.countries.filter(isIndexEntry);
      });
      index = get(SUMMARY_DIR).catch(() => get(FALLBACK_DIR));
      index.catch(() => index = null);
    }
    return index;
  }
  var FORECAST_DIR = "forecast/v1";
  var STATIONS_DIR = "stations/v2";
  var forecastPath = (k) => `${FORECAST_DIR}/${encodeURIComponent(k)}.json`;
  var stationsPath = (k) => `${STATIONS_DIR}/${encodeURIComponent(k)}.json`;
  async function jsonWithin(url, ms) {
    const ctl = new AbortController();
    let phase = "answer", timer = setTimeout(() => ctl.abort(), ms);
    try {
      let res = await fetch(url, { signal: ctl.signal });
      if (res.status === 429) {
        await wait(2500);
        res = await fetch(url, { signal: ctl.signal });
      }
      if (!res.ok) throw new Error(res.status === 429 ? "Hugging Face is busy (too many requests)" : `Hugging Face answered ${res.status}`);
      clearTimeout(timer);
      phase = "download";
      timer = setTimeout(() => ctl.abort(), 3 * ms);
      return await res.json();
    } catch (e) {
      if (ctl.signal.aborted)
        throw new Error(
          phase === "answer" ? `Hugging Face did not answer within ${Math.round(ms / 1e3)} seconds` : `the file did not finish downloading within ${Math.round(3 * ms / 1e3)} seconds`
        );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  var EXTRAS = /* @__PURE__ */ new Map();
  var KEEP = 8;
  function loadChecked(path, ok, ms = 2e4) {
    const had = EXTRAS.get(path);
    if (had) {
      EXTRAS.delete(path);
      EXTRAS.set(path, had);
      return had;
    }
    const p = jsonWithin(fileUrl(path), ms).then((data) => {
      if (!ok(data)) throw new Error("The file from Hugging Face is not in the expected format");
      return data;
    });
    p.catch(() => {
      if (EXTRAS.get(path) === p) EXTRAS.delete(path);
    });
    EXTRAS.set(path, p);
    while (EXTRAS.size > KEEP) EXTRAS.delete(EXTRAS.keys().next().value);
    return p;
  }

  // src/fireglobe.ts
  var FIRE_YEARS = 25;
  var R_KM = 6371.0088;
  var STOPS = [
    { c: [255, 232, 150], a: 0.18 },
    { c: [255, 180, 60], a: 0.34 },
    { c: [244, 110, 30], a: 0.5 },
    { c: [196, 42, 20], a: 0.66 },
    { c: [110, 10, 8], a: 0.82 }
  ];
  function fireColour(t) {
    t = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i, a = STOPS[i], b = STOPS[i + 1];
    return { c: a.c.map((v, k) => Math.round(v + (b.c[k] - v) * f)), a: a.a + (b.a - a.a) * f };
  }
  var css2 = (x) => `rgba(${x.c[0]},${x.c[1]},${x.c[2]},${x.a.toFixed(3)})`;
  function areaKm2(c) {
    let sum2 = 0;
    for (const r of c.r) {
      let s2 = 0;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
        s2 += (r[j] - r[i]) * Math.PI / 180 * (Math.sin(r[j + 1] * Math.PI / 180) + Math.sin(r[i + 1] * Math.PI / 180));
      sum2 += Math.abs(s2) / 2;
    }
    return sum2 * R_KM * R_KM;
  }
  function ringBox(r) {
    let w = Infinity, s2 = Infinity, e = -Infinity, n = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      w = Math.min(w, r[i]);
      e = Math.max(e, r[i]);
      s2 = Math.min(s2, r[i + 1]);
      n = Math.max(n, r[i + 1]);
    }
    return [w, s2, e, n];
  }
  var quantile = (s2, q) => s2[Math.min(s2.length - 1, Math.max(0, Math.round(q * (s2.length - 1))))];
  function buildFireLayer(index3, width = 2048) {
    const total2 = new Map(index3.map((e) => [e.country, e.total_2001_2025 ?? e.total])), raw = [];
    for (const c of WORLD) {
      const tot = total2.get(c.k), area = areaKm2(c);
      if (!tot || !(tot > 0) || !(area > 0)) continue;
      const perYear2 = tot / FIRE_YEARS;
      raw.push({ c, area, perYear: perYear2, density: perYear2 / area * 1e3 });
    }
    const logs = raw.map((x) => Math.log10(x.density)).sort((a, b) => a - b), l0 = logs.length ? quantile(logs, 0.05) : 0, l1 = logs.length ? Math.max(l0 + 0.5, quantile(logs, 0.97)) : 1, stats2 = /* @__PURE__ */ new Map();
    for (const x of raw) stats2.set(x.c.k, { perYear: x.perYear, density: x.density, t: (Math.log10(x.density) - l0) / (l1 - l0) });
    const cv = paintCountries(
      raw.map((x) => ({ c: x.c, area: x.area, fill: css2(fireColour(stats2.get(x.c.k).t)) })),
      width
    );
    return { canvas: cv, stats: stats2, lo: Math.pow(10, l0), hi: Math.pow(10, l1) };
  }
  function paintCountries(items, width = 2048) {
    const h2 = width / 2, cv = document.createElement("canvas");
    cv.width = width;
    cv.height = h2;
    const g = cv.getContext("2d"), X = (lon) => (lon + 180) / 360 * width, Y = (lat) => (90 - lat) / 180 * h2;
    for (const x of items.slice().sort((a, b) => b.area - a.area)) {
      g.fillStyle = x.fill;
      g.beginPath();
      for (const r of x.c.r) {
        g.moveTo(X(r[0]), Y(r[1]));
        for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1]));
        g.closePath();
      }
      g.fill();
      const boxes = x.c.r.map(ringBox);
      if (boxes.every(([w, s2, e, n]) => X(e) - X(w) < 3 && Y(s2) - Y(n) < 3)) {
        g.beginPath();
        for (const [w, s2, e, n] of boxes) {
          const cx = X((w + e) / 2), cy = Y((s2 + n) / 2);
          g.moveTo(cx + 2, cy);
          g.arc(cx, cy, 2, 0, 2 * Math.PI);
        }
        g.fill();
      }
    }
    return cv;
  }

  // src/wol.ts
  var SRC = "world_outlook.js?v=2";
  var fileP = null;
  function loadWorldOutlook() {
    if (window.WORLD_OUTLOOK) return Promise.resolve(window.WORLD_OUTLOOK);
    if (!fileP) {
      fileP = new Promise((ok, fail) => {
        const s2 = document.createElement("script");
        s2.src = SRC;
        s2.async = true;
        s2.onload = () => window.WORLD_OUTLOOK ? ok(window.WORLD_OUTLOOK) : fail(new Error("the outlook file was empty"));
        s2.onerror = () => {
          s2.remove();
          fail(new Error("the outlook file did not load"));
        };
        document.head.appendChild(s2);
      });
      fileP.catch(() => fileP = null);
    }
    return fileP;
  }
  function doy3652(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const j = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5);
    const leap = y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
    return leap && m > 2 ? j - 1 : j;
  }
  function halfMonth(iso) {
    const [, m, d] = iso.split("-").map(Number);
    return 2 * (m - 1) + (d > 15 ? 1 : 0);
  }
  function cellBounds(band, col) {
    const n = Math.max(1, Math.round(144 * Math.cos((-90 + 2.5 * (band + 0.5)) * Math.PI / 180)));
    const w = 360 / n;
    return [-180 + col * w, -90 + band * 2.5, -180 + (col + 1) * w, -90 + (band + 1) * 2.5];
  }
  var es = (t) => Math.exp(17.62 * t / (243.12 + t));
  function regionOutlook(O2, ri, today, tmax, tdew, prec) {
    const T = O2.prior, H = O2.horizon, K = 2 * O2.nharm + 1;
    if (!/^\d{4}-\d\d-\d\d$/.test(today)) return null;
    for (let i = 0; i < T + H; i++)
      for (const a2 of [tmax, tdew, prec]) {
        const v = a2[i];
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
      }
    const at = O2.adjust.tmax[ri], ad = O2.adjust.tdew[ri], ps = O2.adjust.prec[ri];
    let t14 = 0, rh14 = 0, p14 = 0, p30 = 0;
    for (let i = 0; i < T + H; i++) {
      const tx = tmax[i] - at, td = tdew[i] - ad, pr = Math.max(0, prec[i]) * ps;
      if (i < T) p30 += pr;
      else {
        t14 += tx;
        rh14 += Math.min(100, 100 * es(td) / es(tx));
        p14 += pr;
      }
    }
    const x = { tmax14: t14 / H, rhmin14: rh14 / H, prec14: Math.log1p(p14), prec30: Math.log1p(p30) };
    const doy = doy3652(today), hm = halfMonth(today), a = 2 * Math.PI * doy / 365, h2 = [1];
    for (let k = 1; k <= O2.nharm; k++) h2.push(Math.cos(k * a), Math.sin(k * a));
    const base2 = O2.base[ri * 24 + hm] / 1e3;
    if (!(base2 > 0 && base2 < 1)) return null;
    const lb = Math.log(base2 / (1 - base2));
    let z = O2.coef[0] + O2.coef[1] * lb, zMax = 0;
    O2.features.forEach((f, j) => {
      const C = O2.clim[f.id];
      let mu = 0, v = 0;
      for (let k = 0; k < K; k++) {
        mu += h2[k] * C.mu[ri * K + k];
        v += h2[k] * C.var[ri * K + k];
      }
      const sd = Math.max(Math.sqrt(Math.max(v, 0)), C.floor[ri]), raw = (x[f.id] - mu) / sd, za = Math.max(-O2.z_clip, Math.min(O2.z_clip, raw));
      zMax = Math.max(zMax, Math.abs(raw));
      z += O2.coef[j + 2] * za;
    });
    const p = 1 / (1 + Math.exp(-z)), norm2 = 1 / (1 + Math.exp(-(O2.norm_coef[0] + O2.norm_coef[1] * lb)));
    return { p, base: base2, ratio: p / base2, norm: norm2, wxRatio: p / norm2, thr: O2.thr[ri * 24 + hm], hm, today, zMax };
  }
  function countryRegions(O2, k) {
    const all = (O2.countries[k] || []).map(([ri, m]) => ({ ri, share: m / 1e3 }));
    const used = all.filter((r) => r.share >= 1e-3);
    return used.length ? { used, minor: all.filter((r) => r.share < 1e-3) } : { used: all, minor: [] };
  }
  var ODD_Z = 3.5;
  var MIN_SHARE = 0.75;
  var LIVE_GATE = 0.01;
  var countryPasses = (O2, k) => {
    const m = O2.metrics.by_country[k];
    return !!m && m[5] >= LIVE_GATE;
  };
  var isOdd = (r) => r.zMax > ODD_Z;
  function sumUp(cells) {
    const total2 = cells.reduce((a, c) => a + c.share, 0) || 1, live = cells.filter((c) => c.r && !isOdd(c.r)), sw = live.reduce((a, c) => a + c.share, 0), w = sw || 1, P2 = live.reduce((a, c) => a + c.share * c.r.p, 0) / w, N = live.reduce((a, c) => a + c.share * c.r.norm, 0) / w;
    return {
      P: P2,
      N,
      D: P2 - N,
      liveShare: sw / total2,
      nLive: live.length,
      nOdd: cells.filter((c) => c.r && isOdd(c.r)).length,
      nMissing: cells.filter((c) => !c.r).length
    };
  }
  var COUNTRY_STEP = 0.03;
  var EDGES = [-0.15, -0.08, -0.03, 0.03, 0.08, 0.15];
  var RAMP = ["#2166ac", "#67a9cf", "#d1e5f0", "#f4f2ec", "#fddbc7", "#ef8a62", "#b2182b"];
  var changeColour = (d) => RAMP[EDGES.filter((e) => d >= e).length];
  var modelId = (O2) => `${O2.built}/${O2.coef.join(",")}`;
  var SNAP_MAX_MS = 36 * 3600 * 1e3;
  var snapFresh = (s2) => Date.now() - Date.parse(s2.at) < SNAP_MAX_MS;
  var snapP = null;
  function loadSnapshot() {
    if (!snapP)
      snapP = fetch("world_outlook_today.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then(
        (s2) => s2 && s2.v === 1 && Array.isArray(s2.r) && s2.c && typeof s2.at === "string" && snapFresh(s2) ? s2 : null
      ).catch(() => null);
    return snapP;
  }
  function fromSnap(O2, s2, ri) {
    const row2 = s2.r[ri];
    if (!row2) return null;
    const [p, zMax, off] = row2, today = addDays2(s2.today, off), hm = halfMonth(today), base2 = O2.base[ri * 24 + hm] / 1e3;
    if (!(base2 > 0 && base2 < 1)) return null;
    const norm2 = 1 / (1 + Math.exp(-(O2.norm_coef[0] + O2.norm_coef[1] * Math.log(base2 / (1 - base2)))));
    return { p, base: base2, ratio: p / base2, norm: norm2, wxRatio: p / norm2, thr: O2.thr[ri * 24 + hm], hm, today, zMax };
  }
  var TIMEOUT_MS2 = 45e3;
  var CHUNK2 = 50;
  var KEEP_MS2 = 3 * 3600 * 1e3;
  var WeatherError2 = class extends Error {
  };
  var numArr2 = (a) => Array.isArray(a) ? a.map((v) => typeof v === "number" && Number.isFinite(v) ? v : null) : null;
  function forecastUrl2(O2, ris) {
    const q = new URLSearchParams({
      latitude: ris.map((r) => O2.regions.lat[r].toFixed(2)).join(","),
      longitude: ris.map((r) => O2.regions.lon[r].toFixed(2)).join(",")
    });
    for (const [k, v] of Object.entries(O2.api.params)) q.set(k, String(v));
    return `${O2.api.url}?${q}`;
  }
  async function getDaily2(O2, ris) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT_MS2), why = () => ac.signal.aborted ? `The weather service did not answer within ${TIMEOUT_MS2 / 1e3} seconds.` : navigator.onLine === false ? "You seem to be offline, so there is no weather forecast." : "The weather service could not be reached.";
    try {
      let r;
      try {
        r = await fetch(forecastUrl2(O2, ris), { signal: ac.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      } catch {
        throw new WeatherError2(why());
      }
      if (!r.ok)
        throw new WeatherError2(
          r.status === 429 ? "The weather service's free limit for this connection has been reached. Try again in a few minutes." : `The weather service answered with an error (${r.status}).`
        );
      let j;
      try {
        j = await r.json();
      } catch {
        throw new WeatherError2(ac.signal.aborted ? why() : "The weather service sent something that is not a forecast.");
      }
      const list4 = Array.isArray(j) ? j : [j];
      if (list4.length !== ris.length) throw new WeatherError2("The weather service sent a forecast for the wrong number of places.");
      return list4.map((o) => o && typeof o === "object" && o.daily || {});
    } finally {
      clearTimeout(t);
    }
  }
  function work2(O2, ri, d) {
    const time = Array.isArray(d.time) ? d.time : null, tmax = numArr2(d.temperature_2m_max), tdew = numArr2(d.dew_point_2m_mean), prec = numArr2(d.precipitation_sum), today = time ? time[O2.prior] : null;
    if (!tmax || !tdew || !prec || typeof today !== "string") return null;
    return regionOutlook(O2, ri, today, tmax, tdew, prec);
  }
  var addDays2 = (iso, n) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  function finish2(O2, rows, at) {
    const tally = /* @__PURE__ */ new Map();
    rows.forEach((r) => r && tally.set(r.today, (tally.get(r.today) || 0) + 1));
    const today = tally.size ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] : "";
    let missing = 0;
    rows.forEach((r) => missing += r ? 0 : 1);
    return {
      status: today ? "ok" : "error",
      rows,
      today,
      end: today ? addDays2(today, O2.horizon - 1) : "",
      missing,
      at,
      err: today ? "" : "The weather service sent no usable forecast."
    };
  }
  var storeKey2 = (O2, k) => `burn-world-outlook-v${O2.v}.2-${O2.built}-${k}`;
  function fromStore2(O2, k, want) {
    try {
      const raw = localStorage.getItem(storeKey2(O2, k));
      if (!raw) return null;
      const s2 = JSON.parse(raw);
      if (!s2 || typeof s2.at !== "number" || Date.now() - s2.at > KEEP_MS2 || !Array.isArray(s2.rows)) return null;
      const rows = /* @__PURE__ */ new Map();
      for (const [ri, p, base2, norm2, thr, hm, today, zMax] of s2.rows)
        rows.set(ri, { p, base: base2, ratio: p / base2, norm: norm2, wxRatio: p / norm2, thr, hm, today, zMax });
      for (const ri of Array.isArray(s2.gaps) ? s2.gaps : []) rows.set(ri, null);
      if (want.some((ri) => !rows.has(ri))) return null;
      const run = finish2(O2, rows, s2.at);
      return run.status === "ok" ? run : null;
    } catch {
      return null;
    }
  }
  function toStore2(O2, k, run) {
    try {
      const rows = [], gaps = [];
      run.rows.forEach((r, ri) => r ? rows.push([ri, r.p, r.base, r.norm, r.thr, r.hm, r.today, r.zMax]) : gaps.push(ri));
      localStorage.setItem(storeKey2(O2, k), JSON.stringify({ at: run.at, rows, gaps }));
    } catch {
    }
  }
  var runs2 = /* @__PURE__ */ new Map();
  var busy2 = /* @__PURE__ */ new Set();
  var wolRun = (k) => runs2.get(k) || null;
  async function getDailyTwice(O2, ris) {
    try {
      return await getDaily2(O2, ris);
    } catch (e) {
      if (e instanceof WeatherError2 && /limit|offline/.test(e.message)) throw e;
      return getDaily2(O2, ris);
    }
  }
  function wolLoad(O2, k, done) {
    if (busy2.has(k)) return;
    const regs = countryRegions(O2, k).used, shareOf = new Map(regs.map((r) => [r.ri, r.share])), total2 = regs.reduce((a, r) => a + r.share, 0) || 1, have = runs2.get(k), keep = have && have.status === "ok" && Date.now() - have.at < KEEP_MS2 ? have : null;
    if (keep && !keep.err) return done();
    if (!keep) {
      const stored = fromStore2(
        O2,
        k,
        regs.map((r) => r.ri)
      );
      if (stored) {
        runs2.set(k, stored);
        return done();
      }
      runs2.set(k, { status: "loading", rows: /* @__PURE__ */ new Map(), today: "", end: "", missing: 0, at: 0, err: "" });
    }
    done();
    const want = regs.map((r) => r.ri).filter((ri) => !keep || !keep.rows.get(ri));
    busy2.add(k);
    (async () => {
      if (!keep) {
        const s2 = await loadSnapshot();
        if (s2 && s2.model === modelId(O2)) {
          const rows = new Map(regs.map((r) => [r.ri, fromSnap(O2, s2, r.ri)]));
          let answered = 0;
          rows.forEach((r, ri) => answered += r ? shareOf.get(ri) || 0 : 0);
          if (answered / total2 >= MIN_SHARE) {
            const run = finish2(O2, rows, Date.parse(s2.at));
            if (run.status === "ok") {
              runs2.set(k, { ...run, from: "snapshot" });
              busy2.delete(k);
              return done();
            }
          }
        }
      }
      try {
        const chunks = [];
        const size2 = Math.min(CHUNK2, O2.api.max_points_per_get);
        for (let i = 0; i < want.length; i += size2) chunks.push(want.slice(i, i + size2));
        const got = await Promise.allSettled(chunks.map((c) => getDailyTwice(O2, c)));
        const failed = got.find((g) => g.status === "rejected");
        const rows = new Map(keep ? keep.rows : regs.map((r) => [r.ri, null]));
        got.forEach((g, j) => {
          if (g.status === "fulfilled") chunks[j].forEach((ri, i) => rows.set(ri, work2(O2, ri, g.value[i])));
        });
        let answered = 0;
        rows.forEach((r, ri) => answered += r ? shareOf.get(ri) || 0 : 0);
        if (answered / total2 < MIN_SHARE) throw failed ? failed.reason : new WeatherError2("The weather service sent no usable forecast.");
        const run = { ...finish2(O2, rows, keep ? keep.at : Date.now()), from: "live" };
        if (failed) run.err = failed.reason instanceof WeatherError2 ? failed.reason.message : "Part of the forecast did not arrive.";
        runs2.set(k, run);
        if (run.status === "ok" && !failed) toStore2(O2, k, run);
      } catch (e) {
        const err = e instanceof WeatherError2 ? e.message : "The outlook could not be worked out.";
        runs2.set(k, keep ? { ...keep, err } : { status: "error", rows: /* @__PURE__ */ new Map(), today: "", end: "", missing: want.length, at: 0, err });
      } finally {
        busy2.delete(k);
        done();
      }
    })();
  }

  // src/wolui.ts
  var REGION_STEP = 0.05;
  var MINOR = "#e4e0d7";
  var ODD = "#c9c2b4";
  var P_CAP = 0.85;
  var esc4 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  var pct3 = (p) => p > P_CAP ? "over 85%" : p < 0.02 ? "under 2%" : Math.round(p * 100) + "%";
  var change = (r) => Math.min(r.p, P_CAP) - Math.min(r.norm, P_CAP);
  var pts = (d) => {
    const r = Math.round(d * 100);
    return r === 0 ? "no change" : `${r > 0 ? "+" : "\u2212"}${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"}`;
  };
  var signed = (x, dp = 1) => `${x > 0 ? "+" : x < 0 ? "\u2212" : ""}${Math.abs(x * 100).toFixed(dp)}%`;
  var deg = (v, p, n) => `${Math.abs(v).toFixed(1)}\xB0${v < 0 ? n : p}`;
  function span2(a, b) {
    const [y0, m0, d0] = a.split("-").map(Number), [y1, m1, d1] = b.split("-").map(Number);
    if (y0 !== y1) return `${d0} ${MONL[m0 - 1]} ${y0} \u2013 ${d1} ${MONL[m1 - 1]} ${y1}`;
    if (m0 !== m1) return `${d0} ${MONL[m0 - 1]} \u2013 ${d1} ${MONL[m1 - 1]} ${y1}`;
    return `${d0}\u2013${d1} ${MONL[m1 - 1]} ${y1}`;
  }
  var halfName = (hm) => `the ${hm % 2 ? "second" : "first"} half of ${MONL[hm >> 1]}`;
  var ZONE_NAME = {
    tropics: "the tropics",
    subtropics: "the subtropics",
    temperate: "temperate latitudes",
    boreal: "the far north and south"
  };
  function place(O2, k) {
    const { used, minor } = countryRegions(O2, k), all = [...used.map((r) => ({ ...r, minor: false })), ...minor.map((r) => ({ ...r, minor: true }))], shape = shapeOf(k), b0 = cellBounds(O2.regions.band[all[0].ri], O2.regions.col[all[0].ri]), lon02 = shape ? shape.c[0] : (b0[0] + b0[2]) / 2, boxes = all.map((r) => {
      const b = cellBounds(O2.regions.band[r.ri], O2.regions.col[r.ri]), w = b[2] - b[0], c = near((b[0] + b[2]) / 2, lon02);
      return [c - w / 2, b[1], c + w / 2, b[3]];
    }), latMid = boxes.reduce((a, b) => a + (b[1] + b[3]) / 2, 0) / boxes.length, kx = Math.max(0.2, Math.cos(latMid * Math.PI / 180)), run = wolRun(k);
    return {
      lon0: lon02,
      kx,
      cells: all.map((r, i) => ({
        ...r,
        box: boxes[i],
        x: (boxes[i][0] + boxes[i][2]) / 2 * kx,
        y: (boxes[i][1] + boxes[i][3]) / 2,
        r: !r.minor && run?.rows.get(r.ri) || null,
        noSkill: (O2.regions.bss_live[r.ri] ?? 1) <= 0,
        odd: !r.minor && !!run?.rows.get(r.ri) && isOdd(run.rows.get(r.ri))
      }))
    };
  }
  function compass(cells, sub) {
    const wt = (c) => c.share + 1e-6, mean = (cs) => {
      const s3 = cs.reduce((a2, c) => a2 + wt(c), 0);
      return [cs.reduce((a2, c) => a2 + c.x * wt(c), 0) / s3, cs.reduce((a2, c) => a2 + c.y * wt(c), 0) / s3];
    };
    const [x0, y0] = mean(cells), [x1, y1] = mean(sub), s2 = cells.reduce((a2, c) => a2 + c.share, 0) || 1, spread2 = Math.sqrt(cells.reduce((a2, c) => a2 + c.share * ((c.x - x0) ** 2 + (c.y - y0) ** 2), 0) / s2), dx = x1 - x0, dy = y1 - y0;
    if (spread2 < 0.5) return "centre";
    if (Math.hypot(dx, dy) < 0.35 * spread2) {
      const s1 = sub.reduce((a2, c) => a2 + c.share, 0) || 1, subSpread = Math.sqrt(sub.reduce((a2, c) => a2 + c.share * ((c.x - x1) ** 2 + (c.y - y1) ** 2), 0) / s1);
      return sub.length > 1 && subSpread > 0.6 * spread2 ? "scattered" : "centre";
    }
    const a = Math.atan2(dy, dx) * 180 / Math.PI, i = Math.round((90 - a + 360) % 360 / 45) % 8;
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][i];
  }
  var whereIn = (cells, c) => compass(
    cells.filter((z) => !z.minor),
    [c]
  );
  var poss = (t) => /s$/.test(t) ? `${t}'` : `${t}'s`;
  var busier = (thr) => thr === 0 ? "at least one hotspot" : `more than ${thr.toLocaleString("en-US")} hotspot${thr === 1 ? "" : "s"}`;
  var openK = null;
  function olOpen(k) {
    openK = k;
    $("cOl").hidden = false;
    state(`Loading the outlook for ${theName(nameOf(k))}\u2026`);
    $("cOlMain").hidden = true;
    $("cOlTitle").textContent = "Next 14 days";
    $("cOlKick").textContent = "Next 14 days";
    $("cOlSub").textContent = $("cOlHow").innerHTML = $("cOlSrc").textContent = "";
    $("cOlFigs").innerHTML = $("cOlMap").innerHTML = $("cOlList").innerHTML = $("cOlLegend").innerHTML = "";
    start(k);
  }
  function olClose() {
    openK = null;
  }
  function start(k) {
    loadWorldOutlook().then(
      (O2) => {
        if (openK !== k) return;
        const name = nameOf(k), m = O2.metrics.by_country[k];
        if (!O2.countries[k] || !m) return noRegions(O2, k, name);
        if (!countryPasses(O2, k)) return noSkill(O2, k, name);
        wolLoad(O2, k, () => openK === k && draw(O2, k));
      },
      () => {
        if (openK !== k) return;
        state("The outlook's data file did not load.", true);
      }
    );
  }
  function state(msg, retry = false) {
    $("cOlState").hidden = !msg;
    $("cOlMsg").textContent = msg;
    $("cOlRetry").hidden = !retry;
  }
  function olEventsWorld() {
    $("cOlRetry").onclick = () => {
      if (!openK) return;
      state("Trying again\u2026");
      start(openK);
    };
  }
  function noRegions(O2, k, name) {
    const n = O2.no_region[k];
    $("cOlTitle").textContent = "Too little fire history for an outlook";
    $("cOlSub").textContent = n ? `NASA's VIIRS satellite counted only ${n.toLocaleString("en-US")} fire hotspot${n === 1 ? "" : "s"} in ${theName(name)} from 2012 to 2025. That is too few to say what a usual fortnight looks like, so there is no 14-day outlook here.` : `Once offshore and industrial detections are removed, NASA's VIIRS satellite counted no vegetation-fire hotspots in ${theName(name)} from 2012 to 2025, so there is nothing to forecast here.`;
    state("");
    $("cOlHow").innerHTML = "";
    $("cOlSrc").textContent = `The 14-day outlook covers the ${Object.keys(O2.countries).length} countries and territories with enough fire history. Fire history: NASA FIRMS, VIIRS on Suomi NPP.`;
  }
  function noSkill(O2, k, name) {
    const m = O2.metrics.by_country[k], tn = theName(name);
    $("cOlTitle").textContent = `No 14-day outlook we can stand behind for ${tn}`;
    $("cOlSub").textContent = m[0] <= 0 ? `In past years this outlook did not beat the usual odds in ${tn} (Brier skill ${signed(m[0])}), even when it was given the weather that actually happened. ` : `In past years this outlook beat the usual odds in ${tn} only when it was given the weather that actually happened (Brier skill ${signed(m[0])}). ` + (m[5] <= 0 ? `With weather as far off as the forecast source it did not (${signed(m[5])}). ` : `With weather as far off as the forecast source it beat them by only ${signed(m[5])}, less than the ${signed(LIVE_GATE, 0)} margin we ask for to cover the forecast's own errors. `);
    $("cOlSub").textContent += `Treat the next two weeks as usual for the time of year. We do not fetch a forecast for it.`;
    state("");
    how(O2, k, name);
  }
  function draw(O2, k) {
    const run = wolRun(k), name = nameOf(k), tn = theName(name), n = countryRegions(O2, k).used.length;
    if (!run) return;
    if (run.status === "loading") {
      $("cOlMain").hidden = true;
      state(`Getting the weather forecast for ${poss(tn)} ${n} region${n === 1 ? "" : "s"}\u2026`);
      return;
    }
    if (run.status === "error") {
      $("cOlMain").hidden = true;
      $("cOlTitle").textContent = "Next 14 days";
      $("cOlSub").textContent = "";
      state(`${run.err} The rest of this page is unaffected.`, true);
      how(O2, k, name);
      return;
    }
    state(run.err ? `${run.err} ${run.missing} region${run.missing === 1 ? " has" : "s have"} no outlook and show white.` : "", !!run.err);
    const L2 = place(O2, k), used = L2.cells.filter((c) => !c.minor), S3 = sumUp(used), live = used.filter((c) => c.r && !c.odd), odd = used.filter((c) => c.r && c.odd), thin = S3.liveShare < MIN_SHARE, { P: P2, N, D: D2 } = S3, sw = live.reduce((a, c) => a + c.share, 0) || 1, up = live.filter((c) => change(c.r) >= REGION_STEP), down = live.filter((c) => change(c.r) <= -REGION_STEP), upShare = up.reduce((a, c) => a + c.share, 0) / sw, downShare = down.reduce((a, c) => a + c.share, 0) / sw, many = live.length > 2, where = (sub, share2) => {
      if (!many) return "";
      if (share2 >= 0.6) return S3.liveShare >= 0.95 ? " across most of the country" : " across most of the regions forecast";
      const w = compass(live, sub);
      return w === "scattered" ? " in scattered regions" : w === "centre" ? " in the centre of the country" : ` in the ${w}`;
    };
    const lead2 = "Satellite fire detections over the next two weeks look";
    let head;
    if (thin)
      head = `No reliable outlook for ${tn} today: for ${Math.round((1 - S3.liveShare) * 100)}% of its fire the forecast is missing or the weather is outside anything in the 2012\u20132025 record`;
    else if (D2 >= COUNTRY_STEP) head = `${lead2} busier than usual${where(up.length ? up : live, up.length ? upShare : 1)}`;
    else if (D2 <= -COUNTRY_STEP) head = `${lead2} quieter than usual${where(down.length ? down : live, down.length ? downShare : 1)}`;
    else if (upShare >= 0.1 && downShare >= 0.1 && many)
      head = `${lead2} about usual overall: busier${where(up, upShare)}, quieter${where(down, downShare)}`;
    else if (upShare >= 0.1 && many) head = `${lead2} about usual overall, but busier${where(up, upShare)}`;
    else if (downShare >= 0.1 && many) head = `${lead2} about usual overall, but quieter${where(down, downShare)}`;
    else head = `${lead2} about usual`;
    const hm = halfMonth(run.today), oddShare = 1 - S3.liveShare - used.filter((c) => !c.r).reduce((a, c) => a + c.share, 0) / (used.reduce((a, c) => a + c.share, 0) || 1);
    $("cOlKick").textContent = `Next 14 days \xB7 ${span2(run.today, run.end)}`;
    $("cOlTitle").textContent = head;
    $("cOlSub").textContent = `The chance that each region sees more satellite fire detections over ${span2(run.today, run.end)} than in a usual fortnight for ${halfName(hm)}, against its chance with average weather. Weather: Open-Meteo forecast; trained on NASA POWER.` + (odd.length && oddShare >= 0.1 ? ` In ${odd.length} of ${odd.length + live.length} regions, holding ${Math.round(oddShare * 100)}% of the fire, the forecast weather is outside anything in the 2012\u20132025 record for the date, so the model would be extrapolating. That may be unusual weather or a gap between the two weather sources; we cannot tell which. They are shown in grey and left out of the summaries.` : "");
    const m = O2.metrics.by_country[k], verdict2 = D2 >= COUNTRY_STEP ? ["hi", "Busier than usual"] : D2 <= -COUNTRY_STEP ? ["lo", "Quieter than usual"] : ["", "About usual"], regionsWord = live.length === 1 ? "its one forecast region" : live.length === 2 ? "its two forecast regions" : `its ${live.length} forecast regions`;
    $("cOlFigs").innerHTML = `<div class="cpAns"><h2>The whole country</h2><p class="cpFig"><span class="${verdict2[0]}">${verdict2[1]}</span><small>${pct3(P2)} chance of a busier fortnight than usual, against ${pct3(N)} with average weather</small></p><p>Averaged over ${regionsWord}${live.length > 1 ? `, each weighted by its share of ${esc4(poss(tn))} fire` : ""}.` + (odd.length ? ` ${odd.length === 1 ? "One region is" : `${odd.length} regions are`} left out: ${odd.length === 1 ? "its" : "their"} forecast weather is outside the 2012\u20132025 record for the date.` : "") + `</p></div><div class="cpAns"><h2>Regions the weather pushes up</h2><p class="cpFig">${up.length} of ${live.length}</p><p>The weather raises the chance by 5 points or more in ${up.length === 0 ? "none" : up.length === 1 ? "one region" : `${up.length} regions`}, and lowers it as much in ${down.length === 0 ? "none" : down.length === 1 ? "one" : down.length}. A region is about 280 km across.</p></div><div class="cpAns"><h2>Track record</h2><p class="cpFig">${signed(m[5])}<small>against the usual odds</small></p><p>Brier skill in the regions covering ${esc4(tn)}, 2012\u20132025, with errors the size of the gap between the two weather sources added to the weather that happened (${signed(m[0])} with that weather as it was). Never tested on real forecasts, which are worse still.</p></div>`;
    legend2(L2);
    drawMap(L2, k, run.missing);
    list(O2, L2, tn, D2);
    $("cOlFigs").hidden = $("cOlList").parentElement.hidden = thin || !live.length;
    $("cOlMain").hidden = false;
    how(O2, k, name, run.at, run.from);
  }
  function legend2(L2) {
    const steps = RAMP.map(
      (c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : (EDGES[i - 1] > 0 ? "+" : "") + Math.round(EDGES[i - 1] * 100)}</span></div>`
    ).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span></span></div>`;
    const hatch = L2.cells.some((c) => c.noSkill), minor = L2.cells.some((c) => c.minor), odd = L2.cells.some((c) => c.odd);
    $("cOlLegend").innerHTML = `<div><b>Change from the weather, percentage points</b><div class="cpKey">${steps}</div></div>` + (hatch ? `<span class="cpNone"><i class="cpHatch"></i>no skill here in past tests</span>` : "") + (odd ? `<span class="cpNone"><i style="background:${ODD}"></i>weather outside its 2012\u20132025 record, left out</span>` : "") + (minor ? `<span class="cpNone"><i style="background:${MINOR}"></i>little fire, not forecast</span>` : "");
  }
  function drawMap(L2, k, missing) {
    const S3 = 10, X = (lon) => (lon - L2.lon0) * L2.kx * S3, Y = (lat) => -lat * S3;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of L2.cells) {
      x0 = Math.min(x0, X(c.box[0]));
      x1 = Math.max(x1, X(c.box[2]));
      y0 = Math.min(y0, Y(c.box[3]));
      y1 = Math.max(y1, Y(c.box[1]));
    }
    const pad2 = 0.08 * Math.max(x1 - x0, y1 - y0) + 4;
    x0 -= pad2;
    x1 += pad2;
    y0 -= pad2;
    y1 += pad2;
    $("cOlMap").closest(".cpOlGrid")?.classList.toggle("wide", (x1 - x0) / (y1 - y0) > 1.8);
    const shape = shapeOf(k);
    let land = "", lines2 = "";
    if (shape)
      for (const r of shape.r) {
        const off = near(r[0], L2.lon0) - r[0];
        land += "M";
        for (let i = 0; i < r.length; i += 2) land += `${X(r[i] + off).toFixed(1)},${Y(r[i + 1]).toFixed(1)} `;
        land += "Z";
        for (let i = 0; i + 3 < r.length; i += 2) {
          if (cutEdge(k, r[i], r[i + 1], r[i + 2], r[i + 3])) continue;
          lines2 += `M${X(r[i] + off).toFixed(1)},${Y(r[i + 1]).toFixed(1)}L${X(r[i + 2] + off).toFixed(1)},${Y(r[i + 3]).toFixed(1)}`;
        }
      }
    const cells = L2.cells.map((c, i) => {
      const fill = c.minor ? MINOR : c.odd ? ODD : c.r ? changeColour(change(c.r)) : "#fff";
      const rect = `x="${X(c.box[0]).toFixed(1)}" y="${Y(c.box[3]).toFixed(1)}" width="${(X(c.box[2]) - X(c.box[0])).toFixed(1)}" height="${(Y(c.box[1]) - Y(c.box[3])).toFixed(1)}"`;
      return `<rect ${rect} fill="${fill}" class="olCell" data-i="${i}"/>` + (c.noSkill && c.r ? `<rect ${rect} fill="url(#olHatch)" pointer-events="none"/>` : "");
    }).join("");
    $("cOlMap").innerHTML = `<svg viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}" role="img" aria-label="Map of ${esc4(poss(theName(nameOf(k))))} regions, coloured by how much the forecast weather changes the chance of a busier fortnight than usual"><defs><pattern id="olHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#55524c" stroke-width="1.2" vector-effect="non-scaling-stroke"/></pattern></defs><path d="${land}" fill="#ebe8e1" fill-rule="evenodd"/><g stroke="#fffefa" stroke-width="1" vector-effect="non-scaling-stroke">${cells}</g><path d="${lines2}" fill="none" stroke="#1b1b1b" stroke-opacity=".75" stroke-width="1.1" vector-effect="non-scaling-stroke" pointer-events="none"/></svg>`;
    const pick2 = $("cOlPick"), idle = (coarseP() ? "Tap" : "Point at") + " a square for its numbers." + (missing ? ` ${missing} region${missing === 1 ? "" : "s"} had gaps in the forecast and show white.` : "");
    pick2.textContent = idle;
    const svg = $("cOlMap").querySelector("svg");
    let on = null;
    const show = (e) => {
      const t = e.target;
      if (!(t instanceof SVGRectElement) || !t.classList.contains("olCell")) return;
      if (on) on.classList.remove("on");
      on = t;
      t.classList.add("on");
      pick2.innerHTML = cellText(L2, L2.cells[Number(t.dataset.i)]);
    };
    svg.onpointerover = show;
    svg.onclick = show;
    svg.onpointerleave = () => {
      if (coarseP()) return;
      if (on) on.classList.remove("on");
      on = null;
      pick2.textContent = idle;
    };
  }
  var coarseP = () => matchMedia("(pointer: coarse)").matches;
  function cellText(L2, c) {
    const b = c.box, pos = `${deg(b[1], "N", "S")}\u2013${deg(b[3], "N", "S")}, ${deg(near(b[0], 0), "E", "W")}\u2013${deg(near(b[2], 0), "E", "W")}`, sh = c.share >= 0.01 ? `${Math.round(c.share * 100)}%` : c.share >= 1e-3 ? `${(c.share * 100).toFixed(1)}%` : "under 0.1%";
    if (c.minor) return `<b>${cap(whereIn(L2.cells, c))}, ${pos}</b>: ${sh} of the country's fire, too little to forecast here.`;
    if (!c.r) return `<b>${cap(whereIn(L2.cells, c))}, ${pos}</b>: no outlook, the forecast had gaps.`;
    const r = c.r;
    return `<b>${cap(whereIn(L2.cells, c))}, ${pos}</b>: ${pct3(r.p)} chance of ${busier(r.thr)} in 14 days, against ${pct3(r.norm)} with average weather (${pts(change(r))}). ${sh} of the country's fire.` + (c.noSkill ? " In past tests allowing for the weather source's errors, the outlook did not beat the usual odds in this region." : "") + (c.odd ? ` Left out: the forecast weather here is ${c.r.zMax.toFixed(1)} standard deviations from the usual for the date, outside anything in the 2012\u20132025 record (that far out in about 1 in 100 past fortnights), so the model would be extrapolating. It may be unusual weather or a gap between the two weather sources; we cannot tell which.` : "");
  }
  function list(O2, L2, tn, D2) {
    const live = L2.cells.filter((c) => c.r && !c.odd), big2 = live.filter((c) => c.share >= 0.01), pool = big2.length >= 3 ? big2 : live, by = (c) => change(c.r), rising = Math.abs(D2) >= COUNTRY_STEP ? D2 > 0 : pool.some((c) => by(c) >= 0.03) || !pool.some((c) => by(c) <= -0.03), rows = pool.slice().sort((a, b) => rising ? by(b) - by(a) : by(a) - by(b)).slice(0, 5);
    $("cOlListT").textContent = rising ? "Where the weather raises the odds most" : "Where the weather lowers the odds most";
    $("cOlList").innerHTML = rows.map((c) => {
      const r = c.r, d = by(c);
      return `<li><span class="olW"><b>${cap(whereIn(L2.cells, c))}${c.noSkill ? " \u2020" : ""}</b><small>near ${deg(O2.regions.lat[c.ri], "N", "S")}, ${deg(O2.regions.lon[c.ri], "E", "W")} \xB7 ${Math.round(c.share * 100) || "<1"}% of ${esc4(poss(tn))} fire</small><small>busier than usual: ${busier(r.thr)} in 14 days</small></span><span class="olN">${pct3(r.p)}<small>vs ${pct3(r.norm)}</small></span><span class="olD" style="--c:${changeColour(d)}">${pts(d)}</span></li>`;
    }).join("");
    $("cOlListNote").textContent = (big2.length >= 3 ? "Regions holding at least 1% of the country's fire. " : "") + (rows.some((c) => c.noSkill) ? "\u2020 In past tests allowing for the weather source's errors, the outlook did not beat the usual odds in this region." : "");
  }
  function how(O2, k, name, at = 0, from) {
    const tn = theName(name), m = O2.metrics.by_country[k], regs = O2.countries[k] || [], zw = /* @__PURE__ */ new Map();
    regs.forEach(([ri, s2]) => zw.set(O2.regions.zone[ri], (zw.get(O2.regions.zone[ri]) || 0) + s2 + 1e-3));
    const zi = [...zw.entries()].sort((a, b) => b[1] - a[1])[0]?.[0], zone = zi == null ? null : O2.zones[zi], zm = zone ? O2.metrics.by_zone[zone] : null, zn = zone ? ZONE_NAME[zone] || zone : "", all = O2.metrics.variants, bss = (re) => Object.entries(all).find(([key]) => re.test(key))?.[1].bss ?? NaN, worldLive = bss(/^trained for the full source gap, tested with it/), pass = countryPasses(O2, k);
    const test = !m ? "" : `Tested year by year on 2012\u20132025, each year predicted by a model fitted on the others: with the weather that actually happened (NASA POWER) it beat the usual odds by ${signed(m[0])} in the regions covering ${esc4(tn)} (AUC ${m[2].toFixed(2)} \u2192 ${m[1].toFixed(2)})` + (zm ? ` and by ${signed(zm.model.bss)} across ${zn}` : "") + `. With errors the size of the gap between the two weather sources added to that weather, the score is ${signed(m[5])} here` + (zm ? ` and ${signed(zm.live_bss)} across ${zn}` : "") + ` (${signed(worldLive)} worldwide). `;
    $("cOlHow").innerHTML = `<b>How this works.</b> For each region about 280 km across, a statistical model starts from how often this half of the month has been busier than usual (VIIRS hotspots, 2012\u20132025) and moves that chance with the forecast heat, air dryness and rain of the next 14 days and the rain of the past 30. Clouds and rain also hide fires from the satellite, so part of the rain effect is fewer detections, not fewer fires. The live weather comes from Open-Meteo, not from POWER, the source the model learned on, and outside the weeks the correction between them was learned on (August\u2013September 2026) they differ about as much as with no correction at all. So the model was fitted on weather blurred by that gap, and moves the odds less than it would with perfect weather. ` + test + (pass ? `<b>None of these tests used a real forecast,</b> and forecasts add their own errors, more so in the second week. Treat this outlook as a hint: it may do no better than the usual odds.` : `<b>None of these tests used a real forecast,</b> so a forecast would not do better here.`);
    $("cOlSrc").textContent = (at ? `Forecast fetched ${new Date(at).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` + (from === "snapshot" ? " for the site's daily snapshot. " : ". ") : "") + (pass ? "Weather: Open-Meteo forecast; trained on NASA POWER (MERRA-2). " : "Training weather: NASA POWER (MERRA-2). ") + `Fire history: NASA FIRMS, VIIRS on Suomi NPP. Each region's weather is read at one point, the centre of its busiest patch, and regions cross borders. Hotspots are detections, not fires, and many are farm or managed burns.`;
  }

  // src/libs.ts
  var MAPLIBRE = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js";
  var MAPLIBRE_CSS = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css";
  var D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
  var PLOT = "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/dist/plot.umd.min.js";
  var FONTS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400&display=swap";
  function script(src) {
    return new Promise((ok, fail) => {
      const s2 = document.createElement("script");
      s2.src = src;
      s2.async = false;
      s2.onload = () => ok();
      s2.onerror = () => {
        s2.remove();
        fail(new Error(`${new URL(src).hostname} did not answer`));
      };
      document.head.appendChild(s2);
    });
  }
  function style(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
  var mapP = null;
  var plotP = null;
  function loadMapLib() {
    if (window.maplibregl) return Promise.resolve();
    if (!mapP) {
      style(MAPLIBRE_CSS);
      mapP = script(MAPLIBRE);
      mapP.catch(() => mapP = null);
    }
    return mapP;
  }
  function loadPlotLib() {
    if (window.Plot && window.d3) return Promise.resolve();
    if (!plotP) {
      plotP = (window.d3 ? Promise.resolve() : script(D3)).then(() => window.Plot ? void 0 : script(PLOT));
      plotP.catch(() => plotP = null);
    }
    return plotP;
  }
  var loadFonts = () => style(FONTS);

  // src/cmap.ts
  var STYLE = "https://tiles.openfreemap.org/styles/positron";
  var FIRE = ["#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];
  function classColours(breaks, ramp = FIRE) {
    if (!breaks.length) return [ramp[3]];
    const cols = breaks.length + 1;
    return Array.from({ length: cols }, (_, i) => ramp[Math.round(i * (ramp.length - 1) / (cols - 1))]);
  }
  var INK = "#1b1b1b";
  function cellIndexes(d) {
    const n = d.cells.length / 2, la = new Int32Array(n), lo = new Int32Array(n), lim = 180 / d.cell + 1;
    for (let c = 0; c < n; c++) {
      la[c] = d.cells[2 * c];
      lo[c] = d.cells[2 * c + 1];
      if (lo[c] > lim) {
        lo[c] -= 1e5;
        la[c] += 1;
      }
    }
    return { la, lo };
  }
  function nice(v) {
    if (v < 1) return Math.round(v * 10) / 10 || 0.1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7.5 ? 5 : 10) * p;
  }
  var PROBS = [0.25, 0.45, 0.62, 0.76, 0.87, 0.95];
  function classBreaks(vals) {
    const pos = vals.filter((v) => v > 0).sort((a, b) => a - b);
    if (!pos.length) return { breaks: [], max: 0, min: 0 };
    const max = pos[pos.length - 1], min = pos[0], out = [];
    for (const q of PROBS) {
      const b = nice(pos[Math.floor(q * (pos.length - 1))]);
      if (b > (out.length ? out[out.length - 1] : min) && b < max) out.push(b);
    }
    return { breaks: out, max, min };
  }
  function pad(b) {
    const px = Math.max(0, 0.5 - (b[2] - b[0])) / 2, py = Math.max(0, 0.5 - (b[3] - b[1])) / 2;
    return [b[0] - px, Math.max(-85, b[1] - py), b[2] + px, Math.min(85, b[3] + py)];
  }
  function centreLon(d, lo = cellIndexes(d).lo) {
    const shape = shapeOf(d.country);
    if (shape) return shape.c[0];
    if (!lo.length) return (d.bbox[0] + d.bbox[2]) / 2;
    const ls = Array.from(lo, (v) => v * d.cell).sort((a, b) => a - b);
    return ls[Math.floor(ls.length / 2)];
  }
  function mapData(d, yFrom, yTo) {
    const shape = shapeOf(d.country), cell = d.cell, nc = d.cells.length / 2, { la, lo } = cellIndexes(d), tot = new Float64Array(nc), modis = new Float64Array(nc), viirs = new Float64Array(nc);
    for (let p = 0; p < d.cell_rows.length; p += 5) {
      const y = d.y0 + d.cell_rows[p + 1];
      if (y < yFrom || y > yTo) continue;
      const c = d.cell_rows[p];
      tot[c] += d.cell_rows[p + 2];
      modis[c] += d.cell_rows[p + 3];
      viirs[c] += d.cell_rows[p + 4];
    }
    const lon02 = centreLon(d, lo);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (x, y) => {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    };
    const cells = [];
    for (let c = 0; c < nc; c++) {
      if (tot[c] + modis[c] + viirs[c] <= 0) continue;
      const s2 = la[c] * cell, w = near(lo[c] * cell + cell / 2, lon02) - cell / 2, e = w + cell, n = s2 + cell;
      grow(w, s2);
      grow(e, n);
      cells.push({
        type: "Feature",
        properties: { n: tot[c], mo: modis[c], vi: viirs[c], s: s2, w: lo[c] * cell },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s2],
              [e, s2],
              [e, n],
              [w, n],
              [w, s2]
            ]
          ]
        }
      });
    }
    const lines2 = [];
    if (shape)
      for (const r of shape.r) {
        const off = near(r[0], lon02) - r[0];
        let run = [];
        const flush = () => {
          if (run.length > 1) lines2.push(run);
          run = [];
        };
        for (let i = 0; i + 3 < r.length; i += 2) {
          if (cutEdge(d.country, r[i], r[i + 1], r[i + 2], r[i + 3])) {
            flush();
            continue;
          }
          if (!run.length) run.push([r[i] + off, r[i + 1]]);
          run.push([r[i + 2] + off, r[i + 3]]);
          grow(r[i] + off, r[i + 1]);
        }
        flush();
      }
    if (!isFinite(x0)) {
      grow(near(d.bbox[0], lon02), d.bbox[1]);
      grow(near(d.bbox[2], lon02), d.bbox[3]);
    }
    const all = pad([x0, y0, x1, y1]);
    let bounds = all;
    if (cells.length) {
      const wt = cells.map((f) => Math.max(f.properties.n, 0.01)), sum2 = wt.reduce((a, b) => a + b, 0), at = (key, q) => {
        const idx = cells.map((_, i) => i).sort((a, b) => key(a) - key(b));
        let acc = 0;
        for (const i of idx) {
          acc += wt[i];
          if (acc >= q * sum2) return key(i);
        }
        return key(idx[idx.length - 1]);
      }, edge = (i, k) => cells[i].geometry.coordinates[0][k * 2], w = at((i) => edge(i, 0)[0], 0.01), s0 = at((i) => edge(i, 0)[1], 0.01), e = at((i) => edge(i, 1)[0], 0.99), n = at((i) => edge(i, 1)[1], 0.99), dx = (e - w) * 0.06, dy = (n - s0) * 0.06;
      bounds = pad([w - dx, s0 - dy, e + dx, n + dy]);
    }
    const dw = all[2] - all[0], dh = all[3] - all[1], keep = (i, d2) => Math.abs(all[i] - bounds[i]) < 0.15 * d2 ? all[i] : bounds[i];
    bounds = [keep(0, dw), keep(1, dh), keep(2, dw), keep(3, dh)];
    const cropped = bounds.some((b, i) => b !== all[i]);
    const { breaks, max, min } = classBreaks(cells.map((f) => f.properties.n));
    return {
      cells: { type: "FeatureCollection", features: cells },
      outline: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines2 } }]
      },
      bounds,
      all,
      cropped,
      min,
      breaks,
      max,
      n: cells.length
    };
  }
  function fillExpr(breaks) {
    const c = classColours(breaks);
    if (!breaks.length) return c[0];
    const e = ["step", ["get", "n"], c[0]];
    breaks.forEach((b, i) => e.push(b, c[i + 1]));
    return e;
  }
  var L = null;
  var readyFns = [];
  var onMapReady = (f) => readyFns.push(f);
  var hideCellPopup = () => L?.popup?.remove();
  function destroyMap() {
    if (!L) return;
    try {
      L.map?.remove();
    } catch {
    }
    L = null;
  }
  var deg2 = (v, p, n) => `${Math.abs(v).toFixed(2)}\xB0${v < 0 ? n : p}`;
  function popupHtml(p, cell, yFrom, yTo) {
    const n = p.n;
    return `<b>${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}</b> <span>in ${yFrom === yTo ? yFrom : `${yFrom}\u2013${yTo}`}, adjusted</span><span>Raw: ${fmt(p.mo)} MODIS, ${fmt(p.vi)} Suomi NPP</span><span class="pos">${deg2(p.s, "N", "S")}\u2013${deg2(p.s + cell, "N", "S")}, ${deg2(p.w, "E", "W")}\u2013${deg2(p.w + cell, "E", "W")}</span>`;
  }
  var PAPER = "#f5f4f0";
  var WATER = "#dde5ea";
  var FALLBACK = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eeebe4" } }] };
  var DROP = /^(highway-name|highway-shield|road_shield|airport|waterway_line_label)/;
  var LATIN = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
  function tidyStyle(st) {
    st.layers = st.layers.filter((l) => !DROP.test(l.id)).map((l) => {
      if (l.id === "background") l.paint = { ...l.paint, "background-color": PAPER };
      if (l.id === "water") l.paint = { ...l.paint, "fill-color": WATER };
      if (l.id === "waterway") l.paint = { ...l.paint, "line-color": WATER };
      if (l.layout && l.layout["text-field"] && /name/.test(JSON.stringify(l.layout["text-field"])))
        l.layout = { ...l.layout, "text-field": LATIN };
      return l;
    });
    return st;
  }
  var styleP = null;
  function getStyle() {
    if (!styleP)
      styleP = Promise.race([
        fetch(STYLE).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        }),
        new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8e3))
      ]).then(tidyStyle, () => {
        styleP = null;
        return FALLBACK;
      });
    return styleP;
  }
  function showMap(host, d, data, yFrom, yTo, onFail, onBasemap) {
    const ml = window.maplibregl;
    if (!ml) return onFail("The map library did not load.");
    const fresh2 = !L || L.k !== d.country;
    if (fresh2) {
      destroyMap();
      const k = d.country;
      const live2 = L = {
        map: null,
        popup: null,
        k,
        ready: false,
        next: data,
        hover: null,
        yFrom,
        yTo,
        all: data.all
      };
      getStyle().then((style2) => {
        if (L !== live2) return;
        if (style2 === FALLBACK) onBasemap();
        start2(host, d, live2, style2, onFail, onBasemap);
      });
      return;
    }
    const live = L;
    live.yFrom = yFrom;
    live.yTo = yTo;
    live.all = data.all;
    if (!live.ready) {
      live.next = data;
      return;
    }
    live.popup.remove();
    live.hover = null;
    live.map.getSource("cells").setData(data.cells);
    for (const id of ["cells", "cells-edge"])
      if (live.map.getLayer(id)) live.map.setPaintProperty(id, id === "cells" ? "fill-color" : "line-color", fillExpr(data.breaks));
  }
  function fitAll() {
    if (!L || !L.map) return;
    const b = L.all;
    L.map.fitBounds([b.slice(0, 2), b.slice(2)], { padding: 24, duration: 600 });
  }
  function start2(host, d, live, style2, onFail, onBasemap) {
    const ml = window.maplibregl, data = live.next;
    host.innerHTML = "";
    let map2;
    try {
      map2 = new ml.Map({
        container: host,
        style: style2,
        bounds: [data.bounds.slice(0, 2), data.bounds.slice(2)],
        fitBoundsOptions: { padding: host.clientWidth < 560 ? 12 : 28 },
        maxZoom: 11,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: true,
        attributionControl: { compact: true },
        renderWorldCopies: true,
        fadeDuration: 0
      });
    } catch (e) {
      L = null;
      return onFail("This browser could not start the map (WebGL is off or unavailable).");
    }
    live.map = map2;
    host._map = map2;
    live.popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", className: "cpPop", offset: 8 });
    map2.touchZoomRotate.disableRotation();
    map2.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
    map2.addControl(new ml.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
    let swapped = style2 === FALLBACK;
    const swap = () => {
      if (swapped || live.ready || L !== live) return;
      swapped = true;
      onBasemap();
      map2.setStyle(FALLBACK);
    };
    map2.on("error", (e) => {
      if (e.sourceId && e.sourceId !== "cells" && e.sourceId !== "outline" && !e.tile) onBasemap();
      setTimeout(swap, 4e3);
    });
    map2.on("style.load", () => {
      if (L !== live || live.ready) return;
      addLayers(map2, d, live);
    });
  }
  function addLayers(map2, d, live) {
    const data = live.next;
    const under = map2.getLayer("boundary_3") ? "boundary_3" : void 0, labels = map2.getLayer("water_name_point_label") ? "water_name_point_label" : void 0;
    map2.addSource("cells", { type: "geojson", data: data.cells, tolerance: 0, buffer: 2, generateId: true });
    map2.addSource("outline", { type: "geojson", data: data.outline });
    map2.addLayer(
      {
        id: "cells",
        type: "fill",
        source: "cells",
        paint: { "fill-color": fillExpr(data.breaks), "fill-opacity": 0.9, "fill-antialias": false }
      },
      under
    );
    if (data.n < 400)
      map2.addLayer(
        {
          id: "cells-edge",
          type: "line",
          source: "cells",
          paint: {
            "line-color": fillExpr(data.breaks),
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 7, 1.5, 9, 0]
          }
        },
        under
      );
    map2.addLayer(
      {
        id: "cells-hover",
        type: "line",
        source: "cells",
        paint: { "line-color": INK, "line-width": 1.5, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0] }
      },
      labels
    );
    map2.addLayer(
      { id: "outline", type: "line", source: "outline", paint: { "line-color": INK, "line-width": 1.1, "line-opacity": 0.75 } },
      labels
    );
    live.ready = true;
    live.next = null;
    for (const f of readyFns) f(map2);
    const host = map2.getContainer();
    const fold4 = () => host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    fold4();
    map2.once("idle", fold4);
    const clear = () => {
      if (live.hover != null) map2.setFeatureState({ source: "cells", id: live.hover }, { hover: false });
      live.hover = null;
    };
    const show = (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      if (live.hover !== f.id) {
        clear();
        live.hover = f.id;
        map2.setFeatureState({ source: "cells", id: f.id }, { hover: true });
      }
      map2.getCanvas().style.cursor = "default";
      live.popup.setLngLat(e.lngLat).setHTML(popupHtml(f.properties, d.cell, live.yFrom, live.yTo)).addTo(map2);
    };
    map2.on("mousemove", "cells", show);
    map2.on("click", "cells", show);
    map2.on("mouseleave", "cells", () => {
      clear();
      live.popup.remove();
      map2.getCanvas().style.cursor = "";
    });
    map2.on("click", (e) => {
      if (!map2.queryRenderedFeatures(e.point, { layers: ["cells"] }).length) {
        clear();
        live.popup.remove();
      }
    });
  }
  var r2 = (x) => Math.round(x * 100) / 100;
  var mapCountry = () => L && L.ready ? L.k : null;
  function mapView() {
    if (!L || !L.ready) return null;
    const m = L.map, c = m.getCenter(), b = m.getBounds(), shift = near(c.lng, 0) - c.lng;
    return {
      lat: r2(c.lat),
      lon: r2(c.lng + shift),
      zoom: r2(m.getZoom()),
      bbox: [
        r2(Math.max(-180, b.getWest() + shift)),
        r2(Math.max(-85, b.getSouth())),
        r2(Math.min(180, b.getEast() + shift)),
        r2(Math.min(85, b.getNorth()))
      ]
    };
  }
  var lon0 = () => L ? shapeOf(L.k)?.c[0] ?? 0 : 0;
  var boxNear = (b) => {
    const off = near((b[0] + b[2]) / 2, lon0()) - (b[0] + b[2]) / 2;
    return [b[0] + off, b[1], b[2] + off, b[3]];
  };
  function shiftCoords(c, off) {
    if (!Array.isArray(c)) return c;
    if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0] + off, c[1], ...c.slice(2)];
    return c.map((x) => shiftCoords(x, off));
  }
  function mapFocus(b, pad2, maxZoom = 9) {
    if (!L || !L.ready) return false;
    const nb = boxNear(b), host = L.map.getContainer(), room = (n, size2) => Math.max(16, Math.min(n, size2 - 140));
    L.map.fitBounds([nb.slice(0, 2), nb.slice(2)], {
      padding: { top: 24, left: 24, right: room(pad2.right + 24, host.clientWidth), bottom: room(pad2.bottom + 24, host.clientHeight) },
      duration: 900,
      maxZoom
    });
    return true;
  }
  function mapMarks(marks) {
    if (!L || !L.ready) return false;
    const map2 = L.map, off = (b) => near((b[0] + b[2]) / 2, lon0()) - (b[0] + b[2]) / 2;
    const features = marks.flatMap((mk) => {
      if (mk.geometry && mk.box) {
        const o = off(mk.box);
        return [
          {
            type: "Feature",
            properties: { name: mk.name, tone: mk.tone, frame: 0 },
            geometry: { type: mk.geometry.type, coordinates: shiftCoords(mk.geometry.coordinates, o) }
          }
        ];
      }
      if (mk.geometry) return [{ type: "Feature", properties: { name: mk.name, tone: mk.tone, frame: 0 }, geometry: mk.geometry }];
      if (!mk.box) return [];
      const [w, s2, e, n] = boxNear(mk.box);
      return [
        {
          type: "Feature",
          properties: { name: mk.name, tone: mk.tone, frame: 1 },
          geometry: {
            type: "LineString",
            coordinates: [
              [w, s2],
              [e, s2],
              [e, n],
              [w, n],
              [w, s2]
            ]
          }
        }
      ];
    });
    const data = { type: "FeatureCollection", features };
    if (map2.getSource("ask")) {
      map2.getSource("ask").setData(data);
      return true;
    }
    if (!features.length) return true;
    const labels = map2.getLayer("water_name_point_label") ? "water_name_point_label" : void 0;
    map2.addSource("ask", { type: "geojson", data });
    const isFrame = (v) => ["==", ["get", "frame"], v];
    map2.addLayer(
      { id: "ask-fill", type: "fill", source: "ask", filter: isFrame(0), paint: { "fill-color": ["get", "tone"], "fill-opacity": 0.1 } },
      labels
    );
    map2.addLayer(
      { id: "ask-line", type: "line", source: "ask", filter: isFrame(0), paint: { "line-color": ["get", "tone"], "line-width": 2.2 } },
      labels
    );
    map2.addLayer(
      {
        id: "ask-frame",
        type: "line",
        source: "ask",
        filter: isFrame(1),
        paint: { "line-color": ["get", "tone"], "line-width": 2, "line-dasharray": [3, 2] }
      },
      labels
    );
    return true;
  }

  // src/cplot.ts
  var INK2 = "#1b1b1b";
  var INK22 = "#55524c";
  var GRID = "#e4e0d7";
  var ZERO = "#ebe8e1";
  var RED = "#bd0026";
  var TYPICAL = "#6b665c";
  var CONTEXT = "#d8d4cb";
  var BAR_SEEN = "#b8b2a7";
  var BAR_CONV = "#dcd7cd";
  var PAPER2 = "#faf9f6";
  var CAL = ["#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"];
  var yTop = (v) => Math.max(5, niceMax2(v));
  var yAxis = (ymax) => ({
    domain: [0, ymax],
    grid: GRID,
    tickFormat: (v) => Number.isInteger(v) ? short(v) : "",
    label: null,
    tickSize: 0,
    ticks: 4
  });
  function yearTicks(xs, n) {
    if (xs.length === 1) return xs;
    const step = Math.max(1, Math.ceil((xs.length - 1) / (n - 1)));
    return xs.filter((_, i) => (xs.length - 1 - i) % step === 0);
  }
  var STYLE2 = {
    fontFamily: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: "13px",
    fontVariantNumeric: "tabular-nums lining-nums",
    background: "transparent",
    color: INK2,
    overflow: "visible"
  };
  var TIP = { fill: "#fffefa", stroke: INK2, fontSize: 13, textPadding: 8, lineHeight: 1.35 };
  var Pl = () => window.Plot;
  function niceMax2(v) {
    if (v <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    for (const z of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f <= z) return z * p;
    return 10 * p;
  }
  function mount(el, fig, click) {
    el.replaceChildren(fig);
    if (click) {
      fig.style.cursor = "pointer";
      fig.addEventListener("click", () => {
        if (fig.value != null) click(fig.value);
      });
    }
  }
  function spread(items, ymax, H, mT, mB) {
    const px = (v) => mT + (1 - v / ymax) * (H - mT - mB), out = items.map((it) => ({ ...it, py: px(it.v), dy: 0 })).sort((a, b) => a.py - b.py);
    for (let i = 1; i < out.length; i++)
      if (out[i].py + out[i].dy - (out[i - 1].py + out[i - 1].dy) < 15) out[i].dy = out[i - 1].py + out[i - 1].dy + 15 - out[i].py;
    const floor = H - mB - 6;
    for (let i = out.length - 1; i >= 0; i--) {
      const lim = i === out.length - 1 ? floor : out[i + 1].py + out[i + 1].dy - 15;
      if (out[i].py + out[i].dy > lim) out[i].dy = lim - out[i].py;
    }
    return out;
  }
  function endLabels(Plot, items, x) {
    return items.map(
      (it) => Plot.text([it], {
        x: () => x,
        y: () => it.v,
        text: () => it.text,
        dx: 7,
        dy: it.dy,
        textAnchor: "start",
        fill: it.fill,
        fontWeight: it.weight ?? 600
      })
    );
  }
  var phone = (W) => W < 560;
  var base = (W, H, o) => ({ width: W, height: H, style: STYLE2, ...o });
  function calendarClasses(R) {
    const c = classBreaks(R.ser.map((r) => r.h));
    return { ...c, colours: classColours(c.breaks, CAL) };
  }
  function calendarScale(R, mode) {
    if (mode === "anom") return { type: "diverging-log", scheme: "RdBu", reverse: true, pivot: 1, domain: [0.25, 4], clamp: true };
    const c = calendarClasses(R);
    return c.breaks.length ? { type: "threshold", domain: c.breaks, range: c.colours } : { type: "ordinal", range: c.colours };
  }
  var total = (v) => v === 0 ? "0" : v < 1 ? "<1" : short(Math.round(v));
  function calendar(top, bottom, R, o) {
    const Plot = Pl(), W = top.clientWidth || 640, ph = phone(W), rowH = ph ? 17 : 20, mL = ph ? 38 : 44, mR = ph ? 44 : 64, color = calendarScale(R, o.mode), totals = new Map(R.years.map((y) => [y.y, y.h])), partYears = new Set(R.years.filter((y) => y.part).map((y) => y.y));
    const part = (el, rows, head) => {
      if (!rows.length) {
        el.replaceChildren();
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const years = [...new Set(rows.map((r) => r.y))].sort((a, b) => b - a), mT = head ? 26 : 4, H = years.length * rowH + mT + 4, f = rows.find((r) => r.y === o.focus[0] && r.m === o.focus[1]);
      const marks = [
        Plot.cell(rows, { x: "m", y: "y", fill: o.mode === "count" ? ZERO : "ratio", inset: 1 }),
        o.mode === "count" ? Plot.cell(
          rows.filter((r) => r.h > 0),
          { x: "m", y: "y", fill: "h", inset: 1 }
        ) : null,
        /* the month still under way: hatched over its colour, with a dashed edge */
        Plot.cell(
          rows.filter((r) => r.part),
          { x: "m", y: "y", fill: "url(#cpPartHatch)", stroke: INK22, strokeWidth: 1, strokeDasharray: "2,2", inset: 1.5 }
        ),
        f ? Plot.cell([f], { x: "m", y: "y", fill: "none", stroke: INK2, strokeWidth: 2, inset: 0 }) : null,
        Plot.text(years, {
          y: (d) => d,
          text: (d) => total(totals.get(d) ?? 0) + (partYears.has(d) ? "*" : ""),
          frameAnchor: "right",
          dx: 10,
          textAnchor: "start",
          fill: INK22
        }),
        head ? Plot.text([ph ? "Total" : "Year total"], {
          text: (d) => d,
          frameAnchor: "top-right",
          dx: 10,
          dy: -18,
          textAnchor: "start",
          fill: INK22
        }) : null,
        Plot.tip(rows, Plot.pointer({ x: "m", y: "y", title: o.tip, ...TIP }))
      ];
      const fig = Plot.plot(
        base(W, H, {
          marginLeft: mL,
          marginRight: mR,
          marginTop: mT,
          marginBottom: 4,
          padding: 0,
          x: head ? {
            axis: "top",
            domain: MON.map((_, m) => m),
            tickFormat: (m) => ph ? MON[m][0] : MON[m],
            tickSize: 0,
            label: null,
            tickPadding: 8
          } : { axis: null, domain: MON.map((_, m) => m) },
          y: { domain: years, tickFormat: (y) => String(y), tickSize: 0, label: null, tickPadding: 8 },
          color,
          marks
        })
      );
      fig.setAttribute("aria-label", `Hotspots per month, ${years[years.length - 1]} to ${years[0]}`);
      if (rows.some((r) => r.part))
        fig.insertAdjacentHTML(
          "afterbegin",
          `<defs><pattern id="cpPartHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="5" fill="${INK2}" fill-opacity=".28"/></pattern></defs>`
        );
      mount(el, fig, o.click);
    };
    part(
      top,
      R.ser.filter((r) => r.y >= o.viirsYear),
      true
    );
    part(
      bottom,
      R.ser.filter((r) => r.y < o.viirsYear),
      !R.ser.some((r) => r.y >= o.viirsYear)
    );
  }
  function seasonal(el, R, year, click) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 16, mB = 30, st = R.stats.map((s2, m) => {
      const v = R.ser.filter((r) => r.m === m && !r.part).map((r) => r.h);
      return { m, ...s2, min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0 };
    }), yr = R.ser.filter((r) => r.y === year && !r.part), yEnd = yr.length ? yr[yr.length - 1] : null, ymax = yTop(Math.max(1e-9, ...st.map((s2) => s2.max))), labs = spread(
      [{ v: st[11].med, text: "Typical", fill: TYPICAL }, ...yEnd && yEnd.m === 11 ? [{ v: yEnd.h, text: String(year), fill: RED }] : []],
      ymax,
      H,
      mT,
      mB
    ), px = (v) => v / ymax * (H - mT - mB), at = (f, k) => {
      const a = Math.floor(k), b = Math.min(11, a + 1);
      return f(a) + (f(b) - f(a)) * (k - a);
    }, lines2 = (k) => [at((m) => st[m].med, k), ...yr.length ? [at((m) => yr[Math.min(m, yr.length - 1)].h, k)] : []], monthPx = (W - 44 - 64) / 11, place3 = (lo, hi, t) => {
      const half = t.length * 3.3 / monthPx;
      let best = null, score = 0;
      for (let m = 0; m <= 11; m += 0.25) {
        if (m - half < 0.2 || m + half > 10.8) continue;
        const near2 = [-1, -0.5, 0, 0.5, 1].map((f) => m + f * half), bot = px(Math.max(...near2.map((k) => at(lo, k)))), top = px(Math.min(...near2.map((k) => at(hi, k)))), ls = near2.flatMap((k) => lines2(k).map(px));
        for (let y = bot + 8; y <= top - 8; y += 2) {
          const clear = Math.min(y - bot, top - y, ...ls.map((l) => Math.abs(l - y)));
          if (clear >= 10 && clear > score) {
            score = clear;
            best = { m, v: y / (H - mT - mB) * ymax, t };
          }
        }
      }
      return best ? [best] : [];
    }, bandLabels = [
      ...place3(
        (m) => st[m].q1,
        (m) => st[m].q3,
        "Middle half of years"
      ),
      ...place3(
        (m) => st[m].q3,
        (m) => st[m].max,
        "Full range"
      )
    ];
    const fig = Plot.plot(
      base(W, H, {
        marginTop: mT,
        marginBottom: mB,
        marginLeft: 44,
        marginRight: 64,
        x: {
          domain: [0, 11],
          ticks: MON.map((_, m) => m).filter((m) => !ph || m % 2 === 0),
          tickFormat: (m) => MON[m],
          label: null,
          tickSize: 0
        },
        y: yAxis(ymax),
        marks: [
          Plot.areaY(st, { x: "m", y1: "min", y2: "max", fill: "#efebe3" }),
          Plot.areaY(st, { x: "m", y1: "q1", y2: "q3", fill: "#e0dace" }),
          Plot.text(bandLabels, {
            x: "m",
            y: "v",
            text: "t",
            fill: INK22,
            fontSize: 12,
            stroke: (d) => d.t === "Full range" ? "#efebe3" : "#e0dace",
            strokeWidth: 3,
            paintOrder: "stroke"
          }),
          Plot.lineY(st, { x: "m", y: "med", stroke: TYPICAL, strokeWidth: 2, strokeDasharray: "4,3" }),
          yr.length ? Plot.lineY(yr, { x: "m", y: "h", stroke: RED, strokeWidth: 2.5 }) : null,
          yr.length ? Plot.dot(yr, { x: "m", y: "h", fill: RED, r: 2.6 }) : null,
          ...endLabels(Plot, labs, 11),
          /* a year that stops early is named at its last month, above the line */
          yEnd && yEnd.m < 11 ? Plot.text([yEnd], {
            x: "m",
            y: "h",
            text: () => `${year} to ${MON[yEnd.m]}`,
            dy: -11,
            fill: RED,
            fontWeight: 600,
            stroke: PAPER2,
            strokeWidth: 3,
            paintOrder: "stroke"
          }) : null,
          Plot.ruleX(st, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
          Plot.tip(
            st,
            Plot.pointerX({
              x: "m",
              y: "med",
              ...TIP,
              title: (s2) => `${MONL[s2.m]}
Typical (median): ${fmt(s2.med)} hotspots
Middle half of years: ${fmt(s2.q1)} to ${fmt(s2.q3)}
Range: ${fmt(s2.min)} to ${fmt(s2.max)}` + (yr[s2.m] ? `
${year}: ${fmt(yr[s2.m].h)}` : yr.length ? `
${year}: not over yet` : "") + `
Click to test ${MONL[s2.m]} ${year} at the top`
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", "Hotspots by calendar month: median, middle half and range of years");
    mount(el, fig, (v) => click(v.m));
    const missing = [
      ["#e0dace", "Middle half of years"],
      ["#efebe3", "Full range"]
    ].filter(([, t]) => !bandLabels.some((b) => b.t === t));
    const sub = el.previousElementSibling;
    sub?.querySelector(".cpMiniKey")?.remove();
    if (missing.length && sub) {
      const key = document.createElement("span");
      key.className = "cpMiniKey";
      key.innerHTML = missing.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("");
      sub.append(key);
    }
  }
  function annual(el, R, o) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, ys = R.years, conv = ys.filter((y) => y.y < o.viirsYear), worst = R.ranked[0], ymax = yTop(Math.max(1e-9, ...ys.map((y) => Math.max(y.h, y.hi))) * 1.06), xs = ys.map((y) => y.y), fill = (y) => y.y === o.focusYear ? RED : worst && y.y === worst.y ? INK2 : y.y < o.viirsYear ? BAR_CONV : BAR_SEEN;
    const fig = Plot.plot(
      base(W, H, {
        marginTop: 18,
        marginBottom: 30,
        marginLeft: 44,
        marginRight: 62,
        x: {
          domain: xs,
          ticks: yearTicks(xs, ph ? 4 : 7),
          tickFormat: (y) => String(y),
          label: null,
          tickSize: 0,
          padding: 0.18
        },
        y: yAxis(ymax),
        marks: [
          Plot.barY(
            ys.filter((y) => !y.part),
            { x: "y", y: "h", fill }
          ),
          /* the year under way: its total so far, as a dashed outline */
          Plot.barY(
            ys.filter((y) => y.part),
            {
              x: "y",
              y: "h",
              fill: (y) => y.y === o.focusYear ? "#f2c9cf" : "#efebe3",
              stroke: (y) => y.y === o.focusYear ? RED : INK22,
              strokeWidth: 1.2,
              strokeDasharray: "3,2"
            }
          ),
          Plot.text(
            ys.filter((y) => y.part),
            { x: "y", y: "h", text: () => "so far", dy: -8, fill: INK22, fontSize: 11, stroke: PAPER2, strokeWidth: 3, paintOrder: "stroke" }
          ),
          Plot.ruleX(conv, { x: "y", y1: "lo", y2: "hi", stroke: INK2, strokeOpacity: 0.45 }),
          R.mean > 0 ? Plot.ruleY([R.mean], { stroke: INK2, strokeDasharray: "3,3", strokeOpacity: 0.8 }) : null,
          R.mean > 0 ? Plot.text([R.mean], {
            y: (d) => d,
            frameAnchor: "right",
            text: () => `Average
${short(R.mean)}`,
            dx: 6,
            textAnchor: "start",
            lineHeight: 1.15,
            fill: INK2
          }) : null,
          worst && worst.h > 0 ? Plot.text([worst], {
            x: "y",
            y: (d) => d.y < o.viirsYear ? Math.max(d.h, d.hi) : d.h,
            text: (d) => String(d.y),
            dy: -9,
            fontWeight: 600,
            fill: INK2,
            stroke: PAPER2,
            strokeWidth: 4,
            paintOrder: "stroke"
          }) : null,
          Plot.tip(ys, Plot.pointerX({ x: "y", y: "h", title: o.tip, ...TIP }))
        ]
      })
    );
    fig.setAttribute("aria-label", "Hotspots per year");
    mount(el, fig, (v) => o.click(v.y));
  }
  function cumulative(el, R, year, part = null) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 16, mB = 30, rows = [];
    const partRows = /* @__PURE__ */ new Set();
    for (const yr of R.years) {
      let c = 0;
      for (const r of R.ser.filter((r3) => r3.y === yr.y)) {
        rows.push({ y: yr.y, m: r.m, x: r.part && part ? r.m - 1 + part.frac : r.m, c: c += r.h });
        if (r.part) partRows.add(yr.y + "|" + r.m);
      }
    }
    const worst = R.ranked[0]?.y, has = rows.some((r) => r.y === year), ymax = yTop(Math.max(1e-9, ...rows.map((r) => r.c))), endOf = (y) => rows.filter((r) => r.y === y).pop()?.c ?? 0, yearEnd = (y) => rows.filter((r) => r.y === y).pop()?.x ?? 11, labs = spread(
      [
        ...has ? [{ v: endOf(year), text: String(year), fill: RED }] : [],
        ...worst !== void 0 && worst !== year ? [{ v: endOf(worst), text: String(worst), fill: INK2 }] : []
      ],
      ymax,
      H,
      mT,
      mB
    );
    const fig = Plot.plot(
      base(W, H, {
        marginTop: mT,
        marginBottom: mB,
        marginLeft: 44,
        marginRight: 48,
        x: {
          domain: [0, 11],
          ticks: MON.map((_, m) => m).filter((m) => !ph || m % 2 === 0),
          tickFormat: (m) => MON[m],
          label: null,
          tickSize: 0
        },
        y: yAxis(ymax),
        marks: [
          Plot.lineY(
            rows.filter((r) => r.y !== year && r.y !== worst),
            { x: "x", y: "c", z: "y", stroke: CONTEXT, strokeWidth: 1 }
          ),
          worst !== void 0 && worst !== year ? Plot.lineY(
            rows.filter((r) => r.y === worst),
            { x: "x", y: "c", stroke: INK2, strokeWidth: 1.5 }
          ) : null,
          Plot.lineY(
            rows.filter((r) => r.y === year),
            { x: "x", y: "c", stroke: RED, strokeWidth: 2.5 }
          ),
          ...endLabels(
            Plot,
            labs.filter((l) => yearEnd(+l.text) === 11),
            11
          ),
          /* a year under way is named where its line stops */
          ...labs.filter((l) => yearEnd(+l.text) < 11).map(
            (l) => Plot.text([l], {
              x: () => yearEnd(+l.text),
              y: () => l.v,
              text: () => l.text + " so far",
              dx: 6,
              textAnchor: "start",
              fill: l.fill,
              fontWeight: 600,
              stroke: PAPER2,
              strokeWidth: 3,
              paintOrder: "stroke"
            })
          ),
          Plot.tip(
            rows,
            Plot.pointer({
              x: "x",
              y: "c",
              ...TIP,
              title: (r) => `${r.y}, ${partRows.has(r.y + "|" + r.m) ? `1 January to ${part ? part.label : MONL[r.m] + " (month not over)"}` : `January to ${MONL[r.m]}`}
${fmt(r.c)} hotspots so far`
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", "Running total of hotspots through each year");
    mount(el, fig);
  }
  function seam(el, R, viirsYear3) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 22, mB = 30, ys = R.years.filter((y) => !y.part).length ? R.years.filter((y) => !y.part) : R.years, last = ys[ys.length - 1], band = ys.filter((y) => y.y <= viirsYear3), ymax = yTop(Math.max(1e-9, ...ys.map((y) => Math.max(y.h, y.naive)), ...band.map((y) => y.hi))), labs = spread(
      [
        { v: last.h, text: "Harmonized", fill: INK2 },
        { v: last.naive, text: "Raw", fill: TYPICAL }
      ],
      ymax,
      H,
      mT,
      mB
    );
    const xs = ys.map((y) => y.y), one = xs.length === 1;
    const fig = Plot.plot(
      base(W, H, {
        marginTop: mT,
        marginBottom: mB,
        marginLeft: 44,
        marginRight: 86,
        x: {
          domain: one ? [xs[0] - 1, xs[0] + 1] : [xs[0], xs[xs.length - 1]],
          tickFormat: "d",
          label: null,
          tickSize: 0,
          ticks: yearTicks(xs, ph ? 4 : 7)
        },
        y: yAxis(ymax),
        marks: [
          band.length > 1 ? Plot.areaY(band, { x: "y", y1: "lo", y2: "hi", fill: "#e6e1d6" }) : null,
          band.length > 2 ? Plot.text([band[Math.floor(band.length / 2)]], {
            x: "y",
            y: "hi",
            text: () => "90% range",
            dy: -8,
            fill: INK22,
            fontSize: 12,
            stroke: PAPER2,
            strokeWidth: 3,
            paintOrder: "stroke"
          }) : null,
          xs[0] < viirsYear3 && xs[xs.length - 1] >= viirsYear3 ? [
            Plot.ruleX([viirsYear3], { stroke: INK2, strokeOpacity: 0.45 }),
            Plot.text([viirsYear3], {
              x: (d) => d,
              frameAnchor: "top",
              dy: -14,
              dx: 4,
              textAnchor: "start",
              text: () => "VIIRS starts",
              fill: INK22
            })
          ] : null,
          Plot.lineY(ys, { x: "y", y: "naive", stroke: TYPICAL, strokeWidth: 1.6, strokeDasharray: "4,3" }),
          Plot.lineY(ys, { x: "y", y: "h", stroke: INK2, strokeWidth: 2 }),
          one ? Plot.dot(ys, { x: "y", y: "naive", fill: TYPICAL }) : null,
          one ? Plot.dot(ys, { x: "y", y: "h", fill: INK2 }) : null,
          ...endLabels(Plot, labs, last.y),
          Plot.ruleX(ys, Plot.pointerX({ x: "y", stroke: "#b9b3a6" })),
          Plot.tip(
            ys,
            Plot.pointerX({
              x: "y",
              y: "h",
              ...TIP,
              title: (y) => `${y.y}
Harmonized: ${fmt(y.h)}` + (y.y <= viirsYear3 ? `, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "") + `
Raw counts: ${fmt(y.naive)}`
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", "Raw joined counts against the harmonized record");
    mount(el, fig);
  }
  function sensorLines(el, xs, per) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 270, mT = 16, mB = 30, rows = per.flatMap((s2) => xs.map((x, i) => ({ s: s2.name, x, v: s2.v[i] }))), ymax = yTop(Math.max(1e-9, ...rows.map((r) => r.v).filter(Number.isFinite))), n = xs.length - 1, labs = spread(
      per.filter((s2) => Number.isFinite(s2.v[n])).map((s2) => ({ v: s2.v[n], text: s2.name, fill: s2.c })),
      ymax,
      H,
      mT,
      mB
    );
    const fig = Plot.plot(
      base(W, H, {
        marginTop: mT,
        marginBottom: mB,
        marginLeft: 44,
        marginRight: 92,
        x: {
          domain: xs.length > 1 ? [xs[0], xs[n]] : [xs[0] - 1, xs[0] + 1],
          tickFormat: "d",
          label: null,
          tickSize: 0,
          ticks: yearTicks(xs, ph ? 4 : 7)
        },
        y: yAxis(ymax),
        marks: [
          ...per.map(
            (s2) => Plot.lineY(
              xs.map((x, i) => ({ x, v: s2.v[i] })),
              { x: "x", y: "v", stroke: s2.c, strokeWidth: 1.8, strokeDasharray: s2.dash }
            )
          ),
          ...xs.length === 1 ? per.map((s2) => Plot.dot([{ x: xs[0], v: s2.v[0] }], { x: "x", y: "v", fill: s2.c })) : [],
          ...endLabels(Plot, labs, xs[n]),
          Plot.ruleX(xs, Plot.pointerX({ x: (d) => d, stroke: "#b9b3a6" })),
          Plot.tip(
            xs,
            Plot.pointerX({
              x: (d) => d,
              frameAnchor: "top",
              ...TIP,
              title: (x) => {
                const i = xs.indexOf(x);
                return `${x}
` + per.map((s2) => `${s2.name}: ${Number.isFinite(s2.v[i]) ? fmt(s2.v[i]) : "not flying"}`).join("\n");
              }
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", "Raw detections per year from each satellite");
    mount(el, fig);
  }
  var whole = (v) => v === 0 ? "0" : v < 1 ? "fewer than 1" : fmt(Math.round(v));
  function forecastMonths(el, rows, year) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 16, mB = 30, seen = rows.filter((r) => r.obs != null && !r.part), ymax = yTop(Math.max(1e-9, ...rows.flatMap((r) => [r.hi, r.med, r.typ, r.part ? 0 : r.obs ?? 0]))), pc4 = (p) => p > 0.99 ? "over 99%" : p < 0.01 ? "under 1%" : Math.round(p * 100) + "%", labs = spread(
      [
        { v: rows[11].typ, text: "Typical", fill: TYPICAL },
        { v: rows[11].med, text: seen.length ? "Forecast" : String(year), fill: INK2 }
      ],
      ymax,
      H,
      mT,
      mB
    );
    const fig = Plot.plot(
      base(W, H, {
        marginTop: mT,
        marginBottom: mB,
        marginLeft: 44,
        marginRight: 72,
        x: {
          domain: [0, 11],
          ticks: MON.map((_, m) => m).filter((m) => !ph || m % 2 === 0),
          tickFormat: (m) => MON[m],
          label: null,
          tickSize: 0
        },
        y: yAxis(ymax),
        marks: [
          Plot.areaY(rows, { x: "m", y1: "lo", y2: "hi", fill: "#e0dace" }),
          Plot.lineY(rows, { x: "m", y: "typ", stroke: TYPICAL, strokeWidth: 2, strokeDasharray: "4,3" }),
          Plot.lineY(rows, { x: "m", y: "med", stroke: INK2, strokeWidth: 2.2 }),
          Plot.dot(rows, { x: "m", y: "med", fill: INK2, r: 2.4 }),
          Plot.dot(seen, { x: "m", y: "obs", fill: RED, r: 3.6, stroke: PAPER2, strokeWidth: 1 }),
          ...endLabels(Plot, labs, 11),
          Plot.ruleX(rows, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
          Plot.tip(
            rows,
            Plot.pointerX({
              x: "m",
              y: "med",
              ...TIP,
              title: (r) => `${MONL[r.m]} ${year}
Middle outcome: ${whole(r.med)} hotspots
8 in 10 between ${whole(r.lo)} and ${whole(r.hi)}
Expected (mean): ${whole(r.mean)}
Typical ${MONL[r.m]}, 2001\u20132025: ${whole(r.typ)}
Chance of more than typical: ${pc4(r.pAbove)}` + (r.pAny < 0.995 ? `
Chance of any hotspot: ${pc4(r.pAny)}` : "") + (r.obs != null ? `
Seen in ${year}${r.part ? ` (${r.part})` : ""}: ${fmt(r.obs)}${r.part ? "" : r.obs < r.lo || r.obs > r.hi ? ", outside the range" : ", inside the range"}` : "")
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", `Forecast hotspots by month in ${year}, with the 80% range and the typical month of 2001 to 2025`);
    mount(el, fig);
  }

  // src/acells.ts
  var CELLS_DIR = "cells/v1";
  var cellsPath = (k) => `${CELLS_DIR}/${encodeURIComponent(k)}.json`;
  var TIMEOUT_MS3 = 6e4;
  var isObj2 = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  var isNums2 = (x) => Array.isArray(x) && x.every((v) => typeof v === "number");
  function parse(x, k) {
    if (!isObj2(x) || x.v !== 1 || x.country !== k) throw new Error("the file is not in the expected format");
    const cell = x.cell, y0 = x.y0, nm = x.n_months, cells = x.cells, rows = x.rows;
    if (typeof cell !== "number" || !(cell > 0) || typeof y0 !== "number" || typeof nm !== "number" || !(nm > 0))
      throw new Error("the file is not in the expected format");
    if (!isNums2(cells) || cells.length % 2 || !isNums2(rows) || rows.length % 3) throw new Error("the file is not in the expected format");
    const n = cells.length / 2, lat = new Float64Array(n), lon = new Float64Array(n), s2 = new Float64Array(n), w = new Float64Array(n), v = new Float32Array(n * nm), lim = 180 / cell + 1;
    for (let c = 0; c < n; c++) {
      let la = cells[2 * c], lo = cells[2 * c + 1];
      if (lo > lim) {
        lo -= 1e5;
        la += 1;
      }
      s2[c] = la * cell;
      w[c] = lo * cell;
      lat[c] = s2[c] + cell / 2;
      lon[c] = w[c] + cell / 2;
    }
    for (let p = 0; p < rows.length; p += 3) {
      const c = rows[p], i = rows[p + 1];
      if (c >= 0 && c < n && i >= 0 && i < nm) v[c * nm + i] = rows[p + 2];
    }
    const pt = x.partial;
    const partial = isObj2(pt) && typeof pt.y === "number" && typeof pt.m === "number" && typeof pt.i === "number" && typeof pt.day1 === "number" ? { y: pt.y, m: pt.m, i: pt.i, day1: pt.day1 } : null;
    return { country: k, cell, y0, nm, partial, n, lat, lon, s: s2, w, v };
  }
  var NoCells = class extends Error {
  };
  var NO_FILE = "Hugging Face has no month-by-month squares for this country yet";
  var index2 = null;
  function listed() {
    if (!index2)
      index2 = fetch(fileUrl(`${CELLS_DIR}/index.json`)).then((r) => r.ok ? r.json() : null).then(
        (x) => isObj2(x) && Array.isArray(x.countries) ? new Set(x.countries.filter(isObj2).map((c) => String(c.country))) : null
      ).catch(() => null).then((s2) => {
        if (!s2) index2 = null;
        return s2;
      });
    return index2;
  }
  var GRIDS = /* @__PURE__ */ new Map();
  function loadGrid(k) {
    const had = GRIDS.get(k);
    if (had) return had;
    const p = (async () => {
      const has = await listed();
      if (has && !has.has(k)) throw new NoCells(NO_FILE);
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS3);
      try {
        let res = await fetch(fileUrl(cellsPath(k)), { signal: ctl.signal });
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 3e3));
          res = await fetch(fileUrl(cellsPath(k)), { signal: ctl.signal });
        }
        if (res.status === 404) throw new NoCells(NO_FILE);
        if (!res.ok) throw new Error(`Hugging Face answered ${res.status}`);
        return parse(await res.json(), k);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw new Error("it took longer than a minute");
        throw e;
      } finally {
        clearTimeout(timer);
      }
    })();
    p.catch((e) => {
      if (!(e instanceof NoCells)) GRIDS.delete(k);
    });
    GRIDS.set(k, p);
    return p;
  }
  function seriesOf(g, idx) {
    const S3 = new Float64Array(g.nm);
    for (let k = 0; k < idx.length; k++) {
      const o = idx[k] * g.nm;
      for (let i = 0; i < g.nm; i++) S3[i] += g.v[o + i];
    }
    return S3;
  }
  function median2(a) {
    const s2 = Array.from(a).sort((x, y) => x - y), h2 = s2.length >> 1;
    if (!s2.length) return 0;
    return s2.length % 2 ? s2[h2] : (s2[h2 - 1] + s2[h2]) / 2;
  }
  function frameOf(g) {
    const lastFull = g.partial ? g.partial.i - 1 : g.nm - 1, cy = g.y0 + Math.floor((g.nm - 1) / 12), yb = g.y0 + Math.floor((lastFull + 1) / 12) - 1, cyLast = lastFull - (cy - g.y0) * 12;
    return { y0: g.y0, nm: g.nm, yb, cy, cyLast, partial: g.partial };
  }
  var idxOf = (F2, y, m) => (y - F2.y0) * 12 + m;
  var TREND_MIN_MEAN = 10;
  var TREND_MIN_YEARS = 5;
  function stats(F2, S3) {
    const usual = [];
    for (let m = 0; m < 12; m++) {
      const v = [];
      for (let y = F2.y0; y <= F2.yb; y++) v.push(S3[idxOf(F2, y, m)]);
      usual.push(median2(v));
    }
    const years = [];
    for (let y = F2.y0; y <= F2.yb; y++) {
      let t = 0;
      for (let m = 0; m < 12; m++) t += S3[idxOf(F2, y, m)];
      years.push({ y, v: t });
    }
    let total2 = 0;
    for (let i = 0; i < F2.nm; i++) total2 += S3[i];
    const mean = years.length ? years.reduce((a, r) => a + r.v, 0) / years.length : 0;
    let ytd = null;
    if (F2.cy > F2.yb && F2.cyLast >= 0) {
      const sum2 = (y) => {
        let t = 0;
        for (let m = 0; m <= F2.cyLast; m++) t += S3[idxOf(F2, y, m)];
        return t;
      };
      const cur2 = sum2(F2.cy), past = years.map((r) => sum2(r.y));
      ytd = {
        y: F2.cy,
        last: F2.cyLast,
        cur: cur2,
        usual: median2(past),
        /* sums of rounded values: equal within a tenth */
        rank: 1 + past.filter((v) => v > cur2 + 0.05).length,
        ties: past.filter((v) => Math.abs(v - cur2) <= 0.05).length,
        n: past.length + 1
      };
    }
    const part = F2.partial ? S3[F2.partial.i] : null;
    let peak = 0;
    for (let m = 1; m < 12; m++) if (usual[m] > usual[peak]) peak = m;
    if (usual[peak] === 0) {
      const tot = new Array(12).fill(0);
      for (let y = F2.y0; y <= F2.yb; y++) for (let m = 0; m < 12; m++) tot[m] += S3[idxOf(F2, y, m)];
      peak = tot.indexOf(Math.max(...tot));
    }
    const top = years.length ? years.reduce((a, r) => r.v > a.v ? r : a, years[0]) : null;
    const share2 = [];
    for (let m = 0; m < 12; m++)
      share2.push(median2(years.filter((r) => r.v > 0).map((r) => S3[idxOf(F2, r.y, m)] / r.v * 100)));
    const trend2 = mean >= TREND_MIN_MEAN && years.filter((r) => r.v >= 1).length >= TREND_MIN_YEARS ? trendOf(years, F2.y0) : null;
    return {
      usual,
      share: share2,
      years,
      usualYear: median2(years.map((r) => r.v)),
      ytd,
      part,
      peak,
      top: top && top.v > 0 ? top : null,
      trend: trend2,
      mean,
      total: total2
    };
  }
  function trendOf(years, y0) {
    const n = years.length, x = years.map((r) => r.y - y0), l = years.map((r) => Math.log1p(Math.max(0, r.v))), slopes = [];
    let S3 = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        slopes.push((l[j] - l[i]) / (x[j] - x[i]));
        S3 += Math.sign(years[j].v - years[i].v);
      }
    const b = median2(slopes), a = median2(l.map((v, i) => v - b * x[i]));
    const groups = /* @__PURE__ */ new Map();
    for (const r of years) groups.set(r.v, (groups.get(r.v) ?? 0) + 1);
    let tie = 0;
    for (const t of groups.values()) tie += t * (t - 1) * (2 * t + 5);
    const varS = (n * (n - 1) * (2 * n + 5) - tie) / 18, z = varS > 0 ? (S3 - Math.sign(S3)) / Math.sqrt(varS) : 0;
    return { pct: (Math.exp(10 * b) - 1) * 100, clear: Math.abs(z) >= 1.96, a, b };
  }
  function watchYears(F2, m) {
    const lastY = m <= F2.cyLast && F2.cy > F2.yb ? F2.cy : F2.yb;
    return Array.from({ length: 10 }, (_, k) => lastY - 9 + k).filter((y) => y >= F2.y0);
  }
  function estimate(F2, S3, m, years) {
    const vals = years.map((y) => S3[idxOf(F2, y, m)]), med = median2(vals), last3 = vals.slice(-3), recent = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length), sorted = vals.slice().sort((a, b) => a - b), q = (f) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(f * (sorted.length - 1))))] ?? 0;
    return { vals, med, recent, expected: 0.6 * med + 0.4 * recent, lo: q(0.2), hi: q(0.8), active: vals.filter((v) => v >= 1).length };
  }

  // src/ashape.ts
  var R_KM2 = 6371;
  var rad = (d) => d * Math.PI / 180;
  function km(lat1, lon1, lat2, lon2) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * R_KM2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function midLon(s2) {
    if (s2.t === "r") return (s2.w + s2.e) / 2;
    if (s2.t === "c") return s2.lon;
    let a = Infinity, z = -Infinity;
    for (const p of s2.pts) {
      a = Math.min(a, p[0]);
      z = Math.max(z, p[0]);
    }
    return (a + z) / 2;
  }
  function inPoly(pts2, x, y) {
    let inside = false;
    for (let i = 0, j = pts2.length - 1; i < pts2.length; j = i++) {
      const [xi, yi] = pts2[i], [xj, yj] = pts2[j];
      if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function tester(s2) {
    const m = midLon(s2);
    if (s2.t === "r") return (lat, lon) => lat >= s2.s && lat <= s2.n && near(lon, m) >= s2.w && near(lon, m) <= s2.e;
    if (s2.t === "c") return (lat, lon) => km(s2.lat, s2.lon, lat, near(lon, m)) <= s2.km;
    return (lat, lon) => inPoly(s2.pts, near(lon, m), lat);
  }
  function dest(lat, lon, dKm, brg) {
    const d = dKm / R_KM2, p1 = rad(lat), l1 = rad(lon), b = rad(brg), p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)), l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [l2 * 180 / Math.PI, p2 * 180 / Math.PI];
  }
  var MERC_LAT = 85.05;
  function poleIn(s2) {
    if (s2.t !== "c") return 0;
    return km(s2.lat, s2.lon, 90, 0) < s2.km ? 1 : km(s2.lat, s2.lon, -90, 0) < s2.km ? -1 : 0;
  }
  function ring(s2, lon02) {
    let pts2;
    if (s2.t === "r")
      pts2 = [
        [s2.w, s2.s],
        [s2.e, s2.s],
        [s2.e, s2.n],
        [s2.w, s2.n]
      ];
    else if (s2.t === "c") {
      pts2 = [];
      for (let k = 0; k < 72; k++) {
        const [x, y] = dest(s2.lat, s2.lon, s2.km, k * 5);
        pts2.push([near(x, s2.lon), y]);
      }
      const pole = poleIn(s2);
      if (pole) {
        pts2.sort((p, q) => p[0] - q[0]);
        const a = pts2[0], z = pts2[pts2.length - 1], f = (s2.lon + 180 - z[0]) / (a[0] + 360 - z[0] || 1), yEdge = z[1] + f * (a[1] - z[1]);
        pts2 = [[s2.lon - 180, yEdge], ...pts2, [s2.lon + 180, yEdge], [s2.lon + 180, pole * MERC_LAT], [s2.lon - 180, pole * MERC_LAT]];
      }
    } else pts2 = s2.pts.slice();
    const off = near(midLon(s2), lon02) - midLon(s2);
    const out = pts2.map(([x, y]) => [x + off, y]);
    out.push(out[0]);
    return out;
  }
  function bbox(s2) {
    const r = ring(s2, midLon(s2));
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of r) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      so = Math.min(so, y);
      n = Math.max(n, y);
    }
    return [w, so, e, n];
  }
  function areaKm22(s2) {
    if (s2.t === "c") return 2 * Math.PI * R_KM2 * R_KM2 * (1 - Math.cos(s2.km / R_KM2));
    const r = ring(s2, midLon(s2));
    let a = 0;
    for (let i = 0; i + 1 < r.length; i++) a += rad(r[i + 1][0] - r[i][0]) * (2 + Math.sin(rad(r[i][1])) + Math.sin(rad(r[i + 1][1])));
    return Math.abs(a * R_KM2 * R_KM2 / 2);
  }
  var deg3 = (v, p, n, dp = 2) => `${Math.abs(v).toFixed(dp)}\xB0${v < 0 ? n : p}`;
  var wrap = (lon) => near(lon, 0);
  var latW = (v, dp = 2) => deg3(v, "N", "S", dp);
  var lonW = (v, dp = 2) => deg3(wrap(v), "E", "W", dp);
  function describe(s2) {
    if (s2.t === "r") return `Box ${latW(s2.s, 1)} to ${latW(s2.n, 1)}, ${lonW(s2.w, 1)} to ${lonW(s2.e, 1)}`;
    if (s2.t === "c") return `${Math.round(s2.km).toLocaleString("en-US")} km around ${latW(s2.lat, 1)}, ${lonW(s2.lon, 1)}`;
    return `Drawn shape, about ${roundArea(areaKm22(s2))} km\xB2`;
  }
  var roundArea = (a) => {
    const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, a))) - 1));
    return (Math.round(a / p) * p).toLocaleString("en-US");
  };
  var num = (v, dp) => String(Number(v.toFixed(dp)));
  function encode(s2) {
    if (s2.t === "r") return `r:${[s2.s, s2.w, s2.n, s2.e].map((v) => num(v, 3)).join(",")}`;
    if (s2.t === "c") return `c:${num(s2.lat, 3)},${num(s2.lon, 3)},${num(s2.km, 1)}`;
    return `p:${s2.pts.map(([x, y]) => `${num(y, 2)},${num(x, 2)}`).join(",")}`;
  }
  function decode(t) {
    const m = /^([rcp]):(.+)$/.exec(t.trim());
    if (!m) return null;
    const v = m[2].split(",").map(Number);
    if (!v.length || v.some((x) => !Number.isFinite(x))) return null;
    const okLat = (y) => y >= -90 && y <= 90, okLon = (x) => x >= -540 && x <= 540;
    if (m[1] === "r") {
      if (v.length !== 4) return null;
      const [s2, w, n, e] = v;
      if (!okLat(s2) || !okLat(n) || !okLon(w) || !okLon(e) || !(n > s2) || !(e > w) || e - w > 360) return null;
      return { t: "r", s: s2, w, n, e };
    }
    if (m[1] === "c") {
      if (v.length !== 3) return null;
      const [lat, lon, r] = v;
      if (!okLat(lat) || !okLon(lon) || !(r > 0) || r > 5e3) return null;
      return { t: "c", lat, lon, km: r };
    }
    if (v.length < 6 || v.length % 2 || v.length > 400) return null;
    const pts2 = [];
    for (let i = 0; i < v.length; i += 2) {
      if (!okLat(v[i]) || !okLon(v[i + 1])) return null;
      pts2.push([v[i + 1], v[i]]);
    }
    return { t: "p", pts: pts2 };
  }
  function simplify(pts2, tol, max = 120) {
    if (pts2.length <= 3) return pts2;
    const keep = new Uint8Array(pts2.length);
    keep[0] = keep[pts2.length - 1] = 1;
    const stack = [[0, pts2.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, bd = 0;
      const [x1, y1] = pts2[a], [x2, y2] = pts2[b], dx = x2 - x1, dy = y2 - y1, L2 = Math.hypot(dx, dy);
      for (let i = a + 1; i < b; i++) {
        const d = L2 < 1e-9 ? Math.hypot(pts2[i][0] - x1, pts2[i][1] - y1) : Math.abs(dy * pts2[i][0] - dx * pts2[i][1] + x2 * y1 - y2 * x1) / L2;
        if (d > bd) {
          bd = d;
          best = i;
        }
      }
      if (best > 0 && bd > tol) {
        keep[best] = 1;
        stack.push([a, best], [best, b]);
      }
    }
    let out = pts2.filter((_, i) => keep[i]);
    if (out.length > max) {
      const step = out.length / max;
      out = Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
    }
    return out;
  }

  // src/aplot.ts
  var INK23 = "#55524c";
  var GRID2 = "#e4e0d7";
  var ZERO2 = "#ebe8e1";
  var TYPICAL2 = "#6b665c";
  var BAR_SEEN2 = "#b8b2a7";
  var BAR_CONV2 = "#dcd7cd";
  var PAPER3 = "#faf9f6";
  var STYLE3 = {
    fontFamily: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums lining-nums",
    background: "transparent",
    color: INK2,
    overflow: "visible"
  };
  var TIP2 = { fill: "#fffefa", stroke: INK2, fontSize: 12, textPadding: 7, lineHeight: 1.35 };
  var PIN_COLOURS = ["#1b1b1b", "#2166ac", "#b2182b", "#7a6a3a"];
  function niceMax3(v) {
    if (v <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    for (const z of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f <= z) return z * p;
    return 10 * p;
  }
  var yTop2 = (v) => Math.max(5, niceMax3(v));
  var yAxis2 = (ymax) => ({
    domain: [0, ymax],
    grid: GRID2,
    tickFormat: (v) => Number.isInteger(v) ? short(v) : "",
    label: null,
    tickSize: 0,
    ticks: 4
  });
  function mount2(el, fig, click) {
    el.replaceChildren(fig);
    if (click) {
      fig.style.cursor = "pointer";
      fig.addEventListener("click", () => {
        if (fig.value != null) click(fig.value);
      });
    }
  }
  var nHot = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  function calendarCells(F2, S3, st) {
    const out = [];
    for (let i = 0; i < F2.nm; i++) {
      const y = F2.y0 + Math.floor(i / 12), m = i % 12, v = S3[i], u = st.usual[m], part = !!F2.partial && i === F2.partial.i;
      out.push({ r: String(y), y, m, v, usual: u, part, ratio: part ? NaN : u > 0 ? v / u : v > 0 ? 4 : 1 });
    }
    for (let m = 0; m < 12; m++) out.push({ r: "Usual", y: 0, m, v: st.usual[m], usual: st.usual[m], part: false, ratio: 1 });
    return out;
  }
  function calendarScale2(cells) {
    const c = classBreaks(cells.filter((x) => x.r !== "Usual").map((x) => x.v));
    return { ...c, colours: classColours(c.breaks, CAL) };
  }
  function calendar2(el, cells, mode, pick2, click) {
    const Plot = window.Plot, W = el.clientWidth || 360, rows = [...new Set(cells.map((c) => c.r))].sort((a, b) => a === "Usual" ? 1 : b === "Usual" ? -1 : +b - +a), rowH = W < 340 ? 12 : 13, H = rows.length * rowH + 26, sc = calendarScale2(cells), color = mode === "anom" ? { type: "diverging-log", scheme: "RdBu", reverse: true, pivot: 1, domain: [0.25, 4], clamp: true } : sc.breaks.length ? { type: "threshold", domain: sc.breaks, range: sc.colours } : { type: "ordinal", range: sc.colours }, f = pick2 ? cells.find((c) => c.r === String(pick2.y) && c.m === pick2.m) : null, shown2 = mode === "anom" ? cells.filter((c) => !c.part && (c.v > 0 || c.usual > 0)) : cells.filter((c) => c.v > 0);
    const fig = Plot.plot({
      width: W,
      height: H,
      style: STYLE3,
      marginLeft: 40,
      marginRight: 4,
      marginTop: 22,
      marginBottom: 4,
      padding: 0,
      x: {
        axis: "top",
        domain: MON.map((_, m) => m),
        tickFormat: (m) => W < 380 ? MON[m][0] : MON[m],
        tickSize: 0,
        label: null,
        tickPadding: 6
      },
      y: { domain: rows, tickSize: 0, label: null, tickPadding: 6, tickFormat: (r) => r === "Usual" ? "Usual" : r },
      color,
      marks: [
        Plot.cell(cells, { x: "m", y: "r", fill: ZERO2, inset: 0.5 }),
        Plot.cell(shown2, { x: "m", y: "r", fill: mode === "anom" ? "ratio" : "v", inset: 0.5 }),
        /* the month still under way: a dashed edge, never compared */
        Plot.cell(
          cells.filter((c) => c.part),
          { x: "m", y: "r", fill: "none", stroke: INK23, strokeWidth: 1, strokeDasharray: "2,2", inset: 1 }
        ),
        Plot.ruleY(["Usual"], { stroke: INK2, strokeWidth: 1, dy: -rowH / 2 - 1 }),
        f ? Plot.cell([f], { x: "m", y: "r", fill: "none", stroke: INK2, strokeWidth: 2 }) : null,
        Plot.tip(
          cells,
          Plot.pointer({
            x: "m",
            y: "r",
            ...TIP2,
            title: (c) => c.r === "Usual" ? `A usual ${MONL[c.m]}: ${nHot(c.usual)}
(median of the complete years)` : c.part ? `${MONL[c.m]} ${c.y}, so far: ${nHot(c.v)}
Not over, so not compared with a usual ${MONL[c.m]}` : `${MONL[c.m]} ${c.y}: ${nHot(c.v)}
Usual ${MONL[c.m]}: ${fmt(c.usual)}` + (c.usual > 0 ? ` (${times(c.v / c.usual)} usual)` : c.v > 0 ? " (usually none)" : "") + `
Click to show it on the map`
          })
        )
      ]
    });
    fig.setAttribute("aria-label", "Hotspots in the area, each month of each year");
    mount2(el, fig, (c) => c.r !== "Usual" && click(c));
    return sc;
  }
  function season(el, F2, S3, st, year, click) {
    const Plot = window.Plot, W = el.clientWidth || 360, H = 210, pts2 = [];
    for (let i = 0; i < F2.nm; i++) {
      if (F2.partial && i === F2.partial.i) continue;
      pts2.push({ y: F2.y0 + Math.floor(i / 12), m: i % 12, v: S3[i] });
    }
    const top = st.top?.y, yr = pts2.filter((p) => p.y === year), usual = st.usual.map((v, m) => ({ m, v })), ymax = yTop2(Math.max(1e-9, ...pts2.map((p) => p.v)));
    const fig = Plot.plot({
      width: W,
      height: H,
      style: STYLE3,
      marginLeft: 40,
      marginRight: 12,
      marginTop: 12,
      marginBottom: 24,
      x: { domain: [0, 11], ticks: [0, 2, 4, 6, 8, 10], tickFormat: (m) => MON[m], label: null, tickSize: 0 },
      y: yAxis2(ymax),
      marks: [
        Plot.lineY(
          pts2.filter((p) => p.y !== year && p.y !== top),
          { x: "m", y: "v", z: "y", stroke: "#ddd8ce", strokeWidth: 1 }
        ),
        top !== void 0 && top !== year ? Plot.lineY(
          pts2.filter((p) => p.y === top),
          { x: "m", y: "v", stroke: INK2, strokeWidth: 1.5 }
        ) : null,
        Plot.lineY(usual, { x: "m", y: "v", stroke: TYPICAL2, strokeWidth: 2, strokeDasharray: "4,3" }),
        yr.length ? Plot.lineY(yr, { x: "m", y: "v", stroke: RED, strokeWidth: 2.5 }) : null,
        yr.length ? Plot.dot(yr, { x: "m", y: "v", fill: RED, r: 2.4 }) : null,
        Plot.ruleX(usual, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
        Plot.tip(
          usual,
          Plot.pointerX({
            x: "m",
            y: "v",
            ...TIP2,
            title: (u) => {
              const a = yr.find((p) => p.m === u.m);
              return `${MONL[u.m]}
Usual: ${nHot(u.v)}` + (a ? `
${year}: ${fmt(a.v)}` : year === F2.cy ? `
${year}: not over yet` : "") + (top !== void 0 && top !== year ? `
${top} (most active year): ${fmt(S3[idxOf(F2, top, u.m)])}` : "") + `
Click to show ${MONL[u.m]} ${year} on the map`;
            }
          })
        )
      ]
    });
    fig.setAttribute("aria-label", `Hotspots by month: ${year} against a usual year`);
    mount2(el, fig, (u) => click(u.m));
  }
  function trend(el, F2, S3, st, viirsYear3, year, click) {
    const Plot = window.Plot, W = el.clientWidth || 360, H = 200, ys = st.years.map((r) => ({ ...r, part: false }));
    if (F2.cy > F2.yb) {
      let t = 0;
      for (let i = idxOf(F2, F2.cy, 0); i < F2.nm; i++) t += S3[i];
      ys.push({ y: F2.cy, v: t, part: true });
    }
    const top = st.top?.y, xs = ys.map((r) => r.y), ymax = yTop2(Math.max(1e-9, ...ys.map((r) => r.v)) * 1.08), fill = (r) => r.y === year ? RED : r.y === top ? INK2 : r.y < viirsYear3 ? BAR_CONV2 : BAR_SEEN2;
    const tr = st.trend, line = tr?.clear ? st.years.map((r) => ({ y: r.y, v: Math.max(0, Math.expm1(tr.a + tr.b * (r.y - F2.y0))) })) : [];
    const step = Math.max(1, Math.ceil((xs.length - 1) / (W < 340 ? 3 : 4)));
    const fig = Plot.plot({
      width: W,
      height: H,
      style: STYLE3,
      marginLeft: 40,
      marginRight: 12,
      marginTop: 14,
      marginBottom: 24,
      x: {
        domain: xs,
        ticks: xs.filter((_, i) => (xs.length - 1 - i) % step === 0),
        tickFormat: (y) => String(y),
        label: null,
        tickSize: 0,
        padding: 0.18
      },
      y: yAxis2(ymax),
      marks: [
        Plot.barY(
          ys.filter((r) => !r.part),
          { x: "y", y: "v", fill }
        ),
        Plot.barY(
          ys.filter((r) => r.part),
          { x: "y", y: "v", fill: "#efebe3", stroke: INK23, strokeWidth: 1.1, strokeDasharray: "3,2" }
        ),
        line.length ? Plot.lineY(line, { x: "y", y: "v", stroke: INK2, strokeWidth: 1.4, strokeDasharray: "5,3" }) : null,
        Plot.tip(
          ys,
          Plot.pointerX({
            x: "y",
            y: "v",
            ...TIP2,
            title: (r) => r.part ? `${r.y} so far: ${nHot(r.v)}
Not over, so not ranked` : `${r.y}: ${nHot(r.v)}` + (st.mean > 0 ? `
${r.v >= st.mean ? "+" : ""}${Math.round((r.v / st.mean - 1) * 100)}% against the average year` : "") + (r.y < viirsYear3 ? "\nConverted from MODIS" : "\nSeen by VIIRS") + `
Click to show ${r.y} on the map`
          })
        )
      ]
    });
    fig.setAttribute("aria-label", "Hotspots in the area per year, with the trend line");
    mount2(el, fig, (r) => click(r.y));
  }
  function compareChart(el, lines2, share2) {
    const Plot = window.Plot, W = el.clientWidth || 360, H = 200, pts2 = lines2.flatMap((l) => l.usual.map((v, m) => ({ l: l.label, m, v: share2 ? l.share[m] : v, raw: v, c: l.colour, d: l.dash }))), ymax = share2 ? Math.max(10, niceMax3(Math.max(...pts2.map((p) => p.v)))) : yTop2(Math.max(1e-9, ...pts2.map((p) => p.v)));
    const fig = Plot.plot({
      width: W,
      height: H,
      style: STYLE3,
      marginLeft: 40,
      marginRight: 24,
      marginTop: 12,
      marginBottom: 24,
      x: { domain: [0, 11], ticks: [0, 2, 4, 6, 8, 10], tickFormat: (m) => MON[m], label: null, tickSize: 0 },
      y: { ...yAxis2(ymax), tickFormat: (v) => share2 ? `${v}%` : Number.isInteger(v) ? short(v) : "" },
      marks: [
        ...lines2.map(
          (l) => Plot.lineY(
            pts2.filter((p) => p.l === l.label),
            { x: "m", y: "v", stroke: l.colour, strokeWidth: 2, strokeDasharray: l.dash || null }
          )
        ),
        Plot.text(
          lines2.map((l) => pts2.filter((p) => p.l === l.label)[11]),
          {
            x: "m",
            y: "v",
            text: "l",
            dx: 8,
            textAnchor: "start",
            fill: "c",
            fontWeight: 600,
            stroke: PAPER3,
            strokeWidth: 3,
            paintOrder: "stroke"
          }
        ),
        Plot.tip(
          pts2,
          Plot.pointer({
            x: "m",
            y: "v",
            ...TIP2,
            title: (p) => share2 ? `${p.l}, ${MONL[p.m]}: usually ${Math.round(p.v)}% of the year's hotspots
(median over the complete years)` : `${p.l}, a usual ${MONL[p.m]}: ${nHot(p.raw)}`
          })
        )
      ]
    });
    fig.setAttribute("aria-label", "A usual year in each area");
    mount2(el, fig);
  }

  // src/areas.ts
  var A = {
    k: null,
    d: null,
    g: null,
    F: null,
    err: "",
    open: false,
    cur: null,
    want: null,
    wantPins: [],
    wantBlock: null,
    pins: [],
    cal: "count",
    seasonY: 0,
    watchM: 11,
    watchOn: false,
    time: { on: false, y: 2025, m: 7 },
    tool: null,
    map: null,
    lon0: 0,
    markers: [],
    pinMarks: [],
    popup: null
  };
  var playTimer;
  var esc5 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var nHot2 = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  var cap2 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  var ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  function cellWords(lat) {
    const c = A.g?.cell ?? 0, ns = c * 111.2, ew = ns * Math.cos(lat * Math.PI / 180), r = (v) => v >= 20 ? Math.round(v / 5) * 5 : Math.max(1, Math.round(v));
    return `${c}\xB0` + (ew < ns * 0.85 ? ` (about ${r(ns)} by ${r(ew)} km here)` : ` (about ${r(ns)} km)`);
  }
  var meanLat = (idx) => {
    let t = 0;
    for (let k = 0; k < idx.length; k++) t += A.g.lat[idx[k]];
    return idx.length ? t / idx.length : 0;
  };
  var STACKED = "(max-width: 900px), (max-height: 560px)";
  var phone2 = () => matchMedia(STACKED).matches;
  function scrollPageTo(el, smooth = false) {
    const sc = document.getElementById("country");
    if (!sc) return;
    const head = sc.querySelector(".cpTop")?.getBoundingClientRect().height ?? 0, top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - head - 8;
    sc.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }
  function showMapArea() {
    const first = ["aCoords", "aTime", "aHint"].map((id) => document.getElementById(id)).find((e) => !!e && !e.hidden && e.offsetHeight > 0);
    scrollPageTo(first ?? $("cMap"));
  }
  var viirsYear = () => A.d?.viirs_from[0] ?? 2012;
  var ICON = {
    rect: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="5.5" width="13" height="9"/></svg>`,
    circle: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/></svg>`,
    poly: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5c1.5-5 3.5-9.5 6-10.5 2.6-1 1.2 4.2 3.4 4.6 1.4.3 2.1-1.2 2.6-2.4"/></svg>`,
    coords: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3 10h14"/><circle cx="10" cy="10" r="3"/></svg>`,
    time: `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="4.5" width="13" height="12"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/></svg>`,
    watch: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/></svg>`
  };
  function areasStart(d) {
    if (A.k !== d.country) areasReset();
    A.k = d.country;
    A.d = d;
    const sh = shapeOf(d.country);
    A.lon0 = sh ? sh.c[0] : (d.bbox[0] + d.bbox[2]) / 2;
    buildBar();
    const h2 = parseHash();
    if (h2 && (h2.area || h2.pins.length)) {
      A.want = h2.area;
      A.wantPins = h2.pins;
      openTools();
      requestAnimationFrame(() => document.getElementById("cMapTitle")?.scrollIntoView({ block: "start" }));
    }
  }
  function areasReset() {
    loading = false;
    stopPlay2();
    disarm();
    for (const m of [...A.markers, ...A.pinMarks]) m.remove();
    A.popup?.remove();
    Object.assign(A, {
      k: null,
      d: null,
      g: null,
      F: null,
      err: "",
      open: false,
      cur: null,
      want: null,
      wantPins: [],
      wantBlock: null,
      pins: [],
      cal: "count",
      watchOn: false,
      time: { on: false, y: 2025, m: 7 },
      tool: null,
      map: null,
      markers: [],
      pinMarks: [],
      popup: null
    });
    const bar = document.getElementById("aBar");
    if (bar) bar.innerHTML = "";
    const p = document.getElementById("aPanel");
    if (p) {
      p.hidden = true;
      p.innerHTML = "";
    }
    document.getElementById("aWork")?.classList.remove("on");
  }
  function parseHash() {
    const parts = location.hash.split("/");
    if (parts[0] !== "#c" || !A.k || slugOf(safeDecode(parts[1] ?? "")) !== slugOf(A.k)) return null;
    let area = null, hasArea = false, hasPins = false;
    const pins = [];
    for (const seg of parts.slice(2)) {
      const t = safeDecode(seg);
      if (t.startsWith("area=")) {
        hasArea = true;
        area = decode(t.slice(5));
      } else if (t.startsWith("pins=")) {
        hasPins = true;
        for (const s2 of t.slice(5).split("~")) {
          const lm = /^([A-D])\.(.+)$/.exec(s2), x = decode(lm ? lm[2] : s2), letter = lm && !pins.some((p) => p.letter === lm[1]) ? lm[1] : null;
          if (x && pins.length < 4) pins.push({ s: x, letter });
        }
      }
    }
    return { area, pins, hasArea, hasPins };
  }
  function safeDecode(t) {
    try {
      return decodeURIComponent(t);
    } catch {
      return t;
    }
  }
  function hashFor() {
    if (!A.k) return "";
    let h2 = "#c/" + slugOf(A.k);
    if (A.cur?.shape) h2 += "/area=" + encode(A.cur.shape);
    const ps = A.pins.filter((p) => p.shape);
    if (ps.length) h2 += "/pins=" + ps.map((p) => `${p.letter}.${encode(p.shape)}`).join("~");
    return h2;
  }
  function writeHash() {
    const h2 = hashFor();
    if (h2 && location.hash !== h2) history.replaceState(null, "", h2);
  }
  addEventListener("hashchange", () => {
    if (!A.k || !A.d || !location.hash.startsWith("#c/")) return;
    const h2 = parseHash();
    if (!h2 || location.hash === hashFor()) return;
    if (!h2.hasArea && !h2.hasPins) {
      if (A.g) {
        A.pins = [];
        setArea(null);
      }
      return;
    }
    if (!h2.area && !h2.pins.length) {
      writeHash();
      return;
    }
    A.want = h2.area;
    A.wantPins = h2.pins;
    openTools();
  });
  function buildBar() {
    const bar = document.getElementById("aBar");
    if (!bar || bar.firstChild) return;
    bar.innerHTML = `<div class="aTools"><div class="aGroup" role="group" aria-label="Pick an area"><span class="aLbl">Pick an area</span>` + ["rect", "circle", "poly"].map(
      (t) => `<button type="button" class="aBtn" data-tool="${t}" aria-pressed="false">${ICON[t]}${{ rect: "Rectangle", circle: "Circle", poly: "Pencil" }[t]}</button>`
    ).join("") + `<button type="button" class="aBtn" id="aCoordBtn" aria-expanded="false">${ICON.coords}Coordinates</button></div><div class="aGroup" role="group" aria-label="Map views"><button type="button" class="aBtn" id="aTimeBtn" aria-pressed="false">${ICON.time}Month by month</button><button type="button" class="aBtn" id="aWatchBtn" aria-pressed="false">${ICON.watch}Where to watch</button></div></div><form class="aCoords" id="aCoords" hidden novalidate autocomplete="off"><label class="aField">Shape <select id="aCShape"><option value="r">Box</option><option value="c">Circle</option></select></label><span class="aFields" id="aCR"><label class="aField">South <input id="aCs" type="number" step="any" placeholder="-10"></label><label class="aField">West <input id="aCw" type="number" step="any" placeholder="-50"></label><label class="aField">North <input id="aCn" type="number" step="any" placeholder="-5"></label><label class="aField">East <input id="aCe" type="number" step="any" placeholder="-45"></label></span><span class="aFields" id="aCC" hidden><label class="aField">Latitude <input id="aClat" type="number" step="any" placeholder="-8.5"></label><label class="aField">Longitude <input id="aClon" type="number" step="any" placeholder="-47"></label><label class="aField">Radius, km <input id="aCkm" type="number" step="any" min="5" max="3000" placeholder="100"></label></span><button type="submit" class="aBtn aGo">Show this area</button><span class="aMsg" id="aCMsg" role="status"></span></form><div class="aTime" id="aTime" hidden><span class="aLbl">Map shows</span><select id="aTM" aria-label="Month"></select><select id="aTY" aria-label="Year"></select><button type="button" class="aBtn" id="aPlay" aria-pressed="false">Play</button><button type="button" class="cpText aSmallText" id="aTOff">Back to the totals</button><div class="aTKey" id="aTKey"></div></div><p class="aHint" id="aHint" role="status"></p>`;
    bar.querySelectorAll("[data-tool]").forEach((b) => b.onclick = () => arm(b.dataset.tool));
    $("aCoordBtn").onclick = () => {
      const f = $("aCoords"), open2 = f.hidden;
      disarm();
      f.hidden = !open2;
      $("aCoordBtn").setAttribute("aria-expanded", String(open2));
      if (open2) {
        openTools();
        prefillCoords();
        ($("aCShape").value === "r" ? $("aCs") : $("aClat")).focus();
      }
    };
    $("aCShape").onchange = () => {
      const r = $("aCShape").value === "r";
      $("aCR").hidden = !r;
      $("aCC").hidden = r;
      $("aCMsg").textContent = "";
    };
    $("aCoords").onsubmit = (e) => {
      e.preventDefault();
      coordsSubmit();
    };
    $("aTimeBtn").onclick = () => {
      openTools();
      if (A.time.on) timeOff();
      else timeOn(A.time.y, A.time.m);
    };
    $("aWatchBtn").onclick = () => {
      openTools();
      A.watchOn = !A.watchOn;
      syncBar();
      drawWatch();
      if (A.watchOn) showBlock("aWatch");
    };
    $("aTM").onchange = $("aTY").onchange = () => {
      stopPlay2();
      timeOn(+$("aTY").value, +$("aTM").value);
    };
    $("aPlay").onclick = () => playTimer ? stopPlay2() : play();
    $("aTOff").onclick = timeOff;
    syncBar();
  }
  function syncBar() {
    document.querySelectorAll("#aBar [data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === A.tool)));
    const tb = document.getElementById("aTimeBtn"), wb = document.getElementById("aWatchBtn");
    tb?.setAttribute("aria-pressed", String(A.time.on));
    wb?.setAttribute("aria-pressed", String(A.watchOn));
    const t = document.getElementById("aTime");
    if (t) t.hidden = !A.time.on;
  }
  var hint = (t) => {
    const h2 = document.getElementById("aHint");
    if (h2) h2.textContent = t;
  };
  var loading = false;
  function openTools(retry = false) {
    if (!A.k) return;
    const k = A.k;
    if (!A.open) {
      A.open = true;
      buildPanel();
      $("aWork").classList.add("on");
      $("aPanel").hidden = false;
      requestAnimationFrame(() => A.map?.resize());
      loadPlotLib().catch(() => void 0);
    }
    if (A.g) return applyWanted();
    if (loading || A.err && !retry) return;
    loading = true;
    A.err = "";
    stateMsg(`Fetching the month-by-month squares for ${theName(A.d.name)} from Hugging Face\u2026`, false);
    loadGrid(k).then(
      (g) => {
        loading = false;
        if (A.k !== k) return;
        A.g = g;
        A.F = frameOf(g);
        A.err = "";
        A.seasonY = A.F.cy;
        A.time = { on: A.time.on, y: A.F.cy > A.F.yb ? A.F.cy : A.F.yb, m: A.F.cy > A.F.yb ? A.F.cyLast : 11 };
        A.watchM = ((A.F.partial ? A.F.partial.m - 1 : A.F.cyLast) + 1) % 12;
        fillTimeSelects();
        applyWanted();
      },
      (e) => {
        loading = false;
        if (A.k !== k) return;
        A.err = e instanceof Error ? e.message : String(e);
        stateMsg(
          e instanceof NoCells ? `${A.err}. The rest of the page is unaffected.` : `The month-by-month squares did not arrive: ${A.err}. The rest of the page is unaffected.`,
          !(e instanceof NoCells)
        );
      }
    );
  }
  function applyWanted() {
    if (A.wantPins.length) {
      A.pins = [];
      const want = A.wantPins.slice(0, 4);
      for (const w of want) if (w.letter) A.pins.push(asPin(makeArea(w.s), w.letter));
      for (const w of want) if (!w.letter) A.pins.push(asPin(makeArea(w.s)));
      A.pins.sort((x, z) => want.findIndex((w) => w.s === x.shape) - want.findIndex((w) => w.s === z.shape));
      A.wantPins = [];
    }
    const s2 = A.want;
    A.want = null;
    if (s2 || !A.cur) setArea(s2, !!s2);
    else render2();
  }
  function stateMsg(t, retry) {
    if (!document.getElementById("aState")) return;
    $("aState").hidden = false;
    $("aMain").hidden = true;
    $("aStateMsg").textContent = t;
    $("aRetry").hidden = !retry;
  }
  function buildPanel() {
    const p = $("aPanel");
    if (p.firstChild) return;
    p.innerHTML = `<header class="aHead"><div class="aHeadT"><p class="cpPart">Selected area</p><h3 class="aName" id="aName">${esc5(A.d ? A.d.name : "")}</h3></div><button type="button" class="aX" id="aClose" aria-label="Close the area tools">\xD7</button></header><p class="aNote" id="aNote"></p><div class="aActs"><button type="button" class="aBtn" id="aPin">Pin to compare</button><button type="button" class="aBtn" id="aShare">Copy link</button><button type="button" class="aBtn" id="aCsv">CSV</button><button type="button" class="aBtn" id="aAsk">Ask the copilot</button><button type="button" class="cpText aSmallText" id="aWhole" hidden>Whole country</button></div><p class="aMsg" id="aMsg" role="status"></p><div class="aState" id="aState"><p id="aStateMsg"></p><button type="button" class="cpText" id="aRetry" hidden>Try again</button></div><div id="aMain" hidden><dl class="aKpis" id="aKpis"></dl><p class="aNone" id="aNone" hidden></p><div id="aFigs"><section class="aBlock"><div class="aBH"><h4>Burning activity calendar</h4><div class="cpSeg aSeg" id="aCalSeg" role="group" aria-label="Calendar values"><button type="button" data-m="count">How much fire</button><button type="button" data-m="anom">More or less than usual</button></div></div><div class="aKey" id="aCalKey"></div><div class="cpPlot" id="aCal"></div><p class="aCap" id="aCalNote"></p></section><section class="aBlock"><div class="aBH"><h4 id="aSeasonT">This year against a usual one</h4><select id="aSeasonY" aria-label="Year to show"></select></div><div class="cpPlot" id="aSeason"></div><p class="aCap" id="aSeasonNote"></p></section><section class="aBlock"><div class="aBH"><h4 id="aTrendT">Hotspots per year</h4></div><div class="cpPlot" id="aTrend"></div><p class="aCap" id="aTrendNote"></p></section></div><section class="aBlock" id="aCmp" hidden><div class="aBH"><h4>Areas side by side</h4><button type="button" class="cpText aSmallText" id="aUnpin">Remove all</button></div><div class="cpScroll"><table class="aCmpT" id="aCmpT"></table></div><div class="aBH aSub"><span id="aCmpCT">A usual year in each</span><div class="cpSeg aSeg" id="aCmpSeg" role="group" aria-label="Compare by"><button type="button" data-s="n" aria-pressed="true">Hotspots</button><button type="button" data-s="p" aria-pressed="false">Share of the year</button></div></div><div class="cpPlot" id="aCmpC"></div><p class="aCap" id="aCmpNote"></p></section><section class="aBlock" id="aWatch"><div class="aBH"><h4>Where to watch in <select id="aWM" aria-label="Month ahead"></select></h4><label class="aChk"><input type="checkbox" id="aWOn"> On the map</label></div><p class="aCap aWSub" id="aWSub"></p><ol class="aWList" id="aWList"></ol><p class="aCap" id="aWFoot"></p></section></div>`;
    $("aClose").onclick = closeTools;
    $("aRetry").onclick = () => openTools(true);
    $("aWhole").onclick = () => setArea(null, true);
    $("aPin").onclick = pinCurrent;
    $("aShare").onclick = share;
    $("aCsv").onclick = csv;
    $("aAsk").onclick = () => window.dispatchEvent(new CustomEvent("ask-area"));
    $("aUnpin").onclick = () => {
      A.pins = [];
      writeHash();
      render2();
    };
    p.querySelectorAll("#aCalSeg button").forEach(
      (b) => b.onclick = () => {
        A.cal = b.dataset.m === "anom" ? "anom" : "count";
        drawCharts();
      }
    );
    p.querySelectorAll("#aCmpSeg button").forEach(
      (b) => b.onclick = () => {
        p.querySelectorAll("#aCmpSeg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        drawCompare();
      }
    );
    $("aSeasonY").onchange = () => {
      A.seasonY = +$("aSeasonY").value;
      drawCharts();
    };
    $("aWM").onchange = () => {
      A.watchM = +$("aWM").value;
      A.watchOn = true;
      syncBar();
      drawWatch();
    };
    $("aWOn").onchange = () => {
      A.watchOn = $("aWOn").checked;
      syncBar();
      drawWatch();
    };
  }
  function showBlock(id) {
    const p = document.getElementById("aPanel"), b = document.getElementById(id), main = document.getElementById("aMain");
    if (!p || !b) return;
    if (!main || main.hidden) {
      A.wantBlock = id;
      return;
    }
    if (!window.Plot) {
      const k = A.k, again = () => requestAnimationFrame(() => A.k === k && showBlock(id));
      loadPlotLib().then(again, again);
      return;
    }
    if (phone2()) return scrollPageTo(b, true);
    p.scrollTo({ top: p.scrollTop + b.getBoundingClientRect().top - p.getBoundingClientRect().top - 8, behavior: "smooth" });
  }
  function closeTools() {
    stopPlay2();
    disarm();
    timeOff();
    A.watchOn = false;
    A.open = false;
    A.cur = null;
    A.pins = [];
    drawWatch();
    drawShapes();
    $("aPanel").hidden = true;
    $("aWork").classList.remove("on");
    $("aCoords").hidden = true;
    syncBar();
    hint("");
    writeHash();
    requestAnimationFrame(() => A.map?.resize());
  }
  function makeArea(shape) {
    const g = A.g, F2 = A.F, idx = [];
    if (!shape) for (let c = 0; c < g.n; c++) idx.push(c);
    else {
      const inside = tester(shape);
      for (let c = 0; c < g.n; c++) if (inside(g.lat[c], g.lon[c])) idx.push(c);
    }
    const S3 = seriesOf(g, idx);
    return { shape, idx: Int32Array.from(idx), S: S3, st: stats(F2, S3) };
  }
  var LETTERS = "ABCD";
  function asPin(a, want) {
    const used = new Set(A.pins.map((p) => p.letter)), letter = want && !used.has(want) ? want : [...LETTERS].find((l) => !used.has(l)) ?? "D";
    return { ...a, letter, colour: PIN_COLOURS[LETTERS.indexOf(letter)] };
  }
  var nameOfArea = (a) => a.shape ? describe(a.shape) : `All of ${theName(A.d.name)}`;
  function setArea(shape, fit2 = false) {
    if (shape) shape = decode(encode(shape)) ?? shape;
    if (!A.g) {
      A.want = shape;
      return openTools();
    }
    A.cur = makeArea(shape);
    writeHash();
    render2();
    if (fit2 && shape) fitTo(shape);
    if (phone2() && shape) showMapArea();
  }
  function pinCurrent() {
    const a = A.cur;
    if (!a) return;
    const msg = $("aMsg");
    if (A.pins.some((p) => p.shape && a.shape && encode(p.shape) === encode(a.shape)) || !a.shape && A.pins.some((p) => !p.shape)) {
      msg.textContent = "This area is already pinned.";
      return;
    }
    if (A.pins.length >= 4) {
      msg.textContent = "Four areas are pinned, the most this compares. Remove one first.";
      return;
    }
    A.pins.push(asPin(a));
    msg.textContent = `Pinned as ${A.pins[A.pins.length - 1].letter}. Draw another area to set it beside this one.`;
    writeHash();
    render2();
  }
  function render2() {
    const a = A.cur, F2 = A.F;
    if (!a || !F2 || !document.getElementById("aMain")) return;
    $("aState").hidden = true;
    $("aMain").hidden = false;
    $("aName").textContent = nameOfArea(a);
    $("aWhole").hidden = !a.shape;
    $("aMsg").textContent = "";
    const n = a.idx.length, size2 = cellWords(n ? meanLat(a.idx) : a.shape ? (bbox(a.shape)[1] + bbox(a.shape)[3]) / 2 : 0);
    const coarser = A.d && A.g.cell > A.d.cell ? ` These squares are coarser than the ${A.d.cell}\xB0 squares of the map above.` : "";
    $("aNote").textContent = (!A.g.n ? `No square in ${theName(A.d.name)} has fire on record, so there is nothing to count.` : a.shape ? n ? `Counted on ${n} square${n === 1 ? "" : "s"} of ${size2} with fire on record, whose centre falls inside the shape${a.shape.t === "c" || a.shape.t === "p" ? `; the shape covers about ${roundArea(areaKm22(a.shape))} km\xB2` : ""}.` : `No square with fire on record has its centre inside this shape. The squares are ${size2}; draw a larger area.` : n ? `Counted on all ${n} squares of ${size2} in ${theName(A.d.name)} with fire on record. Draw on the map to look at one part.` : `No square in ${theName(A.d.name)} has fire on record.`) + coarser;
    kpis(a, F2);
    const none = a.st.total === 0;
    $("aNone").hidden = !none;
    $("aNone").textContent = none ? `No hotspots were counted in this area in any month from ${F2.y0} to ${lastWords()}.` : "";
    $("aFigs").hidden = none;
    const yo = [];
    for (let y = F2.y0 + Math.floor((F2.nm - 1) / 12); y >= F2.y0; y--) yo.push(`<option value="${y}">${y}</option>`);
    $("aSeasonY").innerHTML = yo.join("");
    $("aSeasonY").value = String(A.seasonY);
    drawCharts();
    drawCompare();
    drawWatch();
    drawShapes();
    if (A.time.on) drawTime();
    if (A.wantBlock) {
      const b = A.wantBlock;
      A.wantBlock = null;
      requestAnimationFrame(() => showBlock(b));
    }
  }
  var lastWords = () => {
    const p = A.F?.partial;
    return p ? `${p.day1} ${MON[p.m - 1]} ${p.y}` : `December ${A.F.cy}`;
  };
  var monthsWords = (last) => last === 0 ? "January" : `January\u2013${MONL[last]}`;
  function level(p) {
    if (p == null) return { t: "No usual level", c: "" };
    if (p >= 100) return { t: "Far above usual", c: "hi" };
    if (p >= 25) return { t: "Above usual", c: "hi" };
    if (p > -25) return { t: "About usual", c: "" };
    return { t: "Below usual", c: "lo" };
  }
  function trendWords(t) {
    if (!t) return { fig: "Too little fire", c: "", title: "", cell: "\u2013" };
    if (!t.clear) return { fig: "No clear trend", c: "", title: "no clear trend", cell: "unclear" };
    const r = Math.round(t.pct);
    if (Math.abs(r) < 3) return { fig: "Steady", c: "", title: "steady", cell: "steady" };
    return {
      fig: `${r > 0 ? "Up" : "Down"} ${Math.abs(r)}%`,
      c: r > 0 ? "hi" : "lo",
      title: `${r > 0 ? "up" : "down"} ${Math.abs(r)}% per decade`,
      cell: `${r > 0 ? "+" : "\u2212"}${Math.abs(r)}%`
    };
  }
  function kpis(a, F2) {
    const st = a.st, vy = viirsYear(), item2 = (h2, fig, note) => `<div><dt>${h2}</dt><dd class="aFig">${fig}</dd><dd>${note}</dd></div>`, out = [];
    if (st.total === 0) {
      out.push(item2(st.ytd ? `${st.ytd.y} so far` : "Latest year", "None", `No hotspots in this area from ${F2.y0} to ${lastWords()}.`));
    } else if (st.ytd) {
      const y = st.ytd, p = y.usual > 0 ? (y.cur - y.usual) / y.usual * 100 : null, lv = level(p), fig = p == null ? y.cur > 0 ? "Usually none" : "None" : `<span class="${lv.c}">${p >= 0 ? "+" : "\u2212"}${Math.abs(Math.round(p))}%</span><small>${lv.t}</small>`, past = y.n - 1, rk = y.cur < 0.05 ? y.ties ? `; ${y.ties} of the ${past} complete years had none either` : "" : y.ties ? `; tied with ${y.ties} other year${y.ties === 1 ? "" : "s"} for the ${y.rank === 1 ? "" : ordinal(y.rank) + " "}most of ${y.n}` : y.rank === 1 ? `; the most of ${y.n} years` : y.rank === y.n ? `; the fewest of ${y.n} years` : `; the ${ordinal(y.rank)} most of ${y.n} years`, pt = F2.partial;
      out.push(
        item2(
          `${y.y} so far`,
          fig,
          `${cap2(nHot2(y.cur))} in ${monthsWords(y.last)}, against a usual ${fmt(y.usual)} for those months (median of ${F2.y0}\u2013${F2.yb})${rk}.` + (pt && st.part != null ? ` 1\u2013${pt.day1} ${MONL[pt.m - 1]}: ${fmt(st.part)} so far, left out because the month is not over.` : "")
        )
      );
    } else {
      const last = st.years[st.years.length - 1], u = st.usualYear, p = last && u > 0 ? (last.v - u) / u * 100 : null, lv = level(p);
      out.push(
        item2(
          last ? String(last.y) : "Latest year",
          p == null ? "n/a" : `<span class="${lv.c}">${p >= 0 ? "+" : "\u2212"}${Math.abs(Math.round(p))}%</span><small>${lv.t}</small>`,
          last ? `${cap2(nHot2(last.v))}, against a usual year of ${fmt(u)} (median of ${F2.y0}\u2013${F2.yb}).` : ""
        )
      );
    }
    out.push(
      item2(
        "Usual peak month",
        st.total > 0 ? MONL[st.peak] : "None",
        st.total === 0 ? "No fire on record here." : st.usual[st.peak] > 0 ? `A usual ${MONL[st.peak]} has ${nHot2(st.usual[st.peak])}; a usual year, ${fmt(st.usualYear)} (medians of ${F2.y0}\u2013${F2.yb}).` : `Most years have no fire here; ${MONL[st.peak]} has had the most in all.`
      )
    );
    out.push(
      item2(
        "Most active year",
        st.top ? String(st.top.y) : "None",
        st.top ? `${cap2(nHot2(st.top.v))}, ${times(st.top.v / st.mean)} the average year, among the complete years ${F2.y0}\u2013${F2.yb}${st.top.y < vy ? "; converted from MODIS" : ""}.` : `No hotspots in ${F2.y0}\u2013${F2.yb}.`
      )
    );
    const t = st.trend, tw = trendWords(t);
    out.push(
      item2(
        "Long-term trend",
        t?.clear && tw.c ? `<span class="${tw.c}">${tw.fig}</span><small>per decade</small>` : tw.fig,
        !t ? `Fewer than ${TREND_MIN_MEAN} hotspots in an average year, or fewer than ${TREND_MIN_YEARS} years with fire: too little to read a trend.` : !t.clear ? `The yearly totals of ${F2.y0}\u2013${F2.yb} rise and fall without a clear direction (Mann-Kendall test, p \u2265 0.05).` : `The usual change from one year to the next in ${F2.y0}\u2013${F2.yb} (Sen's slope), over ten years; clear of the year-to-year noise (Mann-Kendall test, p < 0.05). Years before ${vy} are converted from MODIS.`
      )
    );
    $("aKpis").innerHTML = out.join("");
  }
  function drawCharts() {
    const a = A.cur, F2 = A.F;
    if (!a || !F2 || a.st.total === 0) return;
    document.querySelectorAll("#aCalSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === A.cal)));
    const pt = F2.partial, ptW = pt ? `${MONL[pt.m - 1]} ${pt.y}` : "";
    $("aCalNote").textContent = (A.cal === "count" ? "Click a month to show it on the map." : `Each month against a usual one: the median of the same month in ${F2.y0}\u2013${F2.yb}. White is a usual month. Click a month to show it on the map.`) + (pt ? ` ${ptW} runs to the ${ordinal(pt.day1)}: it has a dashed edge${A.cal === "anom" ? " and is left out" : ""}.` + (pt.m < 12 ? ` Later months of ${pt.y} have not happened.` : "") : "");
    const sy2 = A.seasonY, top = a.st.top?.y;
    $("aSeasonT").textContent = sy2 === F2.cy && F2.cy > F2.yb ? `${sy2} so far against a usual year` : `${sy2} against a usual year`;
    $("aSeasonNote").textContent = `Red: ${sy2}. Dashed: a usual month (median of ${F2.y0}\u2013${F2.yb}).` + (top !== void 0 && top !== sy2 ? ` Black: ${top}, the most active year.` : "") + ` Pale grey: every other year.` + (pt && sy2 === pt.y ? ` ${MONL[pt.m - 1]} is left out because it is not over.` : "");
    const t = a.st.trend, tw = trendWords(t);
    $("aTrendT").textContent = tw.title ? `Hotspots per year: ${tw.title}` : "Hotspots per year";
    $("aTrendNote").textContent = `Paler bars, before ${viirsYear()}, are converted from MODIS. ` + (F2.cy > F2.yb ? `The dashed bar is ${F2.cy} so far, to ${lastWords()}, and is not ranked. ` : "") + (t?.clear ? `The dashed line is the trend through ${F2.y0}\u2013${F2.yb}, at a steady rate of change.` : "");
    if (!window.Plot || !window.d3) {
      const k = A.k;
      ["aCal", "aSeason", "aTrend"].forEach((id) => $(id).innerHTML = `<p class="aCap">Drawing\u2026</p>`);
      loadPlotLib().then(
        () => A.k === k && drawCharts(),
        () => ["aCal", "aSeason", "aTrend"].forEach(
          (id) => $(id).innerHTML = `<p class="aCap">The charts did not load (cdnjs or jsdelivr did not answer). The figures above are unaffected.</p>`
        )
      );
      return;
    }
    const cells = calendarCells(F2, a.S, a.st), sc = calendar2($("aCal"), cells, A.cal, A.time.on && A.time.m >= 0 ? { y: A.time.y, m: A.time.m } : null, (c) => pickTime(c.y, c.m));
    $("aCalKey").innerHTML = A.cal === "count" ? sc.max > 0 ? stepped("Hotspots in a month", sc.colours, sc.breaks, sc.max) + `<span class="cpNone"><i></i>none</span>` : "" : `<div class="cpRamp"><span>\xBC of usual</span><i style="background:linear-gradient(90deg,#2166ac,#67a9cf,#d1e5f0,#f7f7f7,#fddbc7,#ef8a62,#b2182b)"></i><span>4\xD7 usual</span></div>`;
    season($("aSeason"), F2, a.S, a.st, sy2, (m) => pickTime(sy2, m));
    trend($("aTrend"), F2, a.S, a.st, viirsYear(), sy2, (y) => pickTime(y, -1));
  }
  function pickTime(y, m) {
    timeOn(y, m);
    if (phone2()) showMapArea();
  }
  function stepped(title, cols, breaks, max) {
    if (!breaks.length)
      return `<div><b>${title}</b><div class="cpKey"><div class="cpStep"><i style="background:${cols[0]}"></i><span>${short(max)}</span></div></div></div>`;
    return `<div><b>${title}</b><div class="cpKey">` + cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${short(max)}</span></div></div></div>`;
  }
  function drawCompare() {
    const F2 = A.F, box2 = document.getElementById("aCmp");
    if (!F2 || !box2) return;
    box2.hidden = !A.pins.length;
    $("aPin").textContent = A.pins.length ? "Pin this one too" : "Pin to compare";
    if (!A.pins.length) return;
    const cur2 = A.cur, curPinned = !!cur2 && A.pins.some((p) => p.shape && cur2.shape ? encode(p.shape) === encode(cur2.shape) : !p.shape && !cur2.shape), rows = A.pins.map((p) => ({
      label: p.letter,
      colour: p.colour,
      dash: ["", "", "5,3", "2,2"][LETTERS.indexOf(p.letter)],
      a: p,
      pin: p
    }));
    if (cur2 && !curPinned) rows.push({ label: "Now", colour: "#8a8478", dash: "1,3", a: cur2, pin: null });
    const ytdH = F2.cy > F2.yb ? `${MON[0]}\u2013${MON[F2.cyLast]} ${F2.cy}` : String(F2.yb);
    $("aCmpT").innerHTML = `<thead><tr><th>Squares</th><th>${ytdH}<small>vs usual</small></th><th>Peak</th><th>Top year</th><th>Trend<small>a decade</small></th></tr></thead>` + rows.map((r) => {
      const st = r.a.st, y = st.ytd, p = y && y.usual > 0 ? (y.cur - y.usual) / y.usual * 100 : null, name = esc5(nameOfArea(r.a));
      return `<tbody><tr class="aCmpA"><td colspan="5"><div class="aCmpH"><span class="aCmpL"><span class="aSw" style="--c:${r.colour}"></span><b>${r.label}</b> <span class="aCmpN" title="${name}">${name}</span></span>` + (r.pin ? `<button type="button" class="cpText aSmallText" data-unpin="${r.pin.letter}" aria-label="Remove ${r.pin.letter}">Remove</button>` : "") + `</div></td></tr><tr><td>${r.a.idx.length}</td><td>${y ? `${fmt(y.cur)}<small>${p == null ? "" : `${p >= 0 ? "+" : "\u2212"}${Math.abs(Math.round(p))}%`}</small>` : "n/a"}</td><td>${st.total > 0 ? MON[st.peak] : "\u2013"}</td><td>${st.top ? st.top.y : "\u2013"}</td><td>${trendWords(st.trend).cell}</td></tr></tbody>`;
    }).join("");
    $("aCmpT").querySelectorAll("[data-unpin]").forEach(
      (b) => b.onclick = () => {
        A.pins = A.pins.filter((p) => p.letter !== b.dataset.unpin);
        writeHash();
        render2();
      }
    );
    $("aCmpNote").textContent = `Squares: how many ${A.g.cell}\xB0 squares with fire on record each area counts. Trend: per decade, ${F2.y0}\u2013${F2.yb}, shown only when it is clear. Share of the year: each month's part of the year's hotspots, the median over ${F2.y0}\u2013${F2.yb}. ` + (cur2 && !curPinned ? `"Now" is the area selected at the moment, not pinned. ` : "") + `The CSV holds every area's months.`;
    drawCompareChart(rows);
  }
  function drawCompareChart(rows) {
    if (!rows) return drawCompare();
    if (!window.Plot) return;
    const share2 = document.querySelector("#aCmpSeg [aria-pressed=true]")?.getAttribute("data-s") === "p";
    $("aCmpCT").textContent = share2 ? "Each month's usual share of the year" : "A usual year in each area";
    compareChart(
      $("aCmpC"),
      rows.map((r) => ({ label: r.label, usual: r.a.st.usual, share: r.a.st.share, colour: r.colour, dash: r.dash })),
      share2
    );
  }
  var sqName = (c) => `${latW(A.g.lat[c], 2)}, ${lonW(A.g.lon[c], 2)}`;
  function drawWatch() {
    for (const m2 of A.markers) m2.remove();
    A.markers = [];
    const map2 = A.map, a = A.cur, F2 = A.F, g = A.g;
    if (map2?.getSource("a-watch")) map2.getSource("a-watch").setData(EMPTY);
    if (!a || !F2 || !g || !document.getElementById("aWM")) {
      drawPins();
      return;
    }
    $("aWatch").hidden = !a.idx.length;
    if (!a.idx.length) {
      drawPins();
      return;
    }
    const m = A.watchM, nextY = (() => {
      const lastM = F2.partial ? F2.partial.m - 1 : F2.cyLast;
      return m > lastM ? F2.cy : F2.cy + 1;
    })();
    const opts = [];
    const startM = ((F2.partial ? F2.partial.m - 1 : F2.cyLast) + 1) % 12;
    for (let k = 0; k < 12; k++) {
      const mm = (startM + k) % 12;
      opts.push(`<option value="${mm}">${MONL[mm]}</option>`);
    }
    $("aWM").innerHTML = opts.join("");
    $("aWM").value = String(m);
    $("aWOn").checked = A.watchOn;
    const years = watchYears(F2, m), est = [];
    for (let k = 0; k < a.idx.length; k++) {
      const c = a.idx[k], S3 = g.v.subarray(c * g.nm, (c + 1) * g.nm);
      est.push({ c, e: estimate(F2, S3, m, years) });
    }
    est.sort((x, z) => z.e.expected - x.e.expected);
    const total2 = est.reduce((s2, r) => s2 + r.e.expected, 0), areaE = estimate(F2, a.S, m, years);
    let cum = 0;
    const ranked = est.map((r) => {
      const w = total2 > 0 && r.e.expected >= 1 && cum < total2 * 0.5 ? "high" : total2 > 0 && r.e.expected >= 1 && cum < total2 * 0.8 ? "elevated" : "low";
      cum += r.e.expected;
      return { ...r, w };
    });
    const top = ranked.filter((r) => r.e.expected >= 1).slice(0, 10), high = ranked.filter((r) => r.w === "high"), nHigh = high.length, highPc = total2 > 0 ? Math.round(high.reduce((t, r) => t + r.e.expected, 0) / total2 * 100) : 0, yw = `${years[0]}\u2013${years[years.length - 1]}`;
    $("aWSub").textContent = areaE.expected >= 0.5 ? `About ${nHot2(areaE.expected)} expected in this area in ${MONL[m]} ${nextY}; ${areaE.vals.length >= 10 ? "six" : "most"} of the last ${areaE.vals.length === 10 ? "ten" : areaE.vals.length} ${MONL[m]}s had between ${fmt(areaE.lo)} and ${fmt(areaE.hi)}.` + (nHigh ? ` Square by square the estimates add up to about ${fmt(total2)}; ${nHigh} of the ${a.idx.length} squares ${nHigh === 1 ? "holds" : "hold"} ${highPc}% of that.` : top.length ? "" : ` No single square expects one hotspot or more: the fire moves around from year to year.`) : `${MONL[m]} is usually quiet here: under one hotspot expected in ${MONL[m]} ${nextY}.`;
    $("aWList").innerHTML = top.length ? top.map(
      (r, i) => `<li><button type="button" data-c="${r.c}"><span class="aWRank">${i + 1}</span><span class="aWPlace">${sqName(r.c)}<small>${r.e.active} of ${r.e.vals.length} ${MONL[m]}s had fire${r.e.recent > r.e.med * 1.25 && r.e.recent >= 1 ? "; more lately" : r.e.recent < r.e.med * 0.75 ? "; less lately" : ""}</small></span><span class="aWN" title="Six of the last ten ${MONL[m]}s had between ${fmt(r.e.lo)} and ${fmt(r.e.hi)}">~${fmt(r.e.expected)}<small>${fmt(r.e.lo)}\u2013${fmt(r.e.hi)}</small></span><span class="aWLv ${r.w}">${r.w === "high" ? "High" : r.w === "elevated" ? "Raised" : "Low"}</span></button></li>`
    ).join("") : "";
    $("aWList").querySelectorAll("[data-c]").forEach((b) => b.onclick = () => flyToCell(+b.dataset.c));
    $("aWFoot").textContent = `An estimate from history only: for each square, 60% the median of the ${MONL[m]}s of ${yw} and 40% the average of the last three. It ignores weather, drought and fuel, so read it as where fire usually is in ${MONL[m]}, not a forecast. Each square is estimated on its own, and fire that moves around from year to year leaves most squares at zero, so the squares' estimates add up to less than the area's. Listed: squares that expect at least one hotspot. High: the top squares until they hold half of the squares' estimates; Raised: on to 80%.`;
    if (A.watchOn && map2 && top.length) {
      const ml = window.maplibregl;
      const feats = top.map((r) => cellFeature(r.c, { r: 0 }));
      map2.getSource("a-watch")?.setData({ type: "FeatureCollection", features: feats });
      top.forEach((r, i) => {
        const el = document.createElement("div");
        el.className = "aMark aMarkW";
        el.textContent = String(i + 1);
        el.title = `${i + 1}. ${sqName(r.c)}: about ${fmt(r.e.expected)} in ${MONL[m]}`;
        A.markers.push(new ml.Marker({ element: el }).setLngLat([near(g.lon[r.c], A.lon0), g.lat[r.c]]).addTo(map2));
      });
    }
    drawPins();
  }
  function flyToCell(c) {
    const g = A.g, map2 = A.map;
    if (!map2) return;
    const x = near(g.lon[c], A.lon0), y = g.lat[c], h2 = g.cell * 2.5;
    map2.fitBounds(
      [
        [x - h2, y - h2],
        [x + h2, y + h2]
      ],
      { padding: 30, duration: 700, maxZoom: 9 }
    );
    if (phone2()) showMapArea();
  }
  async function share() {
    writeHash();
    const url = location.href.split("#")[0] + hashFor(), msg = $("aMsg");
    try {
      await navigator.clipboard.writeText(url);
      msg.textContent = "Link copied. It opens this country with this area" + (A.pins.length ? " and the pinned ones." : ".");
    } catch {
      msg.innerHTML = `Copy this link: <input class="aLink" readonly value="${esc5(url)}">`;
      const i = msg.querySelector("input");
      i?.focus();
      i?.select();
    }
  }
  function csv() {
    const F2 = A.F, cur2 = A.cur;
    if (!F2 || !cur2 || !A.d) return;
    const areas = A.pins.map((p) => ({ label: p.letter, a: p }));
    if (!A.pins.some((p) => p === cur2 || p.shape && cur2.shape && encode(p.shape) === encode(cur2.shape) || !p.shape && !cur2.shape))
      areas.unshift({ label: "selected", a: cur2 });
    const d = A.d, vi0 = (d.viirs_from[0] - F2.y0) * 12 + d.viirs_from[1] - 1, aq0 = (d.aqua_from[0] - F2.y0) * 12 + d.aqua_from[1] - 1, filled = /* @__PURE__ */ new Set([...(d.y2026?.conv_months ?? []).map((c) => c.i), ...(d.y2026?.hist_gaps ?? []).map((g) => g.i)]), src = (i) => filled.has(i) ? FILL_SRC : i >= vi0 ? "VIIRS observed" : i < aq0 ? "MODIS Terra, converted" : "MODIS Terra+Aqua, converted", rows = [`area,shape,squares,square_deg,year,month,month_status,harmonized_viirs_snpp_equivalent,source,usual_median_${F2.y0}_${F2.yb}`];
    for (const { label, a } of areas) {
      const sh = a.shape ? encode(a.shape) : "whole_country";
      for (let i = 0; i < F2.nm; i++) {
        const y = F2.y0 + Math.floor(i / 12), m = i % 12, part = F2.partial && i === F2.partial.i;
        rows.push(
          [
            label,
            `"${sh}"`,
            a.idx.length,
            A.g.cell,
            y,
            m + 1,
            part ? `partial_to_day_${F2.partial.day1}` : "complete",
            a.S[i].toFixed(1),
            `"${src(i)}"`,
            /* a month not over has no like-for-like usual */
            part ? "" : a.st.usual[m].toFixed(1)
          ].join(",")
        );
      }
    }
    save(`burn-calendar_${A.d.country}_areas.csv`, rows.join("\n"), $("aMsg"));
  }
  function prefillCoords() {
    const s2 = A.cur?.shape, set = (id, v) => $(id).value = String(Number(v.toFixed(3)));
    if (s2?.t === "r") {
      $("aCShape").value = "r";
      set("aCs", s2.s);
      set("aCw", near(s2.w, 0));
      set("aCn", s2.n);
      set("aCe", near(s2.w, 0) + (s2.e - s2.w));
    } else if (s2?.t === "c") {
      $("aCShape").value = "c";
      set("aClat", s2.lat);
      set("aClon", near(s2.lon, 0));
      set("aCkm", s2.km);
    }
    $("aCShape").onchange(new Event("change"));
  }
  function coordsSubmit() {
    const v = (id) => {
      const t = $(id).value.trim();
      return t === "" ? NaN : Number(t);
    }, msg = $("aCMsg");
    let s2 = null;
    if ($("aCShape").value === "r") {
      const so = v("aCs"), w = v("aCw"), n = v("aCn");
      let e = v("aCe");
      if (![so, w, n, e].every(Number.isFinite)) return void (msg.textContent = "Fill in all four edges, in degrees.");
      if (Math.abs(so) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180)
        return void (msg.textContent = "Latitudes run from -90 to 90 and longitudes from -180 to 180.");
      if (n <= so) return void (msg.textContent = "North must be above south.");
      if (e <= w) e += 360;
      if (e - w > 180)
        return void (msg.textContent = "That box is over 180\xB0 wide. West is the left edge: for a box across 180\xB0, give West 170 and East -170, for example.");
      s2 = { t: "r", s: so, w, n, e };
    } else {
      const lat = v("aClat"), lon = v("aClon"), r = v("aCkm");
      if (![lat, lon, r].every(Number.isFinite)) return void (msg.textContent = "Fill in the centre and the radius.");
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180)
        return void (msg.textContent = "Latitudes run from -90 to 90 and longitudes from -180 to 180.");
      if (r < 5 || r > 3e3) return void (msg.textContent = "Give a radius between 5 and 3,000 km.");
      s2 = { t: "c", lat, lon, km: r };
    }
    msg.textContent = "";
    setArea(s2, true);
  }
  var EMPTY = { type: "FeatureCollection", features: [] };
  function cellFeature(c, props) {
    const g = A.g, w = near(g.lon[c], A.lon0) - g.cell / 2, s2 = g.s[c], e = w + g.cell, n = s2 + g.cell;
    return {
      type: "Feature",
      id: c,
      properties: { ...props, c },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [w, s2],
            [e, s2],
            [e, n],
            [w, n],
            [w, s2]
          ]
        ]
      }
    };
  }
  var poly = (r, props = {}) => ({
    type: "Feature",
    properties: props,
    geometry: { type: "Polygon", coordinates: [r] }
  });
  onMapReady((map2) => {
    if (!A.k) return;
    A.map = map2;
    const under = map2.getLayer("cells-hover") ? "cells-hover" : void 0;
    for (const id of ["a-time", "a-sel", "a-shape", "a-pins", "a-draft", "a-watch"]) map2.addSource(id, { type: "geojson", data: EMPTY });
    map2.addLayer(
      {
        id: "a-time",
        type: "fill",
        source: "a-time",
        layout: { visibility: "none" },
        filter: [">", ["get", "v"], 0],
        paint: { "fill-color": FIRE[3], "fill-opacity": 0.9, "fill-antialias": false }
      },
      under
    );
    map2.addLayer(
      {
        id: "a-time-edge",
        type: "line",
        source: "a-time",
        layout: { visibility: "none" },
        filter: [">", ["get", "v"], 0],
        paint: { "line-color": FIRE[3], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 7, 0.8, 9, 0] }
      },
      under
    );
    map2.addLayer({ id: "a-sel", type: "line", source: "a-sel", paint: { "line-color": "#1b1b1b", "line-width": 0.7, "line-opacity": 0.55 } });
    map2.addLayer({ id: "a-shape-fill", type: "fill", source: "a-shape", paint: { "fill-color": "#1b1b1b", "fill-opacity": 0.05 } });
    map2.addLayer({ id: "a-shape", type: "line", source: "a-shape", paint: { "line-color": "#1b1b1b", "line-width": 2 } });
    map2.addLayer({
      id: "a-pins",
      type: "line",
      source: "a-pins",
      paint: { "line-color": ["get", "c"], "line-width": 2, "line-dasharray": [3, 2] }
    });
    map2.addLayer({
      id: "a-draft",
      type: "line",
      source: "a-draft",
      paint: { "line-color": "#1b1b1b", "line-width": 2, "line-dasharray": [2, 1.5] }
    });
    map2.addLayer({ id: "a-watch", type: "line", source: "a-watch", paint: { "line-color": "#bd0026", "line-width": 2.5 } });
    const ml = window.maplibregl;
    A.popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", className: "cpPop", offset: 8 });
    map2.on("mousemove", "a-time", (e) => {
      const f = e.features && e.features[0];
      if (!f || A.tool) return;
      const c = f.properties.c;
      A.popup.setLngLat(e.lngLat).setHTML(`<b>${nHot2(f.properties.v)}</b><span>in ${timeWords()}</span><span class="pos">Square around ${esc5(sqName(c))}</span>`).addTo(map2);
    });
    map2.on("mouseleave", "a-time", () => A.popup.remove());
    wireDrawing(map2);
    map2.getContainer()._areas = A;
    drawShapes();
    drawWatch();
    if (A.time.on) timeOn(A.time.y, A.time.m);
    const s2 = A.cur?.shape;
    if (s2 && parseHash()?.area) fitTo(s2);
  });
  function drawShapes() {
    const map2 = A.map;
    if (!map2?.getSource("a-shape")) return;
    const s2 = A.cur?.shape;
    map2.getSource("a-shape").setData(s2 ? { type: "FeatureCollection", features: [poly(ring(s2, A.lon0))] } : EMPTY);
    map2.getSource("a-sel").setData(s2 && A.g && A.cur ? { type: "FeatureCollection", features: Array.from(A.cur.idx, (c) => cellFeature(c, {})) } : EMPTY);
    drawPins();
  }
  function drawPins() {
    const map2 = A.map;
    if (!map2?.getSource("a-pins")) return;
    for (const m of A.pinMarks) m.remove();
    A.pinMarks = [];
    const ps = A.pins.filter((p) => p.shape);
    map2.getSource("a-pins").setData({ type: "FeatureCollection", features: ps.map((p) => poly(ring(p.shape, A.lon0), { c: p.colour })) });
    const ml = window.maplibregl;
    for (const p of ps) {
      const b = bbox(p.shape), el = document.createElement("div");
      el.className = "aMark aMarkP";
      el.style.setProperty("--c", p.colour);
      el.textContent = p.letter;
      A.pinMarks.push(
        new ml.Marker({ element: el, anchor: "bottom-left" }).setLngLat([b[0] + near(midLon(p.shape), A.lon0) - midLon(p.shape), b[3]]).addTo(map2)
      );
    }
  }
  function fitTo(s2) {
    const map2 = A.map;
    if (!map2) return;
    let b = bbox(s2), off = near(midLon(s2), A.lon0) - midLon(s2);
    const cur2 = A.cur;
    if (b[2] - b[0] > 300 && cur2?.shape === s2 && cur2.idx.length && A.g) {
      const g = A.g, xs = Array.from(cur2.idx, (c) => near(g.lon[c], A.lon0)), ys = Array.from(cur2.idx, (c) => g.lat[c]);
      b = [
        Math.min(...xs) - g.cell / 2,
        Math.min(...ys) - g.cell / 2,
        Math.max(...xs) + g.cell / 2,
        Math.min(85, Math.max(...ys) + g.cell / 2)
      ];
      off = 0;
    }
    map2.fitBounds(
      [
        [b[0] + off, b[1]],
        [b[2] + off, b[3]]
      ],
      { padding: phone2() ? 24 : 48, duration: 600, maxZoom: 9 }
    );
  }
  var timeClasses = null;
  var PROBS2 = [0.25, 0.45, 0.62, 0.76, 0.87, 0.95];
  function classesFor(year) {
    const g = A.g, key = `${g.country}|${year}`;
    if (timeClasses?.key === key) return timeClasses.breaks;
    let vals;
    if (!year) vals = g.v.filter((v) => v > 0);
    else {
      const ny = Math.ceil(g.nm / 12), t = new Float32Array(g.n * ny);
      for (let c = 0; c < g.n; c++) for (let i = 0; i < g.nm; i++) t[c * ny + Math.floor(i / 12)] += g.v[c * g.nm + i];
      vals = t.filter((v) => v > 0);
    }
    vals.sort();
    const out = [];
    if (vals.length) {
      const max = vals[vals.length - 1], min = vals[0];
      for (const q of PROBS2) {
        const b = nice(vals[Math.floor(q * (vals.length - 1))]);
        if (b > (out.length ? out[out.length - 1] : min) && b < max) out.push(b);
      }
    }
    timeClasses = { key, breaks: out };
    return out;
  }
  var timeWords = () => {
    const F2 = A.F, { y, m } = A.time;
    if (m < 0) return F2.cy > F2.yb && y === F2.cy ? `${y}, to ${lastWords()}` : String(y);
    return F2.partial && (y - F2.y0) * 12 + m === F2.partial.i ? `1\u2013${F2.partial.day1} ${MONL[m]} ${y} (not over)` : `${MONL[m]} ${y}`;
  };
  function fillTimeSelects() {
    const F2 = A.F, yo = [];
    for (let y = F2.y0 + Math.floor((F2.nm - 1) / 12); y >= F2.y0; y--) yo.push(`<option value="${y}">${y}</option>`);
    $("aTY").innerHTML = yo.join("");
    $("aTM").innerHTML = `<option value="-1">Whole year</option>` + MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  }
  function timeOn(y, m) {
    const F2 = A.F;
    if (!F2) {
      A.time = { on: true, y, m };
      syncBar();
      return;
    }
    if (m >= 0 && idxOf(F2, y, m) >= F2.nm) m = (F2.nm - 1) % 12;
    A.time = { on: true, y, m };
    syncBar();
    $("aTY").value = String(y);
    $("aTM").value = String(m);
    drawTime();
    if (A.cur && window.Plot && A.cur.st.total > 0) {
      const cells = calendarCells(F2, A.cur.S, A.cur.st);
      calendar2($("aCal"), cells, A.cal, m >= 0 ? { y, m } : null, (c) => pickTime(c.y, c.m));
    }
  }
  function drawTime() {
    const map2 = A.map, g = A.g, F2 = A.F;
    if (!g || !F2) return;
    const { y, m } = A.time, ty = document.getElementById("aTY"), tm = document.getElementById("aTM");
    if (ty && ty.value !== String(y)) ty.value = String(y);
    if (tm && tm.value !== String(m)) tm.value = String(m);
    const breaks = classesFor(m < 0), cols = classColours(breaks), feats = [];
    let shown2 = 0;
    for (let c = 0; c < g.n; c++) {
      let v = 0;
      if (m >= 0) v = g.v[c * g.nm + idxOf(F2, y, m)];
      else for (let i = idxOf(F2, y, 0); i < Math.min(F2.nm, idxOf(F2, y, 12)); i++) v += g.v[c * g.nm + i];
      if (v > 0) {
        feats.push(cellFeature(c, { v }));
        shown2++;
      }
    }
    $("aTKey").innerHTML = `<span class="aTWhen">${esc5(timeWords())}: ${shown2} square${shown2 === 1 ? "" : "s"} with fire</span><div class="cpKey aTSteps">${cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`).join("")}</div>`;
    if (!map2?.getSource("a-time")) return;
    map2.getSource("a-time").setData({ type: "FeatureCollection", features: feats });
    const expr = breaks.length ? ["step", ["get", "v"], cols[0]] : [cols[0]];
    if (breaks.length) breaks.forEach((b, i) => expr.push(b, cols[i + 1]));
    const paint = breaks.length ? expr : cols[0];
    map2.setPaintProperty("a-time", "fill-color", paint);
    map2.setPaintProperty("a-time-edge", "line-color", paint);
    for (const id of ["a-time", "a-time-edge"]) map2.setLayoutProperty(id, "visibility", "visible");
    for (const id of ["cells", "cells-edge", "cells-hover"]) if (map2.getLayer(id)) map2.setLayoutProperty(id, "visibility", "none");
  }
  function timeOff() {
    stopPlay2();
    A.time.on = false;
    syncBar();
    const map2 = A.map;
    if (map2?.getLayer("a-time")) {
      for (const id of ["a-time", "a-time-edge"]) map2.setLayoutProperty(id, "visibility", "none");
      for (const id of ["cells", "cells-edge", "cells-hover"]) if (map2.getLayer(id)) map2.setLayoutProperty(id, "visibility", "visible");
      A.popup?.remove();
    }
    if (A.cur && A.F && window.Plot && A.cur.st.total > 0)
      calendar2($("aCal"), calendarCells(A.F, A.cur.S, A.cur.st), A.cal, null, (c) => pickTime(c.y, c.m));
  }
  function play() {
    const F2 = A.F;
    if (!F2) return;
    if (!A.time.on) timeOn(A.time.y, A.time.m);
    const last = F2.nm - 1, atEnd = A.time.m < 0 ? A.time.y >= F2.y0 + Math.floor(last / 12) : idxOf(F2, A.time.y, A.time.m) >= last;
    if (atEnd) timeOn(F2.y0, A.time.m < 0 ? -1 : 0);
    $("aPlay").textContent = "Pause";
    $("aPlay").setAttribute("aria-pressed", "true");
    playTimer = window.setInterval(
      () => {
        let { y, m } = A.time;
        if (m < 0) y++;
        else if (++m > 11) {
          m = 0;
          y++;
        }
        const i = m < 0 ? (y - F2.y0) * 12 : idxOf(F2, y, m);
        if (i > last) return stopPlay2();
        timeOn(y, m);
      },
      A.time.m < 0 ? 900 : 550
    );
  }
  function stopPlay2() {
    if (playTimer) clearInterval(playTimer);
    playTimer = void 0;
    const b = document.getElementById("aPlay");
    if (b) {
      b.textContent = "Play";
      b.setAttribute("aria-pressed", "false");
    }
  }
  var MAX_KM = 3e3;
  var HINTS = {
    rect: "Drag on the map to draw a box. Esc to cancel.",
    circle: `Press on the centre and drag out to the radius, up to ${MAX_KM.toLocaleString("en-US")} km. Esc to cancel.`,
    poly: "Hold and draw around the area; let go to close the shape. Esc to cancel."
  };
  function arm(t) {
    if (A.tool === t) return disarm();
    openTools();
    $("aCoords").hidden = true;
    $("aCoordBtn").setAttribute("aria-expanded", "false");
    A.tool = t;
    syncBar();
    hint(A.map ? HINTS[t] : "The map is still loading; try again in a moment.");
    const map2 = A.map;
    if (!map2) {
      A.tool = null;
      syncBar();
      return;
    }
    map2.dragPan.disable();
    map2.boxZoom.disable();
    map2.doubleClickZoom.disable();
    map2.touchZoomRotate.disable();
    map2.getCanvasContainer().classList.add("aDrawing");
    A.popup?.remove();
    hideCellPopup();
    if (phone2()) showMapArea();
  }
  function disarm() {
    if (!A.tool) return;
    A.tool = null;
    syncBar();
    hint("");
    const map2 = A.map;
    if (!map2) return;
    map2.dragPan.enable();
    map2.boxZoom.enable();
    map2.doubleClickZoom.enable();
    map2.touchZoomRotate.enable();
    map2.touchZoomRotate.disableRotation();
    map2.getCanvasContainer().classList.remove("aDrawing");
    map2.getSource("a-draft")?.setData(EMPTY);
  }
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && A.tool) disarm();
  });
  function wireDrawing(map2) {
    const box2 = map2.getCanvasContainer();
    let start4 = null, pts2 = [], lastPx = [0, 0], id = -1, endedAt = 0;
    const at = (e) => {
      const r = box2.getBoundingClientRect(), p = map2.unproject([e.clientX - r.left, e.clientY - r.top]);
      return [p.lng, p.lat];
    };
    const draft = (s2, line) => {
      const src = map2.getSource("a-draft");
      if (!src) return;
      if (line) src.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
      else src.setData(s2 ? poly(ring(s2, A.lon0)) : EMPTY);
    };
    const shapeFrom = (a, b) => {
      if (A.tool === "rect")
        return { t: "r", s: Math.min(a[1], b[1]), n: Math.max(a[1], b[1]), w: Math.min(a[0], b[0]), e: Math.max(a[0], b[0]) };
      if (A.tool === "circle") return { t: "c", lat: a[1], lon: a[0], km: Math.min(MAX_KM, km(a[1], a[0], b[1], b[0])) };
      return null;
    };
    box2.addEventListener(
      "pointerdown",
      (e) => {
        if (!A.tool || e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        box2.setPointerCapture(e.pointerId);
        id = e.pointerId;
        start4 = at(e);
        pts2 = [start4];
        lastPx = [e.clientX, e.clientY];
      },
      true
    );
    box2.addEventListener(
      "pointermove",
      (e) => {
        if (!A.tool || !start4 || e.pointerId !== id) return;
        e.preventDefault();
        const p = at(e);
        if (A.tool === "poly") {
          if (Math.hypot(e.clientX - lastPx[0], e.clientY - lastPx[1]) < 4) return;
          lastPx = [e.clientX, e.clientY];
          pts2.push(p);
          draft(null, pts2);
        } else draft(shapeFrom(start4, p));
      },
      true
    );
    const end = (e) => {
      if (!A.tool || !start4 || e.pointerId !== id) return;
      e.preventDefault();
      const p = at(e), tool = A.tool, a = start4;
      start4 = null;
      id = -1;
      let s2 = null;
      if (tool === "poly") {
        pts2.push(p);
        const b = pts2.reduce(
          (r, q) => [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[0]), Math.max(r[3], q[1])],
          [Infinity, Infinity, -Infinity, -Infinity]
        );
        const simple = simplify(pts2, Math.max(b[2] - b[0], b[3] - b[1]) / 200, 80);
        if (simple.length >= 3) s2 = { t: "p", pts: simple };
      } else s2 = shapeFrom(a, p);
      const small = !s2 || (s2.t === "c" ? s2.km < 5 : areaKm22(s2) < 25);
      if (small) {
        draft(null);
        hint(`That was too small to count. ${HINTS[tool]}`);
        return;
      }
      s2 = normalise(s2);
      endedAt = performance.now();
      disarm();
      draft(null);
      hideCellPopup();
      setArea(s2);
      if (s2.t === "c" && s2.km >= MAX_KM) hint(`Circles stop at ${MAX_KM.toLocaleString("en-US")} km.`);
    };
    box2.addEventListener("pointerup", end, true);
    box2.addEventListener(
      "click",
      (e) => {
        if (A.tool || performance.now() - endedAt < 500) {
          e.stopImmediatePropagation();
          e.stopPropagation();
        }
      },
      true
    );
    box2.addEventListener(
      "pointercancel",
      (e) => {
        if (e.pointerId !== id) return;
        start4 = null;
        id = -1;
        draft(null);
      },
      true
    );
  }
  function normalise(s2) {
    const off = near(midLon(s2), 0) - midLon(s2);
    if (!off) return s2;
    if (s2.t === "r") return { ...s2, w: s2.w + off, e: s2.e + off };
    if (s2.t === "c") return { ...s2, lon: s2.lon + off };
    return { t: "p", pts: s2.pts.map(([x, y]) => [x + off, y]) };
  }
  var rt;
  var lastW = 0;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = window.setTimeout(() => {
      const p = document.getElementById("aPanel");
      if (!A.open || !p || p.hidden) return;
      const w = p.clientWidth;
      if (w === lastW) return;
      lastW = w;
      drawCharts();
      drawCompare();
    }, 150);
  });
  var COPILOT_MONTHS = 323;
  function areaForCopilot() {
    const a = A.cur, F2 = A.F;
    if (!A.open || !a || !a.shape || !F2 || !A.d || !(a.st.total > 0)) return null;
    const off = (F2.y0 - 2e3) * 12, series = new Array(COPILOT_MONTHS).fill(0);
    for (let i = 0; i < a.S.length; i++) if (i + off >= 0 && i + off < COPILOT_MONTHS) series[i + off] = Math.round(a.S[i] * 10) / 10;
    const r23 = (v) => Math.round(v * 100) / 100, [w, so, e, n] = bbox(a.shape);
    return { name: `${describe(a.shape)} in ${theName(A.d.name)}`, bbox: [r23(w), r23(so), r23(e), r23(n)], series };
  }

  // src/minimap.ts
  var S2 = 10;
  var MAX_H = 440;
  var DENSE = 800;
  var MARK_GAP = 16;
  var NARROW = 500;
  var MAX_NARROW_MARKS = 5;
  var r1 = (v) => Math.round(v * 100) / 100;
  var esc6 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var coarse = () => matchMedia("(pointer: coarse)").matches;
  var FRAMES = /* @__PURE__ */ new WeakMap();
  var keyOf = (la, lo) => (la + 4e3) * 2e4 + (lo + 8e3);
  function frameOf2(d) {
    const had = FRAMES.get(d);
    if (had) return had;
    const { la, lo } = cellIndexes(d), lon02 = centreLon(d, lo), md = mapData(d, d.y0, d.y1), area = (b) => Math.max(1e-6, (b[2] - b[0]) * (b[3] - b[1])), bounds = area(md.all) > 4 * area(md.bounds) ? md.bounds : md.all, kx = Math.max(0.2, Math.cos((bounds[1] + bounds[3]) / 2 * Math.PI / 180)), key = /* @__PURE__ */ new Map();
    for (let c = 0; c < la.length; c++) key.set(keyOf(la[c], lo[c]), c);
    const f = { la, lo, lon0: lon02, kx, bounds, key };
    FRAMES.set(d, f);
    return f;
  }
  function cellCentre(d, c) {
    const f = frameOf2(d);
    return [(f.la[c] + 0.5) * d.cell, near((f.lo[c] + 0.5) * d.cell, 0)];
  }
  function drawMini(host, d, o) {
    const F2 = frameOf2(d), cell = d.cell, X = (lonU) => (lonU - F2.lon0) * F2.kx * S2, Y = (lat) => -lat * S2, west = (c) => near(F2.lo[c] * cell + cell / 2, F2.lon0) - cell / 2;
    let [x0, y0, x1, y1] = [X(F2.bounds[0]), Y(F2.bounds[3]), X(F2.bounds[2]), Y(F2.bounds[1])];
    for (const m of o.marks || []) {
      const w = west(m.c), s2 = F2.la[m.c] * cell;
      x0 = Math.min(x0, X(w));
      x1 = Math.max(x1, X(w + cell));
      y0 = Math.min(y0, Y(s2 + cell));
      y1 = Math.max(y1, Y(s2));
    }
    const pad2 = 0.04 * Math.max(x1 - x0, y1 - y0) + 2;
    x0 -= pad2;
    x1 += pad2;
    y0 -= pad2;
    y1 += pad2;
    const vw = x1 - x0, vh = y1 - y0;
    const shape = shapeOf(d.country);
    let land = "", lines2 = "";
    if (shape)
      for (const r of shape.r) {
        const off = near(r[0], F2.lon0) - r[0];
        land += "M";
        for (let i = 0; i < r.length; i += 2) land += `${r1(X(r[i] + off))},${r1(Y(r[i + 1]))} `;
        land += "Z";
        for (let i = 0; i + 3 < r.length; i += 2) {
          if (cutEdge(d.country, r[i], r[i + 1], r[i + 2], r[i + 3])) continue;
          lines2 += `M${r1(X(r[i] + off))},${r1(Y(r[i + 1]))}L${r1(X(r[i + 2] + off))},${r1(Y(r[i + 3]))}`;
        }
      }
    const maxW = Math.max(160, Math.round(MAX_H * vw / vh)), boxW = Math.min(maxW, host.clientWidth > 40 ? host.clientWidth - 16 : maxW), boxH = boxW * vh / vw;
    const cw = r1(cell * F2.kx * S2), ch = r1(cell * S2), cellPx = cell * F2.kx * S2 * boxW / vw, pts2 = o.points || [], dense = pts2.length > DENSE, paint = (ls) => ls.filter((l) => l.cells.length).map((l) => {
      let p = "";
      for (const c of l.cells) p += `M${r1(X(west(c)))},${r1(Y(F2.la[c] * cell + cell))}h${cw}v${ch}h${-cw}z`;
      return `<path d="${p}" fill="${l.fill}"${l.edge ? ` stroke="${l.fill}" stroke-width="1.6" vector-effect="non-scaling-stroke"` : ""}/>`;
    }).join("");
    let dots = "";
    for (const [lon, lat] of pts2) dots += `M${r1(X(near(lon, F2.lon0)))},${r1(Y(lat))}h0`;
    const narrow = innerWidth < NARROW, placed = [], folded = [], cut = [];
    for (const [i, m] of (o.marks || []).entries()) {
      const x = (X(west(m.c) + cell / 2) - x0) / vw, y = (Y(F2.la[m.c] * cell + cell / 2) - y0) / vh;
      if (narrow && i >= MAX_NARROW_MARKS && !m.keep) {
        cut.push(m.label);
        continue;
      }
      const under = placed.find((q) => Math.hypot((q.x - x) * boxW, (q.y - y) * boxH) < MARK_GAP);
      if (under) {
        under.more.push(m.label);
        folded.push(m.label);
      } else placed.push({ x, y, m, more: [] });
    }
    host.innerHTML = `<div class="cpMiniBox" style="max-width:min(100%,${maxW}px)"><svg viewBox="${r1(x0)} ${r1(y0)} ${r1(vw)} ${r1(vh)}" role="img" aria-label="${esc6(o.label)}"><path d="${land}" fill="#ebe8e1" fill-rule="evenodd"/>` + paint(o.layers.filter((l) => !(dense && l.over))) + `<path d="${lines2}" fill="none" stroke="#1b1b1b" stroke-opacity=".7" stroke-width="1" vector-effect="non-scaling-stroke"/>` + (dots ? dense ? `<path d="${dots}" fill="none" stroke="#1b1b1b" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : `<path d="${dots}" fill="none" stroke="#fffefa" stroke-width="4.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${dots}" fill="none" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : "") + (dense ? paint(o.layers.filter((l) => l.over)) : "") + `<rect class="cpMiniOn" width="${cw}" height="${ch}" fill="none" stroke="#1b1b1b" stroke-width="2" vector-effect="non-scaling-stroke" visibility="hidden"/></svg>` + /* the first mark last, so it is drawn on top */
    placed.slice().reverse().map(
      ({ x, y, m, more }) => `<span class="cpMiniMark${m.muted ? " muted" : ""}" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%" title="${esc6(m.title + (more.length ? `; also here: ${more.join(", ")}` : ""))}">${esc6(m.label)}${more.length ? `<i>+${more.length}</i>` : ""}</span>`
    ).join("") + `</div>`;
    const svg = host.querySelector("svg"), on = svg.querySelector(".cpMiniOn");
    o.caption.innerHTML = o.idle;
    const at = (e) => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()), lon = near(p.x / (F2.kx * S2) + F2.lon0, 0), lat = -p.y / S2;
      return F2.key.get(keyOf(Math.floor(lat / cell), Math.floor(lon / cell))) ?? null;
    };
    let shown2 = null;
    const show = (e) => {
      const c = at(e), text2 = c == null ? null : o.pick(c);
      if (c === shown2) return;
      if (c == null || text2 == null) {
        if (e.type === "click" || !coarse()) {
          shown2 = null;
          on.setAttribute("visibility", "hidden");
          o.caption.innerHTML = o.idle;
        }
        return;
      }
      shown2 = c;
      on.setAttribute("x", String(r1(X(west(c)))));
      on.setAttribute("y", String(r1(Y(F2.la[c] * cell + cell))));
      on.setAttribute("visibility", "visible");
      o.caption.innerHTML = text2;
    };
    svg.onpointermove = show;
    svg.onclick = show;
    svg.onpointerleave = () => {
      if (coarse()) return;
      shown2 = null;
      on.setAttribute("visibility", "hidden");
      o.caption.innerHTML = o.idle;
    };
    return { aspect: vw / vh, folded, cut, cellPx };
  }

  // src/cfore.ts
  var num2 = (x) => typeof x === "number" && Number.isFinite(x);
  var numOrNull = (x) => x === null || num2(x);
  function isForecast(x, k) {
    if (!isObj(x) || x.v !== 1 || x.country !== k || typeof x.name !== "string") return false;
    const mo = x.month, h2 = x.hist, yr = x.year, me = x.metrics;
    if (!isObj(mo) || !["mean", "lo", "med", "hi", "p_any", "p_above"].every((s2) => isNums(mo[s2], 24))) return false;
    if (!isObj(h2) || !["median", "mean", "p_any"].every((s2) => isNums(h2[s2], 12)) || !num2(h2.annual_mean) || !num2(h2.y2025)) return false;
    if (!isObj(yr) || !["2026", "2027"].every((y) => isObj(yr[y]) && num2(yr[y].mean) && num2(yr[y].trend_factor))) return false;
    if (!isObj(me) || !isObj(me.month) || !(me.cell === null || isObj(me.cell))) return false;
    const mm = me.month, mc = me.cell;
    return numOrNull(mm.crps_skill) && ["brier_above", "brier_above_base", "cover80", "cover80_base"].every((s2) => num2(mm[s2])) && (mc === null || numOrNull(mc.auc) && numOrNull(mc.auc_base) && ["cell_years", "rate", "mae", "mae_base"].every((s2) => num2(mc[s2]))) && num2(x.cell) && num2(x.ncell) && isNums(x.cell_rows) && x.cell_rows.length % 4 === 0 && typeof x.same_2027 === "boolean" && typeof x.verdict === "string" && typeof x.method === "string";
  }
  var TYPICAL_GAIN = "about 3%";
  var COUNTRIES_SCORED = 234;
  var SKILL_MIN = 0.02;
  var NOT_FIRE2 = {
    Iceland: "Most hotspots in Iceland are lava from eruptions, which no fire record can forecast.",
    Antarctica: "Antarctica has almost no vegetation, so its hotspots are likely volcanic heat (Mount Erebus has a lava lake) or heat from stations, not fire."
  };
  var P_BREAKS = [0.1, 0.25, 0.5, 0.75, 0.9];
  var MIN_POSITIVES = 20;
  var esc7 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var pc = (p) => p > 0.99 && p < 1 ? "over 99%" : p > 0 && p < 0.01 ? "under 1%" : Math.round(p * 100) + "%";
  var signed2 = (x) => {
    const v = Math.abs(x * 100);
    return `${x > 0 ? "+" : x < 0 ? "\u2212" : ""}${v < 1 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
  };
  var size = (x) => {
    const v = Math.abs(x * 100);
    return v > 0 && v < 1 ? "less than 1%" : `${Math.round(v)}%`;
  };
  var deg4 = (v, p, n, dp) => `${Math.abs(v).toFixed(dp)}\xB0${v < 0 ? n : p}`;
  var nHot3 = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  var about = (x) => {
    if (x === 0) return "0";
    if (x < 1) return "fewer than 1";
    if (x < 1e3) return fmt(Math.round(x));
    const p = 10 ** (Math.floor(Math.log10(x)) - 2);
    return fmt(Math.round(x / p) * p);
  };
  var hs = (x) => x > 0 && x < 1.5 ? "hotspot" : "hotspots";
  var aboutN = (x) => x > 0 && x < 1 ? "fewer than 1 hotspot" : `about ${about(x)} ${hs(x)}`;
  var midWords = (x) => x < 0.5 ? "The middle outcome is none" : `The middle outcome is about ${about(x)}`;
  var builtWords = (tf) => Math.abs(tf - 1) < 5e-3 ? "built from past years with recent ones counted more" : `built from past years with recent ones counted more and the recent trend applied (\xD7${tf.toFixed(2)})`;
  var sum = (a) => a.reduce((s2, v) => s2 + v, 0);
  var skilled = (F2) => (F2.metrics.month.crps_skill ?? 0) > SKILL_MIN;
  function checkOf(F2, d) {
    const p = d.partial, y = d.y2026;
    if (!p || !y || p.y !== 2026 || d.y0 > 2026) return null;
    const i0 = (2026 - d.y0) * 12, mon = p.m - 1, full = p.i - i0;
    if (full !== mon || mon < 0 || mon > 11 || d.monthly.V.length <= p.i || !(p.days_in_month > 0)) return null;
    const frac = Math.min(1, Math.max(0, p.day1 / p.days_in_month)), obs = d.monthly.V.slice(i0, p.i + 1), upTo = (a) => sum(a.slice(0, full)) + a[full] * frac, after = (a) => a[full] * (1 - frac) + sum(a.slice(full + 1, 12)), m = F2.month;
    let inRange = 0;
    for (let k = 0; k < full; k++) if (obs[k] >= m.lo[k] && obs[k] <= m.hi[k]) inRange++;
    const over = mon === 11 && frac >= 1, t = y.ytd, jc = y.join_check_2025;
    return {
      day: p.day1,
      mon,
      full,
      obs,
      cur: y.ytd.cur,
      exp: upTo(m.mean),
      mid: upTo(m.med),
      usual: upTo(F2.hist.mean),
      viirs: t.V.length ? { mean: sum(t.V) / t.V.length, med: t.V_stats.median, from: t.years[0], to: t.years[1] } : null,
      gap: jc && num2(jc.V_pct) ? { pct: jc.V_pct / 100, warn: !!jc.warn } : null,
      inRange,
      rest: over ? null : {
        from: frac < 1 ? `${p.day1 + 1} ${MON[mon]}` : `1 ${MON[mon + 1]}`,
        exp: after(m.mean),
        mid: after(m.med),
        usual: after(F2.hist.mean)
      },
      to: `${p.day1} ${MON[mon]}`
    };
  }
  function rel(cur2, ref) {
    if (ref <= 0) return cur2 > 0 ? "more than" : "the same as";
    const r = cur2 / ref;
    if (r >= 2) return `${times(r).replace("\xD7", "")} times`;
    if (Math.abs(r - 1) < 0.05) return "close to";
    return `${Math.round(Math.abs(r - 1) * 100)}% ${r > 1 ? "more" : "fewer"} than`;
  }
  var V2 = { k: null, d: null, F: null, C: null, year: 2026, mode: "p" };
  function fcOpen(k) {
    V2.k = k;
    V2.d = V2.F = V2.C = null;
    V2.year = 2026;
    V2.mode = "p";
    $("cFcTitle").textContent = "2026 and 2027";
    $("cFcSub").textContent = $("cFcSrc").textContent = "";
    $("cFcMain").hidden = true;
    [
      "cFcFigs",
      "cFcAhead",
      "cFcSkill",
      "cFcChart",
      "cFcMap",
      "cFcLegend",
      "cFcPick",
      "cFcCheckT",
      "cFcAheadT",
      "cFcChartT",
      "cFcChartS",
      "cFcMapT",
      "cFcMapS",
      "cFcMethod",
      "cFcVerdict",
      "cFcDlMsg"
    ].forEach((id) => $(id).innerHTML = "");
    state2(k ? "Loading the forecast\u2026" : "");
  }
  function fcClose() {
    fcOpen("");
    V2.k = null;
  }
  function fcStart(d) {
    if (V2.k !== d.country) return;
    V2.d = d;
    load();
  }
  function load() {
    const k = V2.k;
    if (!k) return;
    state2("Loading the forecast\u2026");
    loadChecked(forecastPath(k), (x) => isForecast(x, k)).then(
      (F2) => {
        if (V2.k !== k || !V2.d) return;
        V2.F = F2;
        V2.C = checkOf(F2, V2.d);
        state2("");
        render3();
      },
      (e) => {
        if (V2.k !== k) return;
        state2(`The forecast did not load${e instanceof Error ? ` (${e.message})` : ""}. The rest of this page is unaffected.`, true);
      }
    );
  }
  function state2(msg, retry = false) {
    $("cFcState").hidden = !msg;
    $("cFcMsg").textContent = msg;
    $("cFcRetry").hidden = !retry;
  }
  function fcResize() {
    if (V2.F && V2.d && !$("cFcMain").hidden) chart();
  }
  function render3() {
    const F2 = V2.F, C = V2.C, tn = theName(F2.name), avg = F2.hist.annual_mean, e26 = F2.year["2026"].mean, skill2 = skilled(F2), sk = F2.metrics.month.crps_skill ?? 0;
    $("cFcSrc").innerHTML = `Data: <a href="${esc7(fileUrl(forecastPath(F2.country)))}" target="_blank" rel="noopener">${esc7(forecastPath(F2.country))}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built by scripts/build_world_forecast.py from the harmonized monthly record (summary/v2), data through December 2025. Hotspots are counted in VIIRS terms; MODIS years before 2012 are converted as on the rest of this page.` + (C ? ` 2026 so far is from summary/v3, as at the top of this page.` : "");
    if (avg === 0 && e26 === 0) {
      $("cFcTitle").textContent = "No fire on record, so there is nothing to forecast";
      $("cFcSub").textContent = `NASA's satellites counted no vegetation-fire hotspots in ${tn} from 2001 to 2025.` + (C ? ` 2026 so far, to ${C.to}: ${nHot3(C.cur)}.` : "");
      $("cFcMain").hidden = true;
      return;
    }
    $("cFcTitle").textContent = skill2 ? C ? C.exp >= 5 ? `By ${C.day} ${MONL[C.mon]}, ${tn} had ${nHot3(C.cur)} in 2026, ${rel(C.cur, C.exp)} the ${about(C.exp)} this forecast expected` : `By ${C.day} ${MONL[C.mon]}, ${tn} had ${nHot3(C.cur)} in 2026; this forecast expected ${C.exp < 1 ? "fewer than 1" : `about ${about(C.exp)}`}` : `From the record through 2025, this forecast expected ${aboutN(e26)} in ${tn} in 2026` : `This forecast did ${sk > 0 ? "about as well as" : "no better than"} the plain 2001\u20132025 record in ${tn}, so the usual year is ${sk > 0 ? "just as good a" : "the better"} guide`;
    $("cFcSub").textContent = `Made from the fire record through December 2025 (in VIIRS terms), with recent years counted more and a damped trend. It has no weather, fuel or ignition data, so it shows what a typical year looks like now. It cannot say which fires will happen, or whether a year will be unusual.` + (C ? ` Most of 2026 has now happened, so it is checked here against what the satellites saw.` : ` 2026 so far did not load, so the forecast is not checked against it here.`) + (NOT_FIRE2[F2.country] ? ` ${NOT_FIRE2[F2.country]}` : "");
    figures(F2, C, skill2);
    skillText(F2, skill2);
    $("cFcMethod").textContent = F2.method;
    $("cFcVerdict").textContent = `Scores for ${tn}: ${F2.verdict}`;
    $("cFcDetailsT").textContent = `How this forecast is made, and its test scores for ${tn}`;
    $("cFcDlMsg").textContent = "";
    $("cFcMain").hidden = false;
    segs();
    chart();
    map();
  }
  var item = (h2, fig, small, p) => `<div class="cpAns"><h2>${h2}</h2><p class="cpFig">${fig}<small>${small}</small></p><p>${p}</p></div>`;
  function figures(F2, C, skill2) {
    const sk = F2.metrics.month.crps_skill ?? 0, avg = F2.hist.annual_mean, e26 = F2.year["2026"].mean, e27 = F2.year["2027"].mean, mid = (y) => sum(F2.month.med.slice((y - 2026) * 12, (y - 2025) * 12)), even = Math.abs(sk) <= SKILL_MIN && sk !== 0, track = item(
      "Track record, 2018\u20132025",
      even ? "About even" : sk === 0 ? "0%" : size(sk),
      even ? `with history alone (${size(sk)} ${sk > 0 ? "closer" : "further off"})` : sk > 0 ? "closer than history alone" : sk < 0 ? "further off than history alone" : "no closer than history alone",
      `Each year was forecast from the years before it. \u201CHistory alone\u201D counts every past year the same, with no trend.`
    );
    $("cFcCheckT").hidden = $("cFcFigs").hidden = !C;
    if (C) {
      const tol = C.gap ? Math.abs(C.gap.pct) * C.cur : 0, eF = Math.abs(C.cur - C.exp), vs = (base2) => {
        const eB = Math.abs(C.cur - base2);
        return eF < eB * 0.9 && eB - eF > tol ? -1 : eB < eF * 0.9 && eF - eB > tol ? 1 : 0;
      }, vsAll = vs(C.usual), vsV = C.viirs ? vs(C.viirs.mean) : vsAll, vName = "the VIIRS years alone", phr = (c) => c < 0 ? "closer than" : c > 0 ? "further off than" : "about as close as", closer = !C.viirs ? `In 2026 so far the forecast came ${phr(vsAll)} the usual year.` : vsAll === vsV ? vsAll < 0 ? `In 2026 so far the forecast came closer than both the 2001\u20132025 average and ${vName}.` : vsAll > 0 ? `In 2026 so far both the 2001\u20132025 average and ${vName} came closer than the forecast.` : `In 2026 so far the forecast came about as close as both the 2001\u20132025 average and ${vName}.` : `In 2026 so far the forecast came ${phr(vsAll)} the 2001\u20132025 average and ${phr(vsV)} ${vName}.` + (vsAll < 0 ? " Most of its gain comes from counting the VIIRS years more." : ""), care = C.gap && C.gap.warn ? ` Read 2026 with care: run on 2025, the 2026 method came out ${Math.round(Math.abs(C.gap.pct) * 100)}% ${C.gap.pct > 0 ? "higher" : "lower"} than the archive this forecast was built from.` : "", seen = item("2026 so far", fmt(C.cur), `hotspots, 1 Jan\u2013${C.to}`, `What the satellites saw, as at the top of this page.${care}`), fc = item(
        "This forecast, same dates",
        about(C.exp),
        `${hs(C.exp)} expected on average`,
        `Made before 2026 began. ${C.mid < 0.5 ? "Its middle path has no hotspots." : `Its middle path adds up to ${about(C.mid)}.`}` + (C.full >= 3 ? ` ${C.inRange} of the ${C.full} complete months fell inside its 80% range; about ${Math.round(C.full * 0.8)} would be on target.` : "")
      ), usual = item(
        "A usual year, same dates",
        about(C.usual),
        `${hs(C.usual)}, the 2001\u20132025 average`,
        `History alone: every past year counted the same.` + (C.viirs ? ` The VIIRS years alone (${C.viirs.from}\u2013${C.viirs.to}) had ${about(C.viirs.mean)} on average for these dates (typical ${fmt(C.viirs.med)}, as at the top of this page).` : "") + ` ${closer} One year is a small test.`
      );
      $("cFcCheckT").textContent = `2026 so far, to ${C.to}, against the forecast`;
      $("cFcFigs").innerHTML = seen + (skill2 ? fc + usual : usual + fc);
    }
    const trend2 = F2.year["2027"].trend_factor / F2.year["2026"].trend_factor - 1, trendText = F2.same_2027 || Math.abs(trend2) < 5e-4 ? "The same as 2026: there is no recent trend to carry forward, and nothing else is known about 2027." : `The same months as 2026, ${trend2 > 0 ? "raised" : "lowered"} by the recent trend (${signed2(trend2)}). Nothing else is known about 2027.`;
    if (skill2) {
      const first = C ? C.rest ? item(
        "Rest of 2026",
        about(C.rest.exp),
        `${hs(C.rest.exp)} expected on average, ${C.rest.from}\u201331 Dec`,
        `${midWords(C.rest.mid)}. A usual year has ${about(C.rest.usual)} in these weeks.`
      ) : "" : item(
        "2026, as forecast",
        about(e26),
        `${hs(e26)} expected on average`,
        `Forecast from the record through 2025; ${mid(2026) < 0.5 ? "its middle path has no hotspots" : `its middle path adds up to about ${about(mid(2026))}`}. An average year in 2001\u20132025 had ${about(avg)}.`
      );
      $("cFcAheadT").textContent = C ? C.rest ? "Still ahead: the rest of 2026, and 2027" : "Still ahead: 2027" : "2026 and 2027, as forecast";
      $("cFcAhead").innerHTML = first + item(
        "2027",
        about(e27),
        `${hs(e27)} expected on average`,
        `${midWords(mid(2027))}; one big past year can pull the average up. ${trendText}`
      ) + track;
      return;
    }
    const med = F2.hist.median, top = med.map((v, m) => ({ v, m })).filter((o) => o.v > 0).sort((a, b) => b.v - a.v).slice(0, 3), pk = top[0], own = `The method's own figure for 2027 is ${about(e27)} on average, but it did not beat the plain record here, so we do not lean on it.`;
    const season2 = pk ? item(
      "Usually busiest",
      top.map((o) => o.m).sort((a, b) => a - b).map((m) => MON[m]).join(", "),
      `a typical ${MONL[pk.m]} has ${about(pk.v)} ${hs(pk.v)}`,
      own
    ) : item("Usually busiest", "No usual month", "each month had none in at least half the years 2001\u20132025", own);
    $("cFcAheadT").textContent = `Still ahead: the usual year is ${sk > 0 ? "just as good a" : "the better"} guide`;
    $("cFcAhead").innerHTML = item(
      "A usual year",
      about(avg),
      `${hs(avg)}, the 2001\u20132025 average`,
      `2025 had ${fmt(F2.hist.y2025)}.` + (C?.rest ? ` A usual ${C.rest.from}\u201331 Dec has ${about(C.rest.usual)}.` : "")
    ) + season2 + track;
  }
  function skillText(F2, skill2) {
    const tn = theName(F2.name), mm = F2.metrics.month, sk = mm.crps_skill ?? 0, tiny = F2.hist.annual_mean < 5;
    const t = `<b>How well this did on 2018\u20132025.</b> Each year from 2018 to 2025 was forecast from the years before it and scored against what happened. ` + (skill2 ? `For ${esc7(tn)}, the monthly forecasts were ${size(sk)} closer than history alone (every past year counted the same, with no trend). ` + (tiny ? `With so few hotspots a year, that score rests on very few months with fire. ` : `That is ${sk < 0.1 ? "a small gain" : "more than in most countries"}. `) + `Across ${COUNTRIES_SCORED} countries the middle one improved by only ${TYPICAL_GAIN}, and most of the gain comes from counting the VIIRS years since 2012 more than the older MODIS years. ` : `For ${esc7(tn)}, the monthly forecasts were ${Math.abs(sk) <= SKILL_MIN && sk !== 0 ? `about as good as history alone (${size(sk)} ${sk > 0 ? "closer" : "further off"})` : sk < 0 ? `${size(sk)} further off than history alone` : "no closer than history alone"}, so this forecast adds nothing over the past record here. The chart below shows its months, ${builtWords(F2.year["2026"].trend_factor)}; in tests they did no better than the dashed line, the typical month. Across ${COUNTRIES_SCORED} countries the middle one improved by only ${TYPICAL_GAIN}. `) + `The one setting used for every country was picked on these same years, so these scores flatter it slightly. The 80% range held the real month ${pc(mm.cover80)} of the time (history alone: ${pc(mm.cover80_base)})` + (mm.cover80 < 0.75 ? ", so here it is too narrow: expect more surprises than the band shows." : ".") + (mapBelowChance(F2) ? ` Its map of squares is left out: tested on 2018\u20132025, it told squares that burned from squares that did not worse than a coin toss (AUC ${F2.metrics.cell.auc.toFixed(2)}).` : "");
    $("cFcSkill").innerHTML = t;
  }
  function segs() {
    document.querySelectorAll("#cFcYearSeg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.year) === V2.year)));
    document.querySelectorAll("#cFcMapSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === V2.mode)));
  }
  function chart() {
    const F2 = V2.F, C = V2.C, y = V2.year, i0 = (y - 2026) * 12, skill2 = skilled(F2), tf = F2.year[y === 2026 ? "2026" : "2027"].trend_factor, rows = MON.map((_, m) => ({
      m,
      mean: F2.month.mean[i0 + m],
      lo: F2.month.lo[i0 + m],
      med: F2.month.med[i0 + m],
      hi: F2.month.hi[i0 + m],
      typ: F2.hist.median[m],
      pAny: F2.month.p_any[i0 + m],
      pAbove: F2.month.p_above[i0 + m],
      obs: y === 2026 && C && m <= C.full ? C.obs[m] : null,
      part: y === 2026 && C && m === C.full ? `1\u2013${C.day} ${MON[m]}, not over` : void 0
    })), meds = rows.map((r) => r.med), pk = meds.indexOf(Math.max(...meds)), built = builtWords(tf), key = `<span class="cpMiniKey"><span><i style="background:#e0dace"></i>8 in 10 outcomes</span>` + (y === 2026 && C ? `<span><i class="cpKeyDot"></i>2026 as seen</span>` : "") + `</span>`;
    if (y === 2026 && C) {
      $("cFcChartT").textContent = C.full >= 3 ? `${C.inRange} of the ${C.full} complete months of 2026 fell inside the forecast's 80% range` : `2026 so far against the forecast's months`;
      $("cFcChartS").innerHTML = `Red dots: 2026 as the satellites saw it, ${C.full ? `January to ${MONL[C.full - 1]}` : "so far"}; ${MONL[C.mon]} is not over and is left off (point at it for its first ${C.day} days). The band holds 8 in 10 outcomes of the forecast made before the year began, the solid line is its middle outcome, and the dashed line is the typical month of 2001\u20132025. ` + (skill2 ? "" : `The forecast's months are ${built}; in its tests it did no better than the dashed line. `) + key;
    } else {
      $("cFcChartT").textContent = y === 2026 ? `What the forecast expected for each month of 2026` : skill2 ? meds[pk] > 0 ? `${MONL[pk]} looks like the busiest month of 2027` : `Most months of 2027 look quiet` : `What past years suggest for each month of 2027`;
      $("cFcChartS").innerHTML = (skill2 ? "" : `These months are ${built}; in tests that did no better than the dashed line. `) + `The solid line is the middle outcome and the band holds 8 in 10 outcomes; the dashed line is the typical month of 2001\u20132025. The yearly figures above add up the expected (mean) months, which one big year can pull up.` + key;
    }
    const el = $("cFcChart");
    if (!window.Plot || !window.d3) {
      const k = V2.k;
      if (!el.firstChild) el.innerHTML = `<p class="cpCap">Drawing\u2026</p>`;
      loadPlotLib().then(
        () => V2.k === k && V2.F === F2 && chart(),
        () => {
          if (V2.k === k)
            el.innerHTML = `<p class="cpCap">The chart did not load (jsdelivr or cdnjs did not answer). The numbers above are unaffected.</p>`;
        }
      );
      return;
    }
    forecastMonths(el, rows, y);
  }
  var MIN_MAP_SQUARES = 10;
  var mapBelowChance = (F2) => {
    const cm = F2.metrics.cell;
    return !!cm && cm.auc != null && cm.cell_years * cm.rate >= MIN_POSITIVES && cm.auc < 0.5;
  };
  function mapUseful(F2) {
    let k = 0;
    for (let r = 1; r < F2.cell_rows.length; r += 4) if (F2.cell_rows[r] >= 0.1) k++;
    return k >= MIN_MAP_SQUARES && !mapBelowChance(F2);
  }
  function legend3(title, cols, labels) {
    return `<div><b>${title}</b><div class="cpKey">` + cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : labels[i - 1]}</span></div>`).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${labels[cols.length - 1] ?? ""}</span></div></div></div>`;
  }
  function burned2026(d) {
    const out = /* @__PURE__ */ new Set(), yi = 2026 - d.y0, r = d.cell_rows;
    if (!d.partial) return out;
    for (let p = 0; p + 4 < r.length; p += 5) if (r[p + 1] === yi && r[p + 2] > 0) out.add(r[p]);
    return out;
  }
  function map() {
    const F2 = V2.F, d = V2.d, C = V2.C, tn = theName(F2.name), host = $("cFcMap"), n = Math.min(F2.ncell, F2.cell_rows.length / 4, d.cells.length / 2), km3 = Math.round(d.cell * 111);
    const p = new Float64Array(n), ph = new Float64Array(n), ex = new Float64Array(n);
    for (let r = 0; r < F2.cell_rows.length; r += 4) {
      const c = F2.cell_rows[r];
      if (c < 0 || c >= n) continue;
      p[c] = F2.cell_rows[r + 1];
      ph[c] = F2.cell_rows[r + 2];
      ex[c] = F2.cell_rows[r + 3];
    }
    $("cFcMapFig").hidden = n < 5 || F2.cell !== d.cell || !mapUseful(F2);
    if ($("cFcMapFig").hidden) {
      host.innerHTML = "";
      return;
    }
    const all = Array.from({ length: n }, (_, c) => c), cls = (v, breaks) => breaks.filter((b) => v >= b).length, seen = C ? burned2026(d) : null, cm = F2.metrics.cell, enough = !!cm && cm.cell_years * cm.rate >= MIN_POSITIVES, dp = d.cell === 0.25 ? 3 : 2;
    let layers2, tested = "";
    if (V2.mode === "p") {
      const cols = classColours(P_BREAKS);
      layers2 = cols.map((fill, i) => ({ fill, cells: all.filter((c) => cls(p[c], P_BREAKS) === i), edge: n < 400 }));
      $("cFcLegend").innerHTML = legend3("Chance of at least one hotspot in 2026, as forecast", cols, [
        ...P_BREAKS.map((b) => Math.round(b * 100) + "%"),
        "100%"
      ]);
      const evenSet = all.filter((c) => p[c] >= 0.5), even = evenSet.length;
      $("cFcMapT").textContent = even === 0 ? `The forecast gave no square in ${tn} an even chance of a hotspot in 2026` : `The forecast gave ${even === n ? "every square" : `${fmt(even)} of ${fmt(n)} squares`} an even or better chance of a hotspot in 2026`;
      let check = "";
      if (seen) {
        const share2 = (cs) => cs.length ? pc(cs.filter((c) => seen.has(c)).length / cs.length) : "", rest = all.filter((c) => p[c] < 0.5), fresh2 = [...seen].filter((c) => c >= F2.ncell).length;
        check = ` By ${C.to}, ${even && rest.length ? `${share2(evenSet)} of those squares had a hotspot in 2026, and ${share2(rest)} of the others` : `${share2(all)} of the squares had a hotspot in 2026`}` + (fresh2 ? `; ${fmt(fresh2)} square${fresh2 === 1 ? "" : "s"} with none in 2001\u20132025 burned, which this map could not foresee.` : ".");
      }
      $("cFcMapS").textContent = `Forecast from the record through 2025: the chance of at least one hotspot in 2026 in each ${d.cell}\xB0 square (about ${km3} km north to south), from how often it burned before, recent years counted more. The squares are yearly, so there is no month-by-month map.` + check;
      if (cm && cm.auc != null && cm.auc_base != null)
        tested = !enough ? " Too few squares burned in 2018\u20132025 to test these chances." : ` Tested on 2018\u20132025, these chances told squares that burned from squares that did not with an AUC of ${cm.auc.toFixed(2)} (history alone ${cm.auc_base.toFixed(2)}; 0.5 is a coin toss, 1 is perfect).` + (cm.auc < 0.5 ? " Here that is worse than a coin toss, so do not read the map as a guide." : Math.abs(cm.auc - cm.auc_base) < 0.01 ? " That is no better than history alone." : cm.auc < 0.65 ? " That is weak." : "");
    } else {
      const { breaks, max } = classBreaks(Array.from(ex)), cols = classColours(breaks);
      layers2 = cols.map((fill, i) => ({ fill, cells: all.filter((c) => ex[c] > 0 && cls(ex[c], breaks) === i), edge: n < 400 }));
      $("cFcLegend").innerHTML = legend3("Expected hotspots in 2026, as forecast", cols, [...breaks.map((b) => short(b)), short(max)]);
      const vals = Array.from(ex).sort((a, b) => b - a), tot = vals.reduce((a, b) => a + b, 0);
      let acc = 0, k50 = 0;
      for (const v of vals) {
        acc += v;
        k50++;
        if (acc >= tot / 2) break;
      }
      const share2 = k50 / n * 100;
      $("cFcMapT").textContent = tot > 0 && n >= 10 ? `The forecast put half of the expected 2026 hotspots in ${share2 < 1 ? "under 1" : Math.round(share2)}% of the squares` : "Expected hotspots in 2026, as forecast";
      $("cFcMapS").textContent = `The expected 2026 total shared out by each ${d.cell}\xB0 square's part of past hotspots, recent years counted more. A square's share of the past is the whole method: it does not know about new fires.`;
      if (cm && enough)
        tested = cm.mae > cm.mae_base ? " Tested on 2018\u20132025, these per-square numbers were further off than history alone." : cm.mae < cm.mae_base * 0.99 ? ` Tested on 2018\u20132025, these per-square numbers were ${size(1 - cm.mae / cm.mae_base)} closer than history alone.` : " Tested on 2018\u20132025, these per-square numbers were about as close as history alone.";
    }
    drawMini(host, d, {
      layers: layers2,
      label: `Map of ${tn} in squares, coloured by ${V2.mode === "p" ? "the chance of at least one hotspot" : "the expected hotspots"} in 2026, as forecast`,
      caption: $("cFcPick"),
      idle: (matchMedia("(pointer: coarse)").matches ? "Tap" : "Point at") + " a square for its numbers." + tested,
      pick: (c) => {
        if (c >= n) return null;
        const [lat, lon] = cellCentre(d, c);
        return `<b>Near ${deg4(lat, "N", "S", dp)}, ${deg4(lon, "E", "W", dp)}</b>: the forecast gave a ${pc(p[c])} chance of at least one hotspot in 2026 (expected: ${ex[c] === 0 ? "none" : aboutN(ex[c])}). It had one in ${pc(ph[c])} of the years 2001\u20132025.` + (seen ? ` 2026 to ${C.to}: ${seen.has(c) ? "it had a hotspot" : "no hotspot yet"}.` : "");
      }
    });
  }
  function csv2() {
    const F2 = V2.F, C = V2.C;
    if (!F2) return;
    const rows = [
      "year,month,expected_mean,p10,median,p90,chance_any_hotspot,chance_above_2001_2025_median,median_2001_2025,mean_2001_2025,seen_2026,seen_2026_status"
    ];
    for (let i = 0; i < 24; i++) {
      const m = i % 12, seen = C && i <= C.full ? C.obs[i] : null;
      rows.push(
        [
          2026 + Math.floor(i / 12),
          m + 1,
          F2.month.mean[i],
          F2.month.lo[i],
          F2.month.med[i],
          F2.month.hi[i],
          F2.month.p_any[i],
          F2.month.p_above[i],
          F2.hist.median[m],
          F2.hist.mean[m],
          seen ?? "",
          seen == null ? "" : i === C.full ? `days_1_to_${C.day}` : "complete"
        ].join(",")
      );
    }
    save(`burn-calendar_${F2.country}_forecast_2026-2027.csv`, rows.join("\n"), $("cFcDlMsg"));
  }
  function fcEvents() {
    $("cFcRetry").onclick = () => {
      if (V2.k && V2.d) load();
    };
    document.querySelectorAll("#cFcYearSeg button").forEach(
      (b) => b.onclick = () => {
        V2.year = b.dataset.year === "2027" ? 2027 : 2026;
        segs();
        if (V2.F) chart();
      }
    );
    document.querySelectorAll("#cFcMapSeg button").forEach(
      (b) => b.onclick = () => {
        V2.mode = b.dataset.mode === "e" ? "e" : "p";
        segs();
        if (V2.F && V2.d) map();
      }
    );
    $("cFcDl").onclick = csv2;
  }
  var fcLoad = (k) => loadChecked(forecastPath(k), (x) => isForecast(x, k));
  function relExpected(cur2, exp) {
    const r = cur2 / exp;
    if (r < 0.1) return "Far fewer than expected";
    const t = rel(cur2, exp);
    return r >= 2 ? `${t} what was expected` : `${t.charAt(0).toUpperCase()}${t.slice(1)} expected`;
  }
  function fcGlance(F2, d) {
    if (F2.hist.annual_mean === 0 && F2.year["2026"].mean === 0) return null;
    const C = checkOf(F2, d), skill2 = skilled(F2), m = C ? C.mon : (d.partial?.m ?? (/* @__PURE__ */ new Date()).getMonth() + 1) - 1, next = C ? m + 1 : m, pAny = skill2 ? F2.month.p_any[next] : F2.hist.p_any[next % 12];
    const soFar = C ? {
      label: `${MONL[m]} so far`,
      value: C.obs[C.full] > 0 ? nHot3(C.obs[C.full]) : "None yet",
      title: `1\u2013${C.day} ${MONL[m]} 2026, as the satellites saw it`
    } : null;
    const vs = C ? {
      value: C.exp >= 5 ? relExpected(C.cur, C.exp) : `${nHot3(C.cur)} <small>expected ${C.exp < 1 ? "fewer than 1" : `about ${about(C.exp)}`}</small>`,
      /* where the forecast had no skill, say so where phones can see it, not only in a hover title */
      note: skill2 ? "" : "No better than a typical year here",
      title: `By ${C.to} 2026: ${nHot3(C.cur)}; the forecast expected ${C.exp < 1 ? "fewer than 1" : `about ${about(C.exp)}`}.` + (skill2 ? "" : " This forecast did no better than the typical year here, so read it loosely.")
    } : null;
    return {
      vs,
      soFar,
      chance: {
        label: `Chance of fire in ${MONL[next % 12]}${next >= 12 ? " 2027" : ""}`,
        value: pc(pAny),
        title: skill2 ? "From the 2026 forecast" : "From 2001\u20132025: the forecast did no better here"
      }
    };
  }
  var fcCellOk = (F2, d, c) => F2.cell === d.cell && c >= 0 && c < F2.ncell && mapUseful(F2);
  function fcCell(F2, c) {
    const r = F2.cell_rows;
    for (let i = 0; i + 3 < r.length; i += 4) if (r[i] === c) return { p: r[i + 1], share: r[i + 2], exp: r[i + 3] };
    return null;
  }
  var fcPc = pc;

  // src/cstn.ts
  var LEVELS = ["fair", "patchy", "thin", "unpopulated", "no_data"];
  var numOrNull2 = (x) => x === null || typeof x === "number";
  function isStations(x, k) {
    if (!isObj(x) || x.v !== 2 || x.country !== k || typeof x.name !== "string") return false;
    const co = x.completeness;
    return typeof x.cell === "number" && typeof x.stations_total === "number" && Array.isArray(x.stations) && x.stations.every((s2) => Array.isArray(s2) && typeof s2[0] === "number" && typeof s2[1] === "number" && typeof s2[2] === "string") && Array.isArray(x.operators) && isNums(x.cell_rows) && x.cell_rows.length % 8 === 0 && isNums(x.gaps) && isNums(x.persistent) && isNums(x.persistent_why, x.persistent.length) && isObj(x.why_codes) && isNums(x.fire_per_year) && isObj(co) && typeof co.level === "string" && LEVELS.includes(co.level) && numOrNull2(co.per_million) && numOrNull2(co.peer_median_per_million) && typeof x.gap_note === "string" && typeof x.method === "string" && typeof x.source === "string";
  }
  var ARABIA = /* @__PURE__ */ new Set(["Saudi_Arabia", "Yemen", "Oman", "United_Arab_Emirates", "Qatar", "Kuwait", "Bahrain"]);
  var SAHARA = /* @__PURE__ */ new Set(["Algeria", "Libya", "Egypt", "Mali", "Niger", "Chad", "Mauritania", "Sudan", "Tunisia", "Morocco"]);
  var SAHARA_NORTH = { Libya: 31, Egypt: 31 };
  var desert = (k, lat, lon) => ARABIA.has(k) || SAHARA.has(k) && lat >= 18 && lat < (SAHARA_NORTH[k] ?? 34) && lon >= -17 && lon <= 34;
  var DESERT_FLAG = "Unverified: in the desert, these detections may be gas flares or industrial heat that FIRMS did not flag.";
  var SOLAR = /* @__PURE__ */ new Set(["United_Arab_Emirates", "Chile", "Israel"]);
  var SOLAR_CELLS = [
    [24.75, 55.35],
    [24.75, 55.45],
    [24.75, 55.55],
    [24.65, 55.45],
    [-25.55, -70.15]
  ];
  var solarCell = (lat, lon) => SOLAR_CELLS.some(([a, b]) => Math.abs(a - lat) < 0.01 && Math.abs(b - lon) < 0.01);
  var SOLAR_FLAG = "Possibly a solar plant or other daytime industrial heat: almost none of its detections are at night.";
  var WHY = {
    static: ["likely a gas flare or industrial heat", "likely gas flares or industrial heat"],
    flare_field: ["likely a gas flare or industrial heat", "likely gas flares or industrial heat"],
    night_all_season: ["all-season night burning, likely flares", "with all-season night burning, likely flares"],
    night_weak: ["mostly weak night detections, likely a flare, kiln or mine", "with mostly weak night detections, likely flares, kilns or mines"]
  };
  var whyOf = (S3, code) => WHY[S3.why_codes[String(code)] ?? ""] ?? ["a steady heat source, likely not vegetation fire", "other steady heat, likely not vegetation fire"];
  var REG = "#feb24c";
  var GAP = "#bd0026";
  var GAP_MUTED = "#e2694f";
  var STEADY = "#bdb6a8";
  var MIN_MAP_SQUARES2 = 5;
  var esc8 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var pc2 = (p) => p > 0 && p < 0.01 ? "under 1%" : Math.round(p * 100) + "%";
  var km2 = (v) => (v < 10 ? v.toFixed(1) : fmt(v)) + " km";
  var deg5 = (v, p, n, dp) => `${Math.abs(v).toFixed(dp)}\xB0${v < 0 ? n : p}`;
  var perYear = (v) => v < 0.1 ? "under 0.1 hotspots a year" : `about ${fmt(v)} hotspot${fmt(v) === "1" ? "" : "s"} a year`;
  var NO_STATION = "no fire station mapped in OpenStreetMap within 15 km";
  var across = (d) => `about ${Math.round(d.cell * 111)} km north to south`;
  var noteOf = (S3) => S3.gap_note.replace(/\s*(Show them as|Do not present)[\s\S]*$/, "");
  function snapshot(src) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(src);
    return m ? `${Number(m[3])} ${MONL[Number(m[2]) - 1]} ${m[1]}` : "";
  }
  var V3 = { k: null, d: null, S: null, reveal: false };
  function stOpen(k) {
    V3.k = k;
    V3.d = V3.S = null;
    V3.reveal = false;
    $("cStTitle").textContent = "Fire stations";
    $("cStSub").textContent = $("cStSrc").textContent = "";
    $("cStMain").hidden = true;
    [
      "cStFigs",
      "cStLegend",
      "cStMap",
      "cStPick",
      "cStList",
      "cStDist",
      "cStCaveats",
      "cStNote",
      "cStListT",
      "cStListS",
      "cStListNote",
      "cStDistNote",
      "cStMethod"
    ].forEach((id) => $(id).innerHTML = "");
    state3(k ? "Loading the fire stations\u2026" : "");
  }
  function stClose() {
    stOpen("");
    V3.k = null;
  }
  function stStart(d) {
    if (V3.k !== d.country) return;
    V3.d = d;
    load2();
  }
  function load2() {
    const k = V3.k;
    if (!k) return;
    state3("Loading the fire stations\u2026");
    loadChecked(stationsPath(k), (x) => isStations(x, k)).then(
      (S3) => {
        if (V3.k !== k || !V3.d) return;
        V3.S = S3;
        state3("");
        render4();
      },
      (e) => {
        if (V3.k !== k) return;
        state3(`The fire stations did not load${e instanceof Error ? ` (${e.message})` : ""}. The rest of this page is unaffected.`, true);
      }
    );
  }
  function state3(msg, retry = false) {
    $("cStState").hidden = !msg;
    $("cStMsg").textContent = msg;
    $("cStRetry").hidden = !retry;
  }
  function facts(S3, d) {
    const n = Math.min(S3.cell_rows.length / 8, d.cells.length / 2), steady = /* @__PURE__ */ new Map(), place3 = (c) => ({
      c,
      by: S3.cell_rows[8 * c + 7],
      km1: S3.cell_rows[8 * c + 4],
      s1: S3.cell_rows[8 * c + 1],
      fpy: S3.fire_per_year[c] ?? 0
    });
    S3.persistent.forEach((c, i) => {
      if (c < n && S3.cell_rows[8 * c + 7] >= 4) steady.set(c, S3.persistent_why[i]);
    });
    const all = new Set(S3.persistent), burn = [];
    for (let c = 0; c < n; c++) if (S3.cell_rows[8 * c + 7] >= 4 && !all.has(c)) burn.push(place3(c));
    const lv = S3.completeness.level, gaps = S3.gaps.filter((c) => c < n).map(place3);
    return {
      n,
      burn,
      gaps,
      gapSet: new Set(gaps.map((p) => p.c)),
      steady,
      show: lv === "fair" ? "yes" : lv === "patchy" ? "ask" : "no"
    };
  }
  var posOf = (d, c) => {
    const [lat, lon] = cellCentre(d, c), dp = d.cell === 0.25 ? 3 : 2;
    return { lat, lon, text: `${deg5(lat, "N", "S", dp)}, ${deg5(lon, "E", "W", dp)}` };
  };
  function stationName(S3, i) {
    const s2 = S3.stations[i];
    if (!s2) return "";
    const op = s2[3] >= 0 ? S3.operators[s2[3]] : "";
    return s2[2] || (op ? `an unnamed station of ${op}` : "an unnamed station");
  }
  function nearest(S3, p, isGap) {
    if (p.km1 < 0 || p.s1 < 0) return "No fire station is mapped in OpenStreetMap anywhere in the country.";
    const nm = stationName(S3, p.s1);
    return `Nearest mapped station: ${isGap && p.km1 < 15.5 ? "just over 15 km" : km2(p.km1)}${nm ? `, <bdi>${esc8(nm)}</bdi>` : ""}.`;
  }
  var anyDesert = (S3, d, ps) => ps.some((p) => {
    const pos = posOf(d, p.c);
    return desert(S3.country, pos.lat, pos.lon);
  });
  function render4() {
    const S3 = V3.S, d = V3.d, tn = theName(S3.name), F2 = facts(S3, d), lv = S3.completeness.level, snap = snapshot(S3.source);
    $("cStSrc").innerHTML = `Fire stations \xA9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors, ODbL</a>. Data: <a href="${esc8(fileUrl(stationsPath(S3.country)))}" target="_blank" rel="noopener">${esc8(stationsPath(S3.country))}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built by scripts/build_world_stations.py from the OpenStreetMap planet file of ${esc8(snap || S3.source)}. Fire: NASA FIRMS, ${esc8(S3.fire)}.`;
    const nb = F2.burn.length, ng = F2.gaps.length;
    $("cStTitle").textContent = lv === "unpopulated" ? `${fmt(S3.stations_total)} fire station${S3.stations_total === 1 ? "" : "s"} mapped in OpenStreetMap` : nb === 0 ? `No place in ${tn} burned in 4 or more of the 14 years 2012\u20132025` : F2.show === "no" ? `Too few fire stations are mapped in OpenStreetMap in ${tn} to judge where they are missing` : F2.show === "ask" ? `OpenStreetMap's fire stations look patchy in ${tn}, so its gaps are uncertain` : ng === 0 ? `Every place in ${tn} with regular fire has a fire station mapped in OpenStreetMap within 15 km` : `${fmt(ng)} place${ng === 1 ? "" : "s"} with regular fire ${ng === 1 ? "has" : "have"} ${NO_STATION}` + (anyDesert(S3, d, F2.gaps.slice(0, 10)) ? ", though in the desert some may be industrial heat" : "");
    $("cStSub").textContent = `Fire stations tagged in OpenStreetMap${snap ? ` (as of ${snap})` : ""}, set against the places where NASA's VIIRS satellite saw fire in at least 4 of the 14 years 2012\u20132025. Distances are straight lines from the middle of each ${d.cell}\xB0 square, not drive times.` + (d.cell >= 0.5 ? ` Squares here are ${across(d)}, so the 15 km test is rough.` : "");
    figures2(S3, d, F2);
    $("cStMethod").textContent = S3.method;
    $("cStMain").hidden = false;
    draw2();
  }
  function figures2(S3, d, F2) {
    const co = S3.completeness, item2 = (h2, fig, small, p) => `<div class="cpAns"><h2>${h2}</h2><p class="cpFig">${fig}${small ? `<small>${small}</small>` : ""}</p><p>${p}</p></div>`, nb = F2.burn.length, ng = F2.gaps.length, kms = F2.burn.map((p) => p.km1 < 0 ? Infinity : p.km1).sort((a, b) => a - b), mid = kms.length ? kms[Math.floor((kms.length - 1) / 2)] : NaN, ns = F2.steady.size;
    const t1 = item2(
      "Fire stations mapped",
      fmt(S3.stations_total),
      co.per_million != null ? `${fmt(co.per_million)} per million people` : "",
      co.peer_median_per_million != null ? `Countries in the same income group have a median of ${fmt(co.peer_median_per_million)} per million.` : "There is no population figure to compare with."
    );
    const t2 = item2(
      "Places with regular fire",
      fmt(nb),
      `square${nb === 1 ? "" : "s"} with fire in 4 or more of the 14 years`,
      `Each square is ${d.cell}\xB0, ${across(d)}.` + (ns ? ` ${fmt(ns)} more ${ns === 1 ? "square" : "squares"} whose heat looks like flares or industry ${ns === 1 ? "is" : "are"} left out.` : "")
    );
    let t3;
    if (nb === 0) t3 = item2("Gaps", "None", "", "No place burned often enough to count.");
    else if (F2.show === "yes")
      t3 = item2("No fire station mapped in OpenStreetMap within 15 km", fmt(ng), `${pc2(ng / nb)} of those places`, "A gap means none is mapped, not that none exists.");
    else
      t3 = item2(
        "Median distance to a mapped station",
        Number.isFinite(mid) ? km2(mid) : "None mapped",
        "from places with regular fire",
        co.level === "unpopulated" ? "Few people live here." : F2.show === "ask" ? "Many of these places may have a station that OpenStreetMap is missing, so the distance partly measures the map." : "With this little mapped, the distance mostly measures the map, not the fire service."
      );
    $("cStFigs").innerHTML = t1 + t2 + t3;
  }
  function draw2() {
    const S3 = V3.S, d = V3.d, F2 = facts(S3, d), tn = theName(S3.name), lv = S3.completeness.level, gapsOn = F2.show === "yes" || F2.show === "ask" && V3.reveal, byCell = new Map(F2.burn.map((p) => [p.c, p])), top = gapsOn ? F2.gaps.slice(0, 10) : [], marks = top.map((p, i) => {
      const pos = posOf(d, p.c);
      return { c: p.c, label: String(i + 1), title: `Gap ${i + 1}: ${pos.text}`, muted: F2.show !== "yes", keep: solarCell(pos.lat, pos.lon) };
    }), layers2 = [
      { fill: STEADY, cells: [...F2.steady.keys()] },
      { fill: REG, cells: F2.burn.filter((p) => !(gapsOn && F2.gapSet.has(p.c))).map((p) => p.c), over: true },
      { fill: F2.show === "yes" ? GAP : GAP_MUTED, cells: gapsOn ? F2.gaps.map((p) => p.c) : [], over: true }
    ].map((l) => ({ ...l, edge: F2.n < 400 }));
    const note = $("cStNote");
    note.hidden = F2.show === "yes";
    note.textContent = noteOf(S3) + (F2.show === "no" && lv !== "unpopulated" ? " So this page does not list places without a station here." : "") + (F2.show === "ask" && !V3.reveal ? " The places are hidden until you ask for them." : "") + (F2.show === "ask" && V3.reveal ? " They are shown below in muted colours, as places to check, not findings." : "");
    let empty = F2.burn.length === 0 && F2.steady.size === 0;
    const box2 = $("cStMap"), fig = box2.closest(".cpOlFig"), grid2 = box2.closest(".cpOlGrid");
    const sw = (c, t, cls = "") => `<span class="cpNone"><i class="${cls}" style="background:${c}"></i>${t}</span>`;
    $("cStLegend").innerHTML = sw("#1b1b1b", "fire station mapped in OpenStreetMap", "stDot") + (F2.burn.length ? sw(REG, gapsOn ? "regular fire, station within 15 km" : "regular fire (4 or more of 14 years)") : "") + (gapsOn && F2.gaps.length ? sw(F2.show === "yes" ? GAP : GAP_MUTED, `regular fire, ${NO_STATION}`) : "") + (F2.steady.size ? sw(STEADY, "heat that looks like flares or industry: left out") : "");
    let folded = [], cut = [];
    fig.hidden = $("cStLegend").hidden = empty;
    if (!empty) {
      const listed2 = S3.stations.length, coarse3 = matchMedia("(pointer: coarse)").matches, idle = `${coarse3 ? "Tap" : "Point at"} a square for its numbers.` + (S3.stations_subset ? ` The dots are the ${fmt(listed2)} stations nearest to some square, of ${fmt(S3.stations_total)} mapped.` : ""), paint = () => drawMini(box2, d, {
        layers: layers2,
        points: S3.stations.map((s2) => [s2[0], s2[1]]),
        marks,
        label: `Map of ${tn}: fire stations mapped in OpenStreetMap and the squares with regular fire`,
        caption: $("cStPick"),
        idle,
        pick: (c) => {
          const pos = posOf(d, c), why = F2.steady.get(c);
          if (why !== void 0) return `<b>${pos.text}</b>: ${esc8(whyOf(S3, why)[0])}. Left out of the gaps.`;
          const p = byCell.get(c);
          if (!p) return null;
          const isGap = gapsOn && F2.gapSet.has(c), flag = (isGap && desert(S3.country, pos.lat, pos.lon) ? ` ${DESERT_FLAG}` : "") + (solarCell(pos.lat, pos.lon) ? ` ${SOLAR_FLAG}` : "");
          return `<b>${pos.text}</b>: fire in ${p.by} of the 14 years 2012\u20132025 (VIIRS), ${perYear(p.fpy)}. ${nearest(S3, p, F2.gapSet.has(c))}` + (isGap ? ` That is beyond 15 km: ${NO_STATION}.` : "") + flag;
        }
      });
      let r = paint();
      const wide = r.aspect > 1.8;
      if (grid2.classList.contains("wide") !== wide) {
        grid2.classList.toggle("wide", wide);
        r = paint();
      }
      folded = r.folded;
      cut = r.cut;
      empty = F2.burn.length + F2.steady.size < MIN_MAP_SQUARES2 && r.cellPx < 2;
    }
    fig.hidden = $("cStLegend").hidden = empty;
    if (empty) {
      box2.innerHTML = $("cStPick").innerHTML = $("cStLegend").innerHTML = "";
      grid2.classList.add("wide");
      folded = cut = [];
    }
    list2(S3, d, F2, top, gapsOn, folded, cut, empty);
    caveats(S3, d, F2, top, gapsOn);
  }
  var words = (xs) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  function list2(S3, d, F2, top, gapsOn, folded, cut, noMap) {
    const show = $("cStShow");
    show.hidden = F2.show !== "ask" || F2.gaps.length === 0;
    show.textContent = V3.reveal ? "Hide the uncertain gaps" : `Show the ${fmt(F2.gaps.length)} uncertain gap${F2.gaps.length === 1 ? "" : "s"} anyway`;
    const gl = $("cStGapBox");
    gl.hidden = !gapsOn || !top.length;
    if (!gl.hidden) {
      const dz = top.map((p) => {
        const pos = posOf(d, p.c);
        return desert(S3.country, pos.lat, pos.lon);
      }), allDesert = dz.every(Boolean);
      $("cStListT").textContent = `Places with regular fire and ${NO_STATION}`;
      $("cStListS").innerHTML = (top[0].by >= 7 ? "Among places that burned in at least 7 of the 14 years, the most fire first." : "These burned in 4 to 6 of the 14 years; the most fire first.") + (allDesert ? ` <span class="stFlag">${DESERT_FLAG}</span>` : dz.some(Boolean) ? ` <span class="stFlag">Places marked \u201Cin the desert\u201D are unverified: their detections may be gas flares or industrial heat that FIRMS did not flag.</span>` : "");
      let group2 = top[0].by < 7;
      $("cStList").innerHTML = top.map((p, i) => {
        const pos = posOf(d, p.c), head = !group2 && p.by < 7 ? (group2 = true, `<li class="stGrp">Then places that burned in 4 to 6 of the 14 years</li>`) : "", flags = (dz[i] && !allDesert ? `<small class="stFlag">In the desert: unverified</small>` : "") + (solarCell(pos.lat, pos.lon) ? `<small class="stFlag">${SOLAR_FLAG}</small>` : ""), osm = `https://www.openstreetmap.org/?mlat=${pos.lat.toFixed(3)}&mlon=${pos.lon.toFixed(3)}#map=11/${pos.lat.toFixed(3)}/${pos.lon.toFixed(3)}`;
        return head + `<li><span class="stN${F2.show === "yes" ? "" : " muted"}">${i + 1}</span><span class="stW"><b>${pos.text}</b><small>Burned in ${p.by} of the 14 years 2012\u20132025 (VIIRS) \xB7 ${perYear(p.fpy)}</small><small>${nearest(S3, p, true)}</small>${flags}<small><a href="${osm}" target="_blank" rel="noopener">Check the place on OpenStreetMap</a></small></span></li>`;
      }).join("");
      $("cStListNote").textContent = (F2.gaps.length > top.length ? `The ${fmt(top.length)} at the top of ${fmt(F2.gaps.length)}. ` : "") + (noMap ? "" : (folded.length ? `On the map, ${folded.length === 1 ? "number" : "numbers"} ${words(folded)} ${folded.length === 1 ? "sits" : "sit"} under a nearby mark, counted in its \u201C+n\u201D. ` : "") + (cut.length ? `${cut.length === 1 ? "Number" : "Numbers"} ${words(cut)} ${cut.length === 1 ? "is" : "are"} not marked on a narrow screen. ` : "")) + (F2.show === "yes" ? noteOf(S3) : "");
    }
    const nb = F2.burn.length, beyond = (p) => F2.gapSet.has(p.c) || p.km1 > 15, bands = [
      ["Within 15 km", (p) => p.km1 >= 0 && !beyond(p)],
      ["15 to 50 km", (p) => p.km1 >= 0 && beyond(p) && p.km1 <= 50],
      ["50 to 100 km", (p) => p.km1 > 50 && p.km1 <= 100],
      ["Over 100 km", (p) => p.km1 > 100],
      ["No station mapped in the country", (p) => p.km1 < 0]
    ];
    $("cStDistBox").hidden = nb === 0;
    $("cStDist").innerHTML = nb ? `<tr><th>Nearest mapped station</th><th>Places</th><th>Share</th></tr>` + bands.map(([label, f]) => {
      const k = F2.burn.filter(f).length;
      return k || label !== "No station mapped in the country" ? `<tr><td>${label}</td><td>${fmt(k)}</td><td>${pc2(k / nb)}</td></tr>` : "";
    }).join("") : "";
    $("cStDistNote").textContent = F2.show === "no" && S3.completeness.level !== "unpopulated" ? "With so few stations mapped, these distances mostly show how much of the map is missing." : "Places with fire in at least 4 of the 14 years; heat that looks like flares or industry is left out.";
  }
  function caveats(S3, d, F2, top, gapsOn) {
    const counts = /* @__PURE__ */ new Map();
    for (const code of F2.steady.values()) {
      const t2 = whyOf(S3, code)[1];
      counts.set(t2, (counts.get(t2) || 0) + 1);
    }
    const steady = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t2, n]) => `${fmt(n)} ${t2}`), deserts = F2.show !== "no" && anyDesert(S3, d, F2.gaps), solarShown = gapsOn && top.some((p) => {
      const pos = posOf(d, p.c);
      return solarCell(pos.lat, pos.lon);
    });
    let t = `<b>Read with care.</b> A gap means ${NO_STATION}, not that no station exists: OpenStreetMap is never complete. Stations across a border are not counted, so near a border a distance can be too long. `;
    if (steady.length)
      t += `Squares whose heat looks like flares or industry are left out (${steady.join("; ")}); the filter can also catch some real burning. `;
    if (deserts)
      t += `In the Arabian Peninsula and the Sahara the gaps are unverified: their detections may come from gas flares, drilling or industrial heat that FIRMS did not flag. `;
    if (SOLAR.has(S3.country))
      t += solarShown ? `Large solar plants can show up as daytime heat that the satellite reads as fire. The listed places where a recheck found almost no detections at night are marked. ` : `Some of the regular-fire squares here may be large solar plants, which show up as daytime heat. `;
    if (top.length && d.cell >= 0.5)
      t += `A square here is ${across(d)}, so a station near its edge can still be more than 15 km from its middle. `;
    $("cStCaveats").innerHTML = t.trim();
  }
  function stEvents() {
    $("cStRetry").onclick = () => {
      if (V3.k && V3.d) load2();
    };
    $("cStShow").onclick = () => {
      if (!V3.S || !V3.d) return;
      V3.reveal = !V3.reveal;
      figures2(V3.S, V3.d, facts(V3.S, V3.d));
      draw2();
    };
  }
  var stLoad = (k) => loadChecked(stationsPath(k), (x) => isStations(x, k));
  function stGlance(S3, d) {
    const F2 = facts(S3, d), nb = F2.burn.length, ng = F2.gaps.length, lv = S3.completeness.level, tn = theName(S3.name);
    return {
      stations: fmt(S3.stations_total),
      gaps: nb === 0 ? "No regular fire" : F2.show === "yes" ? `${fmt(ng)} of ${fmt(nb)} places` : F2.show === "ask" ? "Map patchy" : lv === "unpopulated" ? "Few people live here" : "Map too thin",
      gapsTitle: nb === 0 ? "No place burned in 4 or more of the 14 years." : F2.show === "yes" ? `Places with fire in 4 or more of 2012\u20132025 and no fire station mapped in OpenStreetMap within 15 km. A gap means none is mapped, not that none exists.` + (anyDesert(S3, d, F2.gaps.slice(0, 10)) ? " In the desert some may be industrial heat." : "") : F2.show === "ask" ? `OpenStreetMap's fire stations look patchy in ${tn}, so its gaps are uncertain; the full record lists them on request.` : lv === "unpopulated" ? "Few people live here, so the full record does not look for gaps." : `Too few fire stations are mapped in OpenStreetMap in ${tn} to judge where they are missing.`,
      facts: F2
    };
  }
  function stCell(S3, d, c, F2 = facts(S3, d)) {
    if (c >= F2.n) return null;
    const km12 = S3.cell_rows[8 * c + 4], s1 = S3.cell_rows[8 * c + 1], gap = F2.show === "yes" && F2.gapSet.has(c), has = km12 >= 0 && s1 >= 0, pos = posOf(d, c), lv = S3.completeness.level;
    return {
      burnYears: S3.cell_rows[8 * c + 7],
      km: has ? gap && km12 < 15.5 ? "just over 15 km" : km2(km12) : null,
      station: has ? stationName(S3, s1) : "",
      gap,
      steady: F2.steady.has(c),
      note: !has ? "" : F2.show === "ask" ? "OpenStreetMap's stations look patchy here, so this distance partly measures the map." : F2.show === "no" && lv !== "unpopulated" ? "With this little mapped, the distance mostly measures the map, not the fire service." : "",
      flag: gap && desert(S3.country, pos.lat, pos.lon) ? DESERT_FLAG : solarCell(pos.lat, pos.lon) ? SOLAR_FLAG : ""
    };
  }

  // src/country.ts
  var CV = { k: null, d: null, R: null, yFrom: 2001, yTo: 2025, focus: [2025, 0], mode: "count", mapKey: "" };
  var SENSOR_FROM = { T: 2e3, V: 2012, N20: 2018 };
  var SENSORS = [
    /* MODIS in greys, VIIRS in blues; red is kept for the year being tested */
    { s: "T", name: "Terra", c: "#1b1b1b" },
    { s: "A", name: "Aqua", c: "#8a8478", dash: "5,4" },
    { s: "V", name: "Suomi NPP", c: "#2166ac" },
    { s: "N20", name: "NOAA-20", c: "#4393c3", dash: "5,4" }
  ];
  var esc9 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var pc3 = (x) => x == null ? "n/a" : Math.round(x * 100) + "%";
  var nHot4 = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  var epochs = (d) => ({
    vi0: (d.viirs_from[0] - d.y0) * 12 + d.viirs_from[1] - 1,
    aq0: (d.aqua_from[0] - d.y0) * 12 + d.aqua_from[1] - 1,
    bins: d.bins
  });
  var viirsYear2 = (d) => d.viirs_from[0];
  var ordinal2 = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  var the = theName;
  var cap3 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  var nMonths = (d) => d.n_months ?? (d.y1 - d.y0 + 1) * 12;
  var partOf = (d) => d.partial ? { i: d.partial.i, y: d.partial.y, m: d.partial.m - 1, day: d.partial.day1 } : null;
  var lastWords2 = (d) => {
    const p = partOf(d);
    return p ? `${p.day} ${MON[p.m]} ${p.y}` : `31 Dec ${d.y1}`;
  };
  var yrs = () => {
    const p = CV.d ? partOf(CV.d) : null;
    if (p && CV.yTo >= p.y) return CV.yFrom === CV.yTo ? `${CV.yTo} to ${p.day} ${MON[p.m]}` : `${CV.yFrom}\u2013${lastWords2(CV.d)}`;
    return CV.yFrom === CV.yTo ? String(CV.yFrom) : `${CV.yFrom}\u2013${CV.yTo}`;
  };
  function sameDays(d) {
    const y = d.y2026, p = partOf(d);
    if (!y || !p) return null;
    const sd = y.same_days, years = [];
    for (let k = sd.years[0]; k <= sd.years[1]; k++) years.push(k);
    return { span: partSpan(p.m, p.day), cur: sd.cur, lo: sd.cur_lo, hi: sd.cur_hi, years, past: sd.V, med: sd.V_stats.median };
  }
  function ytdOf(d) {
    const y = d.y2026, p = partOf(d);
    if (!y || !p) return null;
    const t = y.ytd, years = [];
    for (let k = t.years[0]; k <= t.years[1]; k++) years.push(k);
    return {
      span: `1 Jan\u2013${p.day} ${MON[p.m]}`,
      withPart: true,
      y: p.y,
      cur: t.cur,
      lo: t.cur_lo,
      hi: t.cur_hi,
      years,
      past: t.V,
      med: t.V_stats.median,
      rank: t.rank,
      n: t.V.length + 1
    };
  }
  function convNote(d, i) {
    const g = d.y2026?.hist_gaps?.find((x) => x.i === i);
    if (g)
      return `${g.days.length} ${g.days.length === 1 ? "day" : "days"} (${g.days.join(", ")} ${MON[i % 12]}) of Suomi NPP outage, filled from NOAA-20 converted to Suomi NPP terms: ${fmt(g.filled)}, likely ${fmt(g.lo)} to ${fmt(g.hi)} (the archive's Suomi NPP count alone is ${fmt(g.v2)})`;
    const c = d.y2026?.conv_months.find((x) => x.i === i);
    if (!c) return "";
    const days = c.days, run = days.length > 1 && days[days.length - 1] - days[0] === days.length - 1 ? `${days[0]}\u2013${days[days.length - 1]}` : days.join(", ");
    const it = c.interp_days ?? [], parts = [
      days.length ? `${days.length} ${days.length === 1 ? "day" : "days"} (${run} ${MON[c.m - 1]}) from NOAA-20, converted to Suomi NPP terms: ${nHot4(c.v_conv)}` : "",
      it.length ? `${it.join(", ")} ${MON[c.m - 1]} estimated from the days either side, because both satellites missed ${the(d.name)}'s overpasses: ${nHot4(c.v_interp ?? 0)}` : ""
    ].filter(Boolean);
    return `${parts.join("; ")}; ${fmt(c.v)} in all, likely ${fmt(c.v_lo)} to ${fmt(c.v_hi)} for the month`;
  }
  var longDate = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return y && m && d ? `${d} ${MONL[m - 1]} ${y}` : iso.slice(0, 10);
  };
  var VOLCANIC = /* @__PURE__ */ new Set(["Iceland"]);
  var coarse2 = () => matchMedia("(pointer: coarse)").matches;
  function stepped2(title, cols, breaks, max) {
    if (!breaks.length)
      return `<b>${title}</b><div class="cpKey"><div class="cpStep"><i style="background:${cols[0]}"></i><span>${short(max)}</span></div></div>`;
    return `<b>${title}</b><div class="cpKey">` + cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${short(max)}</span></div></div>`;
  }
  function monthRun(ms) {
    const s2 = ms.slice().sort((a, b) => a - b);
    if (s2.length > 1 && s2.every((m, i) => i === 0 || m === s2[i - 1] + 1)) return `${MON[s2[0]]}\u2013${MON[s2[s2.length - 1]]}`;
    if (s2.length === 3 && s2[0] === 0 && s2[2] === 11 && (s2[1] === 1 || s2[1] === 10)) return s2[1] === 1 ? `Dec\u2013${MON[1]}` : `${MON[10]}\u2013Jan`;
    return s2.map((m) => MON[m]).join(", ");
  }
  var countryKey = () => CV.k || null;
  function openCountry(k) {
    if (CV.k === k && CV.d) return;
    areasReset();
    CV.k = k;
    CV.d = CV.R = null;
    CV.mapKey = "";
    loadFonts();
    const el = $("country");
    el.hidden = false;
    el.scrollTop = 0;
    $("cName").textContent = nameOf(k);
    $("cCrumb").textContent = "Fire, month by month";
    requestAnimationFrame(() => el.classList.add("in"));
    fcOpen(k);
    stOpen(k);
    load3();
    olOpen(k);
  }
  function closeCountry() {
    if (CV.k === null) return;
    CV.k = null;
    CV.mapKey = "";
    areasReset();
    olClose();
    fcClose();
    stClose();
    destroyMap();
    const el = $("country");
    el.classList.remove("in");
    el.hidden = true;
  }
  function countryMissing(slug, at = "#c/") {
    CV.k = "";
    CV.d = CV.R = null;
    areasReset();
    olClose();
    fcClose();
    stClose();
    destroyMap();
    loadFonts();
    const el = $("country");
    el.hidden = false;
    el.classList.add("in");
    $("cName").textContent = "No such country";
    $("cCrumb").textContent = "Fire, month by month";
    $("cBody").hidden = $("cCtl").hidden = true;
    $("cStatus").hidden = false;
    $("cBar").parentElement.hidden = $("cRetry").hidden = true;
    $("cMsg").textContent = `Nothing lives at "${at}${slug}". Go back to the globe and pick a country there, or search for one by name.`;
  }
  function load3() {
    const k = CV.k, name = nameOf(k);
    $("cBody").hidden = $("cCtl").hidden = true;
    $("cStatus").hidden = false;
    $("cRetry").hidden = true;
    $("cBar").parentElement.hidden = false;
    $("cBar").style.width = "0";
    $("cMsg").textContent = `Fetching ${name}'s record from Hugging Face\u2026`;
    loadMapLib().catch(() => void 0);
    loadPlotLib().catch(() => void 0);
    loadSummary(k, (got, total2) => {
      if (CV.k !== k) return;
      const mb = (n) => (n / 1e6).toFixed(n < 1e5 ? 2 : 1) + " MB";
      if (total2 && got <= total2) {
        $("cBar").style.width = got / total2 * 100 + "%";
        $("cMsg").textContent = `Fetching ${name}'s record from Hugging Face\u2026 ${mb(got)} of ${mb(total2)}`;
      } else $("cMsg").textContent = `Fetching ${name}'s record from Hugging Face\u2026 ${mb(got)}`;
    }).then((d) => {
      if (CV.k !== k) return;
      CV.d = d;
      start3(d);
    }).catch((e) => {
      if (CV.k !== k) return;
      $("cBar").parentElement.hidden = true;
      $("cMsg").textContent = `${name}'s record did not arrive from Hugging Face. ${e instanceof Error ? e.message : String(e)}.`;
      $("cRetry").hidden = false;
    });
  }
  function start3(d) {
    const yo = [];
    for (let y = d.y0; y <= d.y1; y++) yo.push(`<option>${y}</option>`);
    $("cTo").innerHTML = $("cfY").innerHTML = yo.join("");
    $("cFrom").innerHTML = yo.slice(0, (partOf(d) ? partOf(d).y - 1 : d.y1) - d.y0 + 1).join("");
    CV.yFrom = d.y0;
    CV.yTo = d.y1;
    $("cFrom").value = String(d.y0);
    $("cTo").value = String(d.y1);
    const p = partOf(d), last = p ? p.i - 1 : nMonths(d) - 1;
    CV.focus = [d.y0 + Math.floor(last / 12), last % 12];
    $("cStatus").hidden = true;
    $("cBody").hidden = $("cCtl").hidden = false;
    $("cName").textContent = d.name;
    renderCountry();
    areasStart(d);
    fcStart(d);
    stStart(d);
  }
  var FILL_SRC2 = "VIIRS Suomi NPP + NOAA-20 on days Suomi NPP missed, converted";
  function harmFilled(d, ep) {
    const y26 = d.y2026, p = partOf(d), gaps = new Map((y26?.hist_gaps ?? []).map((g) => [g.i, g])), conv = new Map((y26?.conv_months ?? []).map((c) => [c.i, c])), i26 = p && y26 ? p.i - (y26.v_obs.length - 1) : Infinity;
    return (i, t, a, v) => {
      const g = gaps.get(i);
      if (g) return { h: g.filled, lo: g.lo, hi: g.hi, src: FILL_SRC2 };
      const x = harmWith(d, ep, i, t, a, v);
      if (i >= i26 && y26 && conv.has(i)) return { h: v, lo: y26.v_lo[i - i26], hi: y26.v_hi[i - i26], src: FILL_SRC2 };
      return x;
    };
  }
  function renderCountry() {
    const d = CV.d;
    if (!d) return;
    const ep = epochs(d), R = analyseSeries({
      T: d.monthly.T,
      A: d.monthly.A,
      V: d.monthly.V,
      y0: d.y0,
      yFrom: CV.yFrom,
      yTo: CV.yTo,
      vi0: ep.vi0,
      nm: nMonths(d),
      partI: partOf(d)?.i ?? -1,
      partMed: sameDays(d)?.med ?? null,
      harm: harmFilled(d, ep)
    });
    CV.R = R;
    $("cCrumb").textContent = `Fire, month by month \xB7 ${yrs()}`;
    $("cLead").textContent = lead(d, R);
    $("cDate").textContent = (d.partial ? `Fire detections from NASA satellites, ${d.y0} to ${longDate(d.last_date)}; ${d.partial.y} is not over, so it is counted \u201Cso far\u201D and compared only with the same dates of past years. ` : `Fire detections from NASA satellites, ${d.y0}\u2013${d.y1}. `) + `Years before ${viirsYear2(d)} come from an older satellite and are adjusted to match. ` + (d.partial ? `Archive as of ${longDate(d.source.firms_updated)}; ${d.partial.y} from the FIRMS API.` : `Data as of ${longDate(d.source.firms_updated)}.`) + (d.v === 2 ? ` 2026 so far could not be loaded from Hugging Face, so this shows ${d.y0}\u2013${d.y1} only. Reload the page to try again.` : "");
    answers(R);
    const key = `${d.country}|${CV.yFrom}|${CV.yTo}`;
    if (key !== CV.mapKey) {
      CV.mapKey = key;
      drawMap2(d);
    }
    method(d);
    calendarText(d, R);
    chartText(d, R);
    drawCharts2();
  }
  function lead(d, R) {
    const name = the(d.name);
    if (R.any === 0) return `No vegetation fire hotspots were counted in ${name} in ${yrs()}.`;
    const t2 = R.partYear ? ytdOf(d) : null;
    if (R.total === 0)
      return `No vegetation fire hotspots were counted in ${name} in the complete years chosen.` + (t2 ? " " + ytdSentence(t2) : "");
    const peak = R.order[0].m, w = R.ranked[0], full = R.years.filter((y) => !y.part), a = full[0]?.y ?? CV.yFrom, b = full[full.length - 1]?.y ?? CV.yTo;
    let t = `${cap3(name)} burns most in ${MONL[peak]}.`;
    if (full.length > 2 && R.mean > 0)
      t += ` ${w.y} was its worst ${a === d.y0 && b === (partOf(d) ? partOf(d).y - 1 : d.y1) ? "complete year on record" : `year between ${a} and ${b}`}, with ${times(w.h / R.mean)} the hotspots of an average year.`;
    if (t2) t += " " + ytdSentence(t2);
    const jc = d.y2026?.join_check_2025;
    if (t2 && jc?.warn)
      t += ` Read ${t2.y} here with care: run on 2025, the method used for ${t2.y} came out ${Math.abs(jc.V_pct).toFixed(0)}% ${jc.V_pct > 0 ? "higher" : "lower"} than the archive.`;
    if (VOLCANIC.has(d.country)) t += ` Most of these detections are lava from eruptions, which the satellites cannot tell apart from fire.`;
    if (CV.yFrom < viirsYear2(d) && d.val.monthly_wape != null && d.val.monthly_wape > 1)
      t += ` Treat the years before ${viirsYear2(d)} as rough: tested on years VIIRS saw, converted months were off by ${pc3(d.val.monthly_wape)} on average.`;
    return t;
  }
  function answers(R) {
    const d = CV.d, t2 = R.partYear ? ytdOf(d) : null;
    if (R.total === 0) {
      $("ca1").textContent = $("ca2").textContent = "None";
      $("ca1n").textContent = $("ca2n").textContent = "No hotspots in these years.";
    } else {
      const top = R.order.slice(0, 3).filter((o) => o.sum > 0), worst = R.ranked.slice(0, 3).filter((y) => y.h > 0), quiet2 = R.order.filter((o) => o.sum === 0), share2 = Math.round(top.reduce((a, o) => a + o.sum, 0) / R.total * 100);
      $("ca1").textContent = monthRun(top.map((o) => o.m));
      $("ca1n").textContent = (top.length === 1 ? `Every hotspot fell in ${MONL[top[0].m]}.` : `${top.length === 2 ? "These two months" : "These three months"} hold ${share2}% of all hotspots.`) + (quiet2.length > 1 ? ` ${quiet2.length} months had none in these years.` : ` ${MONL[R.order[11].m]} is the quietest${quiet2.length ? ", with none" : ""}.`);
      const vy = viirsYear2(CV.d), est = worst.some((y) => y.y < vy);
      $("ca2").textContent = worst.map((y) => y.y).join(", ");
      $("ca2n").innerHTML = worst.map((y) => `<span class="cpRow">${y.y} \xB7 ${fmt(y.h)}${y.y < vy ? "*" : ""}</span>`).join("") + `<span class="cpRow">An average year: ${fmt(R.mean)}</span>` + (t2 ? `<span class="cpRow">${t2.y} so far (${t2.span}): ${fmt(t2.cur)}, ${rankWords(t2.rank, t2.n)} for the same dates</span>` : "") + (est ? `<span class="cpRow cpFn">* estimated from the older satellite</span>` : "");
    }
    const v = verdict(R, CV.focus, sameDays(d)), vi0 = epochs(d).vi0, fi = (CV.focus[0] - d.y0) * 12 + CV.focus[1];
    $("cfM").value = String(CV.focus[1]);
    $("cfY").value = String(CV.focus[0]);
    if (!v && fi >= nMonths(d)) {
      $("ca3").textContent = "No data yet";
      $("ca3n").textContent = `The record runs to ${longDate(d.last_date ?? `${d.y1}-12-31`)}. Pick an earlier month.`;
    } else if (!v) {
      $("ca3").textContent = "Outside the chosen years";
      $("ca3n").textContent = "Pick a month inside the years chosen at the top.";
    } else if (v.noSame) {
      $("ca3").textContent = "Not over yet";
      $("ca3n").textContent = `${cap3(nHot4(v.f.h))} so far. A month that is not over cannot be set against whole months.`;
    } else if (v.same && v.same.cur === 0 && v.same.past.every((x) => x === 0)) {
      $("ca3").textContent = "No hotspots";
      $("ca3n").textContent = `No hotspots in ${v.same.span} in any year, so there is nothing to compare.`;
    } else if (v.same) {
      const sd = v.same;
      $("ca3").innerHTML = `<span class="${v.cls}">${esc9(v.label)}</span><small>${esc9(v.mult)}</small>`;
      $("ca3n").textContent = `${MONL[v.fm]} ${v.fy} is not over. ${cap3(nHot4(sd.cur))} in ${sd.span}` + (sd.hi - sd.lo >= 1 ? ` (likely ${fmt(sd.lo)} to ${fmt(sd.hi)})` : "") + ` against a normal ${fmt(sd.med)} for the same days of ${sd.years[0]}\u2013${sd.years[sd.years.length - 1]}; ${v.rank === 1 ? "the busiest" : v.rank === v.n ? "the quietest" : `the ${ordinal2(v.rank)} busiest`} of ${v.n}. Suomi NPP stopped on 2 November, so most of these days are NOAA-20 converted to Suomi NPP terms; past days Suomi NPP missed are filled the same way.`;
    } else if (R.ser.every((r) => r.m !== v.fm || r.h === 0)) {
      $("ca3").textContent = "No hotspots";
      $("ca3n").textContent = `No hotspots in ${MONL[v.fm]} in any of these years, so there is nothing to compare.`;
    } else {
      $("ca3").innerHTML = `<span class="${v.cls}">${esc9(v.label)}</span><small>${esc9(v.mult)}</small>`;
      $("ca3n").textContent = `${cap3(nHot4(v.f.h))} against a normal ${fmt(v.med)}; ${v.rank === 1 ? "the busiest" : v.rank === v.n ? "the quietest" : `the ${ordinal2(v.rank)} busiest`} of ${v.n} ${MONL[v.fm]}s.` + (v.f.i < vi0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : convNote(d, v.f.i) ? ` Seen by VIIRS (Suomi NPP), with ${convNote(d, v.f.i)}.` : " Seen directly by VIIRS.");
    }
  }
  function calendarText(d, R) {
    const peaks = new Array(12).fill(0);
    let n = 0;
    for (const y of R.years) {
      if (y.part) continue;
      const rows = R.ser.filter((r) => r.y === y.y);
      const top = rows.reduce((a, r) => r.h > a.h ? r : a, rows[0]);
      if (top.h > 0) {
        peaks[top.m]++;
        n++;
      }
    }
    const pm2 = peaks.indexOf(Math.max(...peaks)), most = R.total > 0 ? R.order[0].m : pm2;
    $("cCalTitle").textContent = n <= 2 ? CV.yFrom === CV.yTo ? `Every month of ${CV.yFrom}` : `Every month from ${CV.yFrom} to ${CV.yTo}` : pm2 === most || peaks[pm2] > n / 2 ? `${MONL[pm2]} was the busiest month in ${peaks[pm2]} of ${n} years` : `${MONL[most]} has the most fire in total, but the busiest month moves from year to year`;
    $("cCalSub").textContent = CV.yFrom === CV.yTo ? `${CV.yFrom}, by month.` : `${CV.yFrom} to ${CV.yTo}, newest at the top.`;
    document.querySelectorAll("#cModeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === CV.mode)));
    const vy = viirsYear2(d);
    const pt = partOf(d), toWords = pt && CV.yTo >= pt.y ? lastWords2(d) : String(CV.yTo);
    $("cCalTopH").textContent = CV.yTo >= vy ? `Seen by VIIRS, ${Math.max(vy, CV.yFrom)}\u2013${toWords}` : "";
    $("cCalBotH").textContent = CV.yFrom < vy ? `Converted from MODIS, ${CV.yFrom}\u2013${Math.min(vy - 1, CV.yTo)}` : "";
    $("cCalNote").textContent = (CV.mode === "count" ? `The outlined month is the one tested at the top; click any month to test it instead.` : `Each month against the median of the same month in ${yrs()}. Click any month to test it.`) + (R.partYear && pt ? ` ${pt.y} runs to ${pt.day} ${MONL[pt.m]}: the dashed ${MONL[pt.m]} is not over and is compared with the same days of past years, December is blank because it has not happened, and the starred total is so far. Months with days Suomi NPP missed use NOAA-20 for those days, converted; hover for which.` : "");
    const cc = calendarClasses(R);
    $("cCalLegend").innerHTML = CV.mode === "count" ? cc.max > 0 ? `<div>${stepped2("Hotspots in a month", cc.colours, cc.breaks, cc.max)}</div><span class="cpNone"><i></i>none</span>` : "" : `<div class="cpRamp"><span>\xBC of normal</span><i style="background:linear-gradient(90deg,#2166ac,#67a9cf,#d1e5f0,#f7f7f7,#fddbc7,#ef8a62,#b2182b)"></i><span>4\xD7 normal</span></div><span>white: a normal month</span>`;
  }
  function chartText(d, R) {
    const st = R.stats, meds = st.map((s2) => s2.med), pk = meds.indexOf(Math.max(...meds)), lo = meds.indexOf(Math.min(...meds)), fy = CV.focus[0], span3 = yrs(), top = R.order.slice(0, 3).filter((o) => o.sum > 0), topShare = R.total > 0 ? top.reduce((a, o) => a + o.sum, 0) / R.total : 0;
    $("cMonthsT").textContent = R.total === 0 ? "No month stands out" : meds[lo] >= 10 && meds[pk] / meds[lo] >= 1.5 ? `A typical ${MONL[pk]} has ${times(meds[pk] / meds[lo])} the hotspots of a typical ${MONL[lo]}` : topShare >= 0.5 && top.length > 1 ? `${topShare >= 0.8 ? "Almost all" : "Most"} of the fire in ${the(d.name)} comes in ${monthRun(top.map((o) => o.m))}; a typical ${MONL[lo]} has ${meds[lo] === 0 ? "none" : nHot4(meds[lo])}` : meds[pk] > 0 ? `A typical ${MONL[pk]} brings ${nHot4(meds[pk])}; ${meds[lo] === 0 ? `a typical ${MONL[lo]}, none` : "the other months are close behind"}` : `Most months pass with no hotspots at all`;
    $("cMonthsS").textContent = `Hotspots per month, ${span3}, with ${fy} in red. ` + (R.partYear && fy === R.partYear.y ? `Complete months only: ${MONL[partOf(d).m]} is not over. ` : "") + `Click a month to test it.`;
    const w = R.ranked[0];
    $("cYearsT").textContent = R.total === 0 ? "No year stands out" : R.years.length > 1 && R.mean > 0 ? `${w.y} was the worst year, at ${times(w.h / R.mean)} the average` : `${fmt(w.h)} hotspots in ${w.y}`;
    $("cYearsS").textContent = `Hotspots per year, with ${fy} in red. Paler bars are estimated from the older satellite, with a line for the likely range.` + (R.partYear ? ` The dashed bar is ${R.partYear.y} so far, to ${lastWords2(d)}; it is not ranked against whole years.` : "");
    const fyRow = R.years.find((y) => y.y === fy), rank = fyRow ? R.ranked.indexOf(fyRow) + 1 : 0, t2 = fyRow?.part ? ytdOf(d) : null;
    $("cCumT").textContent = !fyRow || R.any === 0 ? "How each year adds up" : fyRow.part ? t2 ? `${fy} so far: ${fmt(t2.cur)} hotspots by ${t2.span.replace("1 Jan\u2013", "")}, ${rankWords(t2.rank, t2.n)} for the same dates` : `${fy} so far: ${fmt(fyRow.h)} hotspots to ${lastWords2(d)}` : rank === 1 ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the most of any year` : rank === R.years.length ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the fewest of ${R.years.length} years` : `${fy} ended with ${fmt(fyRow.h)} hotspots, the ${ordinal2(rank)} most of ${R.years.length} years`;
    $("cCumS").textContent = `Running total of hotspots from January, one line per year.` + (R.partYear ? ` ${R.partYear.y}'s line stops at ${lastWords2(d).replace(/ \d+$/, "")}; compare it with the other lines at the same point.` : "");
    const ys = R.years.filter((y) => !y.part), avg = (a, b, k) => {
      const r = ys.filter((y) => y.y >= a && y.y <= b);
      return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
    };
    const n0 = avg(2007, 2011, "naive"), n1 = avg(2012, 2016, "naive"), h0 = avg(2007, 2011, "h"), h1 = avg(2012, 2016, "h");
    const can = n0 != null && h0 != null && n1 != null && h1 != null && n0 > 0 && h0 > 0;
    $("cSeamT").textContent = can ? `Joined raw, 2012 looks like a ${(n1 / n0).toFixed(1)}\xD7 jump. Harmonized, it is ${(h1 / h0).toFixed(1)}\xD7` : "Raw counts against the harmonized record";
    $("cSeamNote").textContent = can ? `Average hotspots a year, 2012\u20132016 against 2007\u20132011. The jump in the raw line is the change of satellite, not more fire.` : n0 === 0 || h0 === 0 ? "MODIS counted no hotspots here in 2007\u20132011, so the step at 2012 cannot be measured." : "The dashed line jumps in 2012 only because the sensor changed. Choose years from 2007 to 2016 or wider to measure the step.";
    const none = R.any === 0;
    $("cCharts").hidden = $("cRawFig").hidden = none;
    $("cNoFire").hidden = !none;
    $("cNoFire").textContent = none ? `No fire was detected in ${the(d.name)} in ${span3}, so there is nothing to chart.` : "";
  }
  function chartsFailed() {
    const msg = `<p class="cpMapMsg" style="position:static">The charts did not load (cdnjs or jsdelivr did not answer). The numbers above are unaffected; reload to try again.</p>`;
    ["cCal", "cMonths", "cYears", "cCum", "cSeam", "cRaw"].forEach((id) => $(id).innerHTML = msg);
    $("cCal2").innerHTML = "";
  }
  function drawCharts2() {
    const d = CV.d, R = CV.R;
    if (!d || !R) return;
    if (!window.Plot || !window.d3) {
      const k = CV.k;
      ["cCal", "cMonths", "cYears", "cCum", "cSeam", "cRaw"].forEach((id) => {
        if (!$(id).firstChild) $(id).innerHTML = `<p class="cpCap">Drawing\u2026</p>`;
      });
      loadPlotLib().then(
        () => CV.k === k && drawCharts2(),
        () => CV.k === k && chartsFailed()
      );
      return;
    }
    const N20 = d.monthly.N20, y26 = d.y2026 && d.partial ? d.y2026 : null, vy = viirsYear2(d), pick2 = (y, m) => {
      CV.focus = [y, m];
      renderCountry();
    };
    calendar($("cCal"), $("cCal2"), R, {
      mode: CV.mode,
      focus: CV.focus,
      viirsYear: vy,
      tip: (r) => {
        const cn = convNote(d, r.i), k = r.i - (y26 ? partOf(d).i - (y26.v_obs.length - 1) : 0), obs = y26 && k >= 0 && k < y26.v_obs.length ? y26.v_obs[k] : null;
        return (r.part ? `${MONL[r.m]} ${r.y}, ${partSpan(r.m, partOf(d).day)} so far: ${nHot4(r.h)}
Normal for the same days: ${fmt(r.med)}` : `${MONL[r.m]} ${r.y}: ${nHot4(r.h)}
Normal for ${MONL[r.m]}: ${fmt(r.med)}`) + (Number.isFinite(r.ratio) && (r.med > 0 || r.h > 0) ? ` (${times(r.ratio)} normal)` : "") + `
${r.src}` + (r.i < epochs(d).vi0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "") + (cn ? `
Includes ${cn}` : "") + (obs != null ? `
Raw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(obs)} (its complete days), NOAA-20 ${fmt(N20[r.i])}${cn ? " (used only for the days Suomi NPP missed)" : " (not used)"}` : `
Raw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(r.V)}, NOAA-20 ${fmt(N20[r.i])}${cn ? " (used only for the days Suomi NPP missed)" : " (not used)"}`) + `
Click to test this month`;
      },
      click: (r) => pick2(r.y, r.m)
    });
    seasonal($("cMonths"), R, CV.focus[0], (m) => pick2(CV.focus[0], m));
    annual($("cYears"), R, {
      viirsYear: vy,
      focusYear: CV.focus[0],
      tip: (y) => {
        if (y.part) {
          const t2 = ytdOf(d);
          return `${y.y} so far, to ${lastWords2(d)}: ${nHot4(y.h)}` + (t2 ? `
${rankWords(t2.rank, t2.n)} for ${t2.span} (typical ${fmt(t2.med)})` : "") + `
Not ranked against whole years
Click to test ${MONL[CV.focus[1]]} ${y.y}`;
        }
        return `${y.y}: ${nHot4(y.h)}` + (R.mean > 0 ? `
${y.h >= R.mean ? "+" : ""}${Math.round((y.h / R.mean - 1) * 100)}% against the average year` : "") + (y.y < vy ? `
Estimated from MODIS, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "\nSeen by VIIRS") + `
Click to test ${MONL[CV.focus[1]]} ${y.y}`;
      },
      click: (y) => pick2(y, CV.focus[1])
    });
    const pp = partOf(d);
    cumulative($("cCum"), R, CV.focus[0], pp && d.partial ? { frac: pp.day / d.partial.days_in_month, label: `${pp.day} ${MON[pp.m]}` } : null);
    seam($("cSeam"), R, vy);
    const from = { ...SENSOR_FROM, A: d.aqua_from[0] }, xs = R.years.filter((y) => !y.part).map((y) => y.y);
    sensorLines(
      $("cRaw"),
      xs,
      SENSORS.map((z) => ({
        name: z.name,
        c: z.c,
        dash: z.dash,
        v: xs.map((y) => {
          if (y < from[z.s]) return NaN;
          const i = (y - d.y0) * 12;
          return d.monthly[z.s].slice(i, i + 12).reduce((a, b) => a + b, 0);
        })
      }))
    );
  }
  function mapMsg(text2) {
    $("cMap").innerHTML = `<p class="cpMapMsg">${esc9(text2)}</p>`;
  }
  function drawMap2(d) {
    const data = mapData(d, CV.yFrom, CV.yTo), k = d.country;
    $("cMapLegend").innerHTML = data.n ? `<div>${stepped2("Hotspots per square", classColours(data.breaks), data.breaks, data.max)}</div>` : "";
    const vals = data.cells.features.map((f) => f.properties.n).sort((a, b) => b - a), tot = vals.reduce((a, b) => a + b, 0);
    let acc = 0, k50 = 0;
    for (const v of vals) {
      acc += v;
      k50++;
      if (acc >= tot / 2) break;
    }
    const share2 = vals.length ? k50 / vals.length * 100 : 0;
    $("cMapTitle").textContent = tot > 0 && vals.length >= 10 ? `Half of all hotspots fell in ${share2 < 1 ? "under 1" : Math.round(share2)}% of the squares that burned` : "Where it burns";
    $("cMapSub").textContent = `Hotspots counted in each ${d.cell}\xB0 square (about ${Math.round(d.cell * 111)} km across), ${yrs()}.`;
    const name = the(d.name);
    $("cMapNote").innerHTML = data.n ? (coarse2() ? "Tap a square for its numbers. Use two fingers to move and zoom." : "Hover over a square for its numbers. Use the buttons, or Ctrl/\u2318 and scroll, to zoom.") + (data.cropped ? ` <button class="cpText cpSmall" id="cMapAll" type="button">Show all of ${esc9(name)}</button>` : "") + `<span id="cMapBase"></span>` : `No hotspots were counted anywhere in ${esc9(name)} in these years, so the map has no squares.<span id="cMapBase"></span>`;
    const all = document.getElementById("cMapAll");
    if (all) all.onclick = fitAll;
    const go2 = () => {
      if (CV.k !== k || !CV.d) return;
      showMap($("cMap"), d, data, CV.yFrom, CV.yTo, mapMsg, () => {
        const b = document.getElementById("cMapBase");
        if (b && CV.k === k) b.textContent = " The background map did not load, so only the squares and the outline are shown.";
      });
    };
    if (window.maplibregl) go2();
    else {
      mapMsg("Loading the map\u2026");
      loadMapLib().then(go2, () => {
        if (CV.k === k) mapMsg("The map did not load (cdnjs did not answer). The numbers on this page are unaffected; reload to try again.");
      });
    }
  }
  function method(d) {
    const val = d.val;
    const item2 = (v, t) => `<div><dt>${v}</dt><dd>${t}</dd></div>`;
    $("cTiles").innerHTML = item2(
      val.raw_factor == null ? "n/a" : val.raw_factor.toFixed(1) + "\xD7",
      `more hotspots from VIIRS than MODIS for the same fires in ${esc9(the(d.name))}, 2012\u20132025`
    ) + item2(pc3(val.annual_med_err), "typical error of a converted year, tested on years we could check") + item2(pc3(val.annual_max_err), "error in the worst tested year") + item2(pc3(val.monthly_wape), "typical error of a converted month, weighted by size");
    $("cRateNote").textContent = d.rate_note;
    const y26 = d.y2026, p = partOf(d), jc = y26?.join_check_2025;
    $("cSatRule").textContent = p ? SAT_RULE : "Suomi NPP only from 2012; NOAA-20 is not added, which would count the same fires twice.";
    $("c2026").hidden = !y26;
    $("c2026").textContent = y26 ? `2026, to ${longDate(d.last_date)}: from the FIRMS API (standard processing to July, near real time after), counted with the same filter. ${y26.mask_note.split(" The task first asked")[0]} ` + (jc ? `Rerun on 2025, this 2026 method differed from the published 2025 count for ${the(d.name)} by ${jc.V_pct >= 0 ? "+" : "\u2212"}${Math.abs(jc.V_pct).toFixed(1)}%` + (jc.warn ? `, more than the 5% most countries stay within, so read ${p.y} against past years with that in mind.` : ".") : "") : "";
    $("cLimits").textContent = p ? `Limits. The record runs to ${longDate(d.last_date)}, the last complete day; ${p.y} is a partial year, counted \u201Cso far\u201D and compared only with the same dates in past years, and ${MONL[p.m]} ${p.y} covers days 1\u2013${p.day}. Converted months are estimates and small countries are noisy: MODIS misses many small fires, so a converted zero can hide real burning. Suomi NPP outages from 2018 on are filled from NOAA-20 the same way as in ${p.y} (the published file keeps the archive's Suomi NPP count and gives the filled one alongside); earlier gaps and cloud are not corrected. A hotspot is one satellite pixel that looked like fire, not a fire count or burned area.` : `Limits. The record ends in December ${d.y1}. Converted months are estimates and small countries are noisy: MODIS misses many small fires, so a converted zero can hide real burning. Satellite outages and cloud are not corrected. A hotspot is one satellite pixel that looked like fire, not a fire count or burned area.`;
    $("cFilter").textContent = d.filter;
    $("cCell").textContent = `${d.cell}\xB0`;
    const row2 = (label, a) => `<tr><td>${label}</td>${a.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
    $("cRates").innerHTML = `<tr><th>VIIRS per MODIS hotspot</th>${MON.map((m) => `<th>${m}</th>`).join("")}</tr>` + row2("Terra+Aqua", d.r_ta) + row2("90% low", d.r_ta_lo) + row2("90% high", d.r_ta_hi) + row2("Terra only", d.r_t);
    $("cLoyo").innerHTML = `<tr><th>Held-out year</th><th>Seen by VIIRS</th><th>Predicted from MODIS</th><th>Raw MODIS</th><th>Error</th></tr>` + val.loyo.map(
      (r) => `<tr><td>${Number(r.y)}</td><td>${fmt(r.obs)}</td><td>${fmt(r.pred)}</td><td>${fmt(r.modis)}</td><td>${r.obs > 0 ? (r.pred >= r.obs ? "+" : "") + Math.round((r.pred / r.obs - 1) * 100) + "%" : "n/a"}</td></tr>`
    ).join("");
    const path = pathOf(d), url = fileUrl(path);
    $("cSrc").innerHTML = `Data: <a href="${esc9(url)}" target="_blank" rel="noopener">${esc9(path)}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built from ${d.source.files} FIRMS files (latest FIRMS update ${esc9(d.source.firms_updated.slice(0, 10))}). We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">https://earthdata.nasa.gov/firms</a>), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (<a href="https://earthdata.nasa.gov/lance" target="_blank" rel="noopener">https://earthdata.nasa.gov/lance</a>) and NASA's Earth Science Data and Information System (ESDIS). Outlines: Natural Earth.`;
  }
  function csv3() {
    const d = CV.d, R = CV.R;
    if (!d || !R) return;
    const N20 = d.monthly.N20, p = partOf(d), conv = new Map((d.y2026?.conv_months ?? []).map((c) => [c.i, c])), rows = [
      "year,month,month_status,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs,noaa20_days_used_converted,noaa20_converted_snpp_terms,days_estimated_from_neighbours,estimated_snpp_terms"
    ];
    const gaps = new Map((d.y2026?.hist_gaps ?? []).map((g) => [g.i, g]));
    R.ser.forEach((r) => {
      const c = conv.get(r.i), g = gaps.get(r.i), k = p && d.y2026 ? r.i - (p.i - (d.y2026.v_obs.length - 1)) : -1, in26 = k >= 0 && !!d.y2026 && k < d.y2026.v_obs.length;
      rows.push(
        [
          r.y,
          r.m + 1,
          r.part ? `partial_to_${d.last_date}` : "complete",
          r.h.toFixed(2),
          (in26 ? d.y2026.v_lo[k] : r.lo).toFixed(2),
          (in26 ? d.y2026.v_hi[k] : r.hi).toFixed(2),
          `"${c || g ? FILL_SRC2 : r.src}"`,
          r.T,
          r.A,
          /* Suomi NPP as observed: in 2026 on the days it is used; for a past outage month, the whole month as archived */
          in26 ? d.y2026.v_obs[k] : r.V,
          N20[r.i],
          c ? `"${c.days.join(" ")}"` : g ? `"${g.days.join(" ")}"` : "",
          c ? c.v_conv : g ? g.n20_conv : "",
          c?.interp_days ? `"${c.interp_days.join(" ")}"` : "",
          c?.interp_days ? c.v_interp ?? "" : ""
        ].join(",")
      );
    });
    save(`burn-calendar_${d.country}_${CV.yFrom}-${CV.yTo}.csv`, rows.join("\n"), $("cDlMsg"));
  }
  function countryEvents() {
    $("cBack").onclick = () => {
      location.hash = "";
    };
    $("cRetry").onclick = () => {
      if (CV.k) load3();
    };
    $("cFrom").onchange = $("cTo").onchange = (e) => {
      let a = +$("cFrom").value, b = +$("cTo").value;
      if (a > b) {
        if (e.target === $("cFrom")) b = a;
        else a = b;
      }
      CV.yFrom = a;
      CV.yTo = b;
      CV.focus = [Math.min(b, Math.max(a, CV.focus[0])), CV.focus[1]];
      $("cFrom").value = String(a);
      $("cTo").value = String(b);
      renderCountry();
    };
    $("cfM").innerHTML = MON.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    $("cfM").onchange = $("cfY").onchange = () => {
      CV.focus = [+$("cfY").value, +$("cfM").value];
      renderCountry();
    };
    document.querySelectorAll("#cModeSeg button").forEach(
      (b) => b.onclick = () => {
        CV.mode = b.dataset.mode === "anom" ? "anom" : "count";
        renderCountry();
      }
    );
    $("cDl").onclick = csv3;
    olEventsWorld();
    fcEvents();
    stEvents();
    let rt2, lastW2 = 0;
    addEventListener("resize", () => {
      clearTimeout(rt2);
      rt2 = setTimeout(() => {
        const w = $("cBody").clientWidth;
        if (!CV.d || $("country").hidden || w === lastW2) return;
        lastW2 = w;
        drawCharts2();
        fcResize();
      }, 150);
    });
  }

  // src/extras.ts
  var FILES = ["response.js?v=1", "forecast.js?v=3", "outlook.js?v=1", "pop.js?v=1"];
  var loading2 = null;
  var ready = false;
  var extrasReady = () => ready;
  function loadExtras() {
    if (!loading2)
      loading2 = Promise.all(
        FILES.map(
          (src) => new Promise((done) => {
            const el = document.createElement("script");
            el.src = src;
            el.async = true;
            el.addEventListener("load", () => done());
            el.addEventListener("error", () => done());
            document.head.appendChild(el);
          })
        )
      ).then(() => {
        ready = true;
      });
    return loading2;
  }

  // src/glance.ts
  var STYLE4 = "https://tiles.openfreemap.org/styles/dark";
  var FALLBACK2 = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#05070c" } }] };
  var RAMP2 = ["#5c1420", "#8e1c1f", "#c2301b", "#e8531b", "#fd8d3c", "#feb24c", "#ffe08a"];
  var TONES = ["#6fa8ff", "#c9a3ff", "#7fd1ae", "#ffd166"];
  var DROP2 = /^(highway_name|road_oneway|aeroway|railway)/;
  var LATIN2 = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ["get", "name"]];
  var esc10 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var cap4 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  var deg6 = (v, p, n) => `${Math.abs(v).toFixed(2)}\xB0${v < 0 ? n : p}`;
  var row = (dt, dd, title = "") => `<div${title ? ` title="${esc10(title)}"` : ""}><dt>${dt}</dt><dd>${dd}</dd></div>`;
  var nHot5 = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  var SHEET_Q = "(max-width: 760px), (max-width: 900px) and (orientation: portrait)";
  var isSheet = () => matchMedia(SHEET_Q).matches;
  var EST = "* estimated from the older satellite";
  var G = {
    k: null,
    d: null,
    R: null,
    F: null,
    S: null,
    fcMsg: "",
    stMsg: "",
    year: null,
    sel: -1,
    marks: [],
    map: null,
    ready: false,
    byKey: null,
    lon0: 0,
    yearScale: null
  };
  var mapSeq = 0;
  var glanceKey = () => G.k || null;
  function openGlance(k) {
    const el = $("glance");
    if (G.k === k) {
      el.hidden = false;
      G.map?.resize();
      return;
    }
    closeGlance();
    mapSeq++;
    G.k = k;
    G.year = null;
    G.sel = -1;
    G.marks = [];
    G.lon0 = shapeOf(k)?.c[0] ?? 0;
    el.hidden = false;
    $("gName").textContent = nameOf(k);
    $("gCrumb").textContent = "Country";
    $("gLead").textContent = `Fetching ${theName(nameOf(k))}'s record from Hugging Face\u2026`;
    $("gRows").innerHTML = "";
    $("gPick").hidden = $("gNote").hidden = true;
    $("gBar").hidden = true;
    $("gRetry").hidden = true;
    $("gStates").hidden = k !== "United_States";
    $("gHint").textContent = "";
    $("gCard").scrollTop = 0;
    requestAnimationFrame(() => el.classList.add("in"));
    trackSheet();
    startMap(k);
    load4(k);
  }
  function closeGlance() {
    if (G.k === null) return;
    mapSeq++;
    G.k = null;
    G.d = G.R = G.F = G.S = null;
    G.byKey = null;
    G.yearScale = null;
    G.ready = false;
    try {
      G.map?.remove();
    } catch {
    }
    G.map = null;
    $("gMap").innerHTML = "";
    const el = $("glance");
    el.classList.remove("in");
    el.hidden = true;
  }
  function load4(k) {
    $("gRetry").hidden = true;
    loadSummary(k, (got, total2) => {
      if (G.k !== k || G.d) return;
      const mb = (n) => (n / 1e6).toFixed(n < 1e5 ? 2 : 1) + " MB";
      $("gLead").textContent = `Fetching ${theName(nameOf(k))}'s record from Hugging Face\u2026 ${mb(got)}${total2 && got <= total2 ? ` of ${mb(total2)}` : ""}`;
    }).then((d) => {
      if (G.k !== k) return;
      G.d = d;
      G.byKey = /* @__PURE__ */ new Map();
      const { la, lo } = cellIndexes(d);
      for (let c = 0; c < la.length; c++) G.byKey.set(la[c] + "|" + lo[c], c);
      G.lon0 = centreLon(d, lo);
      const one = [];
      for (let r = 2; r < d.cell_rows.length; r += 5) one.push(d.cell_rows[r]);
      G.yearScale = classBreaks(one);
      G.R = analyse(d);
      $("gName").textContent = d.name;
      setupYears(d);
      renderCard2();
      drawCells(true);
      extras(k);
    }).catch((e) => {
      if (G.k !== k) return;
      $("gLead").textContent = `${nameOf(k)}'s record did not arrive from Hugging Face. ${e instanceof Error ? e.message : String(e)}.`;
      $("gRetry").hidden = false;
    });
  }
  function extras(k) {
    G.fcMsg = G.stMsg = "Loading\u2026";
    fcLoad(k).then(
      (F2) => {
        if (G.k !== k) return;
        G.F = F2;
        renderCard2();
      },
      () => {
        if (G.k !== k) return;
        G.fcMsg = "Did not load";
        renderCard2();
      }
    );
    stLoad(k).then(
      (S3) => {
        if (G.k !== k) return;
        G.S = S3;
        renderCard2();
      },
      () => {
        if (G.k !== k) return;
        G.stMsg = "Did not load";
        renderCard2();
      }
    );
  }
  function analyse(d) {
    const ep = epochs(d);
    return analyseSeries({
      T: d.monthly.T,
      A: d.monthly.A,
      V: d.monthly.V,
      y0: d.y0,
      yFrom: d.y0,
      yTo: d.y1,
      vi0: ep.vi0,
      nm: nMonths(d),
      partI: partOf(d)?.i ?? -1,
      partMed: sameDays(d)?.med ?? null,
      harm: harmFilled(d, ep)
    });
  }
  function spanWords(d) {
    const p = partOf(d);
    return p ? `${d.y0}\u2013${p.day} ${MON[p.m]} ${p.y}` : `${d.y0}\u2013${d.y1}`;
  }
  var yearWords = (d, y) => {
    if (y == null) return spanWords(d);
    const p = partOf(d);
    return p && y === p.y ? `${y} to ${p.day} ${MON[p.m]}` : String(y);
  };
  function soFarWords(t, unsure) {
    if (t.cur === 0 && t.med === 0) return `None so far in ${t.y}, as in a typical year to the same date.`;
    const busier2 = !unsure && t.rank <= t.n / 3 && t.lo > t.med, quieter = !unsure && t.rank > 2 * t.n / 3 && t.hi < t.med;
    return `${t.y} so far: ${nHot5(t.cur)}, ${rankWords(t.rank, t.n)} for the same dates (typical ${fmt(t.med)})` + (busier2 ? ", busier than typical." : quieter ? ", quieter than typical." : ".");
  }
  function renderCard2() {
    const d = G.d, R = G.R;
    if (!d || !R) return;
    const name = theName(d.name), t2 = R.partYear ? ytdOf(d) : null, est = (y) => y < d.viirs_from[0];
    $("gCrumb").textContent = `Country \xB7 ${spanWords(d)}`;
    const top = R.order.slice(0, 3).filter((o) => o.sum > 0), w = R.ranked[0];
    let lead2;
    const jc = d.y2026?.join_check_2025;
    if (R.any === 0) lead2 = `No vegetation fire hotspots were counted in ${name}, ${spanWords(d)}.`;
    else {
      lead2 = R.total === 0 ? `No vegetation fire hotspots were counted in ${name} in the complete years.` : `${cap4(name)} burns most in ${MONL[R.order[0].m]}; its worst complete year was ${w.y}.`;
      if (t2) lead2 += " " + soFarWords(t2, !!jc?.warn);
      if (t2 && jc?.warn)
        lead2 += ` Read ${t2.y} here with care: run on 2025, the method used for ${t2.y} came out ${Math.abs(jc.V_pct).toFixed(0)}% ${jc.V_pct > 0 ? "higher" : "lower"} than the archive.`;
      if (VOLCANIC.has(d.country)) lead2 += " Most of these detections are lava from eruptions, which the satellites cannot tell apart from fire.";
    }
    $("gLead").textContent = lead2;
    const rows = [];
    rows.push(row("Busiest months", top.length ? monthRun(top.map((o) => o.m)) : "None"));
    rows.push(
      row(
        `Worst complete year${w && w.h > 0 && est(w.y) ? ` <small>${EST}</small>` : ""}`,
        w && w.h > 0 ? `${w.y}${est(w.y) ? "*" : ""} \xB7 ${short(w.h)}` : "None",
        w ? `${fmt(w.h)} hotspots in ${w.y}${est(w.y) ? ", estimated from the older MODIS satellite" : ""}` : ""
      )
    );
    if (t2)
      rows.push(
        row(
          `${t2.y} so far <small>${t2.span}</small>`,
          `${short(t2.cur)} <small>typical ${short(t2.med)}</small>`,
          `${nHot5(t2.cur)}${t2.hi - t2.lo >= 1 ? `, likely ${fmt(t2.lo)} to ${fmt(t2.hi)}` : ""}, ${rankWords(t2.rank, t2.n)} for the same dates`
        )
      );
    if (G.F) {
      const f = fcGlance(G.F, d);
      if (!f) rows.push(row("Forecast for 2026", "Nothing to forecast", "No fire on record from 2001 to 2025"));
      else {
        if (f.soFar) rows.push(row(f.soFar.label, f.soFar.value, f.soFar.title));
        rows.push(row(f.chance.label, f.chance.value, f.chance.title));
        if (f.vs) rows.push(row(`2026 against the forecast${f.vs.note ? ` <small>${f.vs.note}</small>` : ""}`, f.vs.value, f.vs.title));
      }
    } else rows.push(row("Forecast for 2026", G.fcMsg || "Loading\u2026"));
    if (G.S) {
      const s2 = stGlance(G.S, d);
      rows.push(row("Fire stations mapped", s2.stations, "Fire stations in OpenStreetMap"));
      rows.push(row("No station within 15 km", s2.gaps, s2.gapsTitle));
    } else rows.push(row("Fire stations", G.stMsg || "Loading\u2026"));
    $("gRows").innerHTML = rows.join("");
    $("gHint").textContent = (matchMedia("(pointer: coarse)").matches ? "Tap" : "Click") + " a square for its numbers. Move the slider to see one year.";
    pickCard();
    noteCard();
  }
  function pickCard() {
    const d = G.d, c = G.sel;
    if (!d || c < 0) {
      $("gPick").hidden = true;
      return;
    }
    const { la, lo } = cellIndexes(d), s2 = la[c] * d.cell, w = lo[c] * d.cell, p = partOf(d), full = p ? p.y - 1 : d.y1;
    let all = 0, inYear = 0, best = -1, bestN = 0, burned = 0, n26 = 0;
    for (let r = 0; r < d.cell_rows.length; r += 5) {
      if (d.cell_rows[r] !== c) continue;
      const y = d.y0 + d.cell_rows[r + 1], n = d.cell_rows[r + 2];
      all += n;
      if (G.year === y) inYear += n;
      if (y === 2026) n26 += n;
      if (y <= full) {
        if (n > 0) burned++;
        if (n > bestN) {
          bestN = n;
          best = y;
        }
      }
    }
    const rows = [];
    if (G.year != null) rows.push(row(`Hotspots, ${yearWords(d, G.year)}`, fmt(inYear)));
    rows.push(row(`Hotspots, ${spanWords(d)}`, fmt(all)));
    const est = best > 0 && best < d.viirs_from[0];
    if (best > 0) rows.push(row(`Worst year here${est ? ` <small>${EST}</small>` : ""}`, `${best}${est ? "*" : ""} \xB7 ${fmt(bestN)}`));
    rows.push(row("Years with fire", `${burned} of ${full - d.y0 + 1}`, `Complete years ${d.y0}\u2013${full}`));
    const fc = G.F && fcCellOk(G.F, d, c) ? fcCell(G.F, c) : null, has26 = !!p && p.y === 2026;
    if (fc) {
      if (has26 && n26 > 0)
        rows.push(
          row(
            "2026 so far",
            `${nHot5(n26)} <small>forecast gave it ${fcPc(fc.p)}</small>`,
            `Made before 2026 from 2001\u20132025, the forecast gave this square a ${fcPc(fc.p)} chance of a hotspot in 2026; fire came in ${fcPc(fc.share)} of 2001\u20132025.`
          )
        );
      else
        rows.push(
          row(
            `Forecast chance of fire in 2026 <small>made before 2026${has26 ? "; none so far" : ""}</small>`,
            fcPc(fc.p),
            `Fire came in ${fcPc(fc.share)} of 2001\u20132025.`
          )
        );
    }
    const st = G.S ? stCell(G.S, d, c) : null;
    if (st)
      rows.push(
        row(
          "Nearest mapped fire station",
          st.km ? `${st.km}${st.gap ? ' <span class="gGap">gap</span>' : ""}` : "None mapped",
          st.station ? `Nearest: ${st.station}${st.gap ? ". No station is mapped in OpenStreetMap within 15 km; that does not mean none exists." : ""}` : ""
        )
      );
    const notes = [st?.note, st?.flag].filter(Boolean).join(" ");
    $("gPick").innerHTML = `<div class="gPickHead"><p class="eyebrow">Square you picked</p><button class="link" type="button" id="gPickX">Clear</button></div><h3>${deg6(s2 + d.cell / 2, "N", "S")}, ${deg6(w + d.cell / 2, "E", "W")}</h3><p class="hint">A ${d.cell}\xB0 square, about ${Math.round(d.cell * 111)} km across.${st?.steady ? " Its heat looks like flares or industry, not fire." : ""}</p><dl class="mini">${rows.join("")}</dl>` + (notes ? `<p class="hint">${esc10(notes)}</p>` : "");
    $("gPick").hidden = false;
    $("gPickX").onclick = () => pick(-1);
  }
  function noteCard() {
    const d = G.d, box2 = $("gNote");
    if (!G.marks.length) {
      box2.hidden = true;
      return;
    }
    const names = G.marks.map(
      (m, i) => `<span class="gTone${m.geometry ? " solid" : ""}" style="--t:${TONES[i % TONES.length]}"></span><b>${esc10(m.name)}</b>`
    );
    let sum2 = "";
    const one = G.marks.length === 1 ? G.marks[0] : null, b = one ? one.box : null;
    if (d && one && b) {
      const nb = boxNear2(b), off = nb[0] - b[0], rings = one.geometry ? ringsOf(one.geometry.coordinates) : [], { la, lo } = cellIndexes(d);
      let n = 0, k = 0;
      const inside = new Uint8Array(la.length);
      for (let c = 0; c < la.length; c++) {
        const y = (la[c] + 0.5) * d.cell, x = near((lo[c] + 0.5) * d.cell, G.lon0);
        if (x >= nb[0] && x <= nb[2] && y >= nb[1] && y <= nb[3] && (!rings.length || inRings(rings, x - off, y))) {
          inside[c] = 1;
          k++;
        }
      }
      for (let r = 0; r < d.cell_rows.length; r += 5) {
        if (!inside[d.cell_rows[r]]) continue;
        if (G.year != null && d.y0 + d.cell_rows[r + 1] !== G.year) continue;
        n += d.cell_rows[r + 2];
      }
      if (k)
        sum2 = `<p class="hint">${rings.length ? `Squares whose middle is in ${esc10(one.name)}` : "Squares inside the frame"}: ${nHot5(n)}, ${yearWords(d, G.year)}.</p>`;
    }
    box2.innerHTML = `<div class="gPickHead"><p class="eyebrow">From the copilot</p><button class="link" type="button" id="gNoteX">Clear</button></div><p class="gNames">${names.join(", ")}</p>${sum2}`;
    box2.hidden = false;
    $("gNoteX").onclick = () => glanceMarks([]);
  }
  function setupYears(d) {
    const r = $("gYear");
    r.min = String(d.y0);
    r.max = String(d.y1);
    r.value = String(d.y1);
    $("gBar").hidden = false;
    yearLabel();
  }
  function yearLabel() {
    const d = G.d;
    if (!d) return;
    $("gYearLabel").textContent = G.year == null ? `All years \xB7 ${spanWords(d)}` : yearWords(d, G.year);
    $("gAll").hidden = G.year == null;
    $("gBar").classList.toggle("all", G.year == null);
    $("gYear").setAttribute("aria-valuetext", G.year == null ? "All years" : String(G.year));
  }
  function setYear(y) {
    if (y === G.year) return;
    G.year = y;
    yearLabel();
    drawCells(false);
    pickCard();
    noteCard();
  }
  function tidy(st) {
    st.layers = st.layers.filter((l) => !DROP2.test(l.id)).map((l) => {
      if (l.layout && l.layout["text-field"] && /name/.test(JSON.stringify(l.layout["text-field"])))
        l.layout = { ...l.layout, "text-field": LATIN2 };
      if (l.type === "symbol" && /^place/.test(l.id))
        l.paint = { ...l.paint, "text-color": "#e4e9f1", "text-halo-color": "rgba(5,7,12,.88)", "text-halo-width": 1.4 };
      if (l.layout && l.layout["icon-image"]) {
        const { "icon-image": _icon, ...rest } = l.layout;
        l.layout = rest;
      }
      return l;
    });
    return st;
  }
  var styleP2 = null;
  function getStyle2() {
    if (!styleP2)
      styleP2 = Promise.race([
        fetch(STYLE4).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        }),
        new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8e3))
      ]).then(tidy, () => {
        styleP2 = null;
        return FALLBACK2;
      });
    return styleP2;
  }
  function shapeBox(k) {
    const s2 = shapeOf(k);
    if (!s2) return [-170, -60, 170, 75];
    const span3 = lonSpan(s2);
    if (s2.b[2] - s2.b[0] <= span3 + 1) return s2.b;
    return [s2.c[0] - span3 / 2, s2.b[1], s2.c[0] + span3 / 2, s2.b[3]];
  }
  function padding() {
    syncSheet();
    const host = $("gMap"), W = host.clientWidth, H = host.clientHeight, card2 = $("gCard").getBoundingClientRect(), bar = $("gBar").hidden ? null : $("gBar").getBoundingClientRect(), launch = document.querySelector(".askLaunch"), lr = launch && !launch.hidden ? launch.getBoundingClientRect() : null;
    const p = isSheet() ? {
      top: Math.max(112, bar ? bar.bottom + 12 : 0),
      left: 16,
      right: 16,
      /* above the sheet, and above the copilot's button that sits on it */
      bottom: Math.min(H * 0.6, Math.max(0, H - Math.min(card2.top, lr && lr.height ? lr.top : H))) + 12
    } : { top: 76, left: 64, right: Math.max(16, W - card2.left + 16), bottom: bar && bar.height ? Math.max(24, H - bar.top + 12) : 24 };
    if (p.left + p.right > W - 80) p.left = p.right = 16;
    if (p.top + p.bottom > H - 80) p.bottom = Math.max(16, H - 80 - p.top);
    return p;
  }
  function startMap(k) {
    const seq2 = mapSeq;
    Promise.all([loadMapLib(), getStyle2()]).then(
      ([, style2]) => {
        if (G.k !== k || seq2 !== mapSeq || G.map) return;
        const ml = window.maplibregl, host = $("gMap"), b = shapeBox(k);
        let map2;
        try {
          map2 = new ml.Map({
            container: host,
            style: style2,
            bounds: [b.slice(0, 2), b.slice(2)],
            fitBoundsOptions: { padding: padding() },
            maxZoom: 10,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            attributionControl: { compact: true },
            fadeDuration: 0
          });
        } catch {
          $("gMap").innerHTML = `<p class="gMapMsg">This browser could not start the map (WebGL is off). The card still has the numbers.</p>`;
          return;
        }
        G.map = map2;
        host._map = map2;
        map2.touchZoomRotate.disableRotation();
        map2.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        let swapped = style2 === FALLBACK2;
        map2.on("error", () => {
          setTimeout(() => {
            if (swapped || G.ready || G.map !== map2) return;
            swapped = true;
            map2.setStyle(FALLBACK2);
          }, 4e3);
        });
        map2.on("style.load", () => {
          if (G.map !== map2 || G.ready) return;
          layers(map2);
        });
      },
      () => {
        if (G.k === k && seq2 === mapSeq)
          $("gMap").innerHTML = `<p class="gMapMsg">The map did not load (cdnjs did not answer). The card still has the numbers.</p>`;
      }
    );
  }
  var EMPTY2 = { type: "FeatureCollection", features: [] };
  function layers(map2) {
    const under = map2.getLayer("boundary_state") ? "boundary_state" : void 0, labels = map2.getLayer("place_other") ? "place_other" : void 0;
    map2.addSource("cells", { type: "geojson", data: EMPTY2, tolerance: 0, buffer: 2, generateId: true });
    map2.addSource("outline", { type: "geojson", data: EMPTY2 });
    map2.addSource("sel", { type: "geojson", data: EMPTY2 });
    map2.addSource("ask", { type: "geojson", data: EMPTY2 });
    map2.addLayer(
      { id: "cells", type: "fill", source: "cells", paint: { "fill-color": RAMP2[3], "fill-opacity": 0.92, "fill-antialias": false } },
      under
    );
    map2.addLayer(
      {
        id: "cells-edge",
        type: "line",
        source: "cells",
        /* a hairline that closes the seams between squares without bleeding into the next one */
        paint: { "line-color": RAMP2[3], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 7, 0.5, 9, 0] }
      },
      under
    );
    map2.addLayer(
      {
        id: "cells-hover",
        type: "line",
        source: "cells",
        paint: { "line-color": "#fff", "line-width": 1.2, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0] }
      },
      labels
    );
    map2.addLayer(
      { id: "outline", type: "line", source: "outline", paint: { "line-color": "#dfe6f2", "line-width": 1.1, "line-opacity": 0.7 } },
      labels
    );
    map2.addLayer(
      {
        id: "sel",
        type: "line",
        source: "sel",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#fff", "line-width": 2.5 }
      },
      labels
    );
    map2.addLayer(
      {
        id: "sel-ring",
        type: "circle",
        source: "sel",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 2 }
      },
      labels
    );
    const isFrame = (v) => ["==", ["get", "frame"], v];
    map2.addLayer(
      { id: "ask-fill", type: "fill", source: "ask", filter: isFrame(0), paint: { "fill-color": ["get", "tone"], "fill-opacity": 0.12 } },
      labels
    );
    map2.addLayer(
      { id: "ask-line", type: "line", source: "ask", filter: isFrame(0), paint: { "line-color": ["get", "tone"], "line-width": 2.4 } },
      labels
    );
    map2.addLayer(
      {
        id: "ask-frame",
        type: "line",
        source: "ask",
        filter: isFrame(1),
        paint: { "line-color": ["get", "tone"], "line-width": 2.2, "line-dasharray": [3, 2] }
      },
      labels
    );
    G.ready = true;
    const host = map2.getContainer(), fold4 = () => host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    fold4();
    map2.once("idle", fold4);
    let hover = null;
    const clear = () => {
      if (hover != null) map2.setFeatureState({ source: "cells", id: hover }, { hover: false });
      hover = null;
    };
    map2.on("mousemove", "cells", (e) => {
      const f = e.features && e.features[0];
      if (!f || f.id === hover) return;
      clear();
      hover = f.id;
      map2.setFeatureState({ source: "cells", id: f.id }, { hover: true });
      map2.getCanvas().style.cursor = "pointer";
    });
    map2.on("mouseleave", "cells", () => {
      clear();
      map2.getCanvas().style.cursor = "";
    });
    map2.on("click", (e) => {
      const f = map2.queryRenderedFeatures(e.point, { layers: ["cells"] })[0];
      if (!f || !G.d || !G.byKey) return;
      const p = f.properties, c = G.byKey.get(Math.round(p.s / G.d.cell) + "|" + Math.round(p.w / G.d.cell));
      if (c != null) pick(c === G.sel ? -1 : c);
    });
    drawCells(true);
    drawMarks();
  }
  function drawCells(frame2) {
    const d = G.d;
    if (!d) return;
    const data = mapData(d, G.year ?? d.y0, G.year ?? d.y1), sc = G.year != null && G.yearScale ? G.yearScale : data, cols = classColours(sc.breaks, RAMP2);
    legend4(sc.breaks, sc.max, cols, data.n);
    if (!G.ready || !G.map) return;
    const map2 = G.map, fill = sc.breaks.length ? ["step", ["get", "n"], cols[0], ...sc.breaks.flatMap((b, i) => [b, cols[i + 1]])] : cols[0];
    map2.getSource("cells").setData(data.cells);
    map2.getSource("outline").setData(data.outline);
    map2.setPaintProperty("cells", "fill-color", fill);
    map2.setPaintProperty("cells-edge", "line-color", fill);
    if (frame2 && !G.marks.length) {
      const b = G.year == null ? data.bounds : mapData(d, d.y0, d.y1).bounds;
      map2.fitBounds([b.slice(0, 2), b.slice(2)], { padding: padding(), duration: 700 });
    }
  }
  function legend4(breaks, max, cols, n) {
    if (!n) {
      $("gLeg").innerHTML = `<span class="gLegT">No hotspots ${G.year == null ? "in these years" : "this year"}</span>`;
      return;
    }
    const steps = breaks.length ? cols.map((c, i) => `<span class="gStep"><i style="background:${c}"></i><small>${i ? short(breaks[i - 1]) : ""}</small></span>`).join("") + `<span class="gStep gEnd"><i></i><small>${short(max)}</small></span>` : `<span class="gStep"><i style="background:${cols[0]}"></i><small>${short(max)}</small></span>`;
    $("gLeg").innerHTML = `<span class="gLegT">${G.year == null ? "Hotspots per square, all years" : "Hotspots per square in a year, same scale for every year"}</span><span class="gKey">${steps}</span>`;
  }
  function pick(c) {
    G.sel = c;
    pickCard();
    if (c >= 0) $("gPick").scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!G.ready || !G.map || !G.d) return;
    const d = G.d, feats = [];
    if (c >= 0) {
      const { la, lo } = cellIndexes(d), s2 = la[c] * d.cell, w = near(lo[c] * d.cell + d.cell / 2, G.lon0) - d.cell / 2, e = w + d.cell, n = s2 + d.cell;
      feats.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [w, s2],
            [e, s2],
            [e, n],
            [w, n],
            [w, s2]
          ]
        }
      });
      feats.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [w + d.cell / 2, s2 + d.cell / 2] } });
    }
    G.map.getSource("sel").setData({ type: "FeatureCollection", features: feats });
  }
  var r22 = (x) => Math.round(x * 100) / 100;
  var boxNear2 = (b) => {
    const off = near((b[0] + b[2]) / 2, G.lon0) - (b[0] + b[2]) / 2;
    return [b[0] + off, b[1], b[2] + off, b[3]];
  };
  function shiftCoords2(c, off) {
    if (!Array.isArray(c)) return c;
    if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0] + off, c[1], ...c.slice(2)];
    return c.map((x) => shiftCoords2(x, off));
  }
  function ringsOf(c, out = []) {
    if (!Array.isArray(c) || !c.length) return out;
    if (Array.isArray(c[0]) && typeof c[0][0] === "number") out.push(c);
    else for (const x of c) ringsOf(x, out);
    return out;
  }
  function inRings(rings, x, y) {
    let inside = false;
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
    return inside;
  }
  var glanceCountry = () => G.k && G.ready && G.d ? G.k : null;
  function glanceView() {
    if (!glanceCountry()) return null;
    const m = G.map, c = m.getCenter(), b = m.getBounds(), shift = near(c.lng, 0) - c.lng;
    return {
      lat: r22(c.lat),
      lon: r22(c.lng + shift),
      zoom: r22(m.getZoom()),
      bbox: [
        r22(Math.max(-180, b.getWest() + shift)),
        r22(Math.max(-85, b.getSouth())),
        r22(Math.min(180, b.getEast() + shift)),
        r22(Math.min(85, b.getNorth()))
      ]
    };
  }
  function glanceFocus(b, pad2, maxZoom = 9) {
    if (!glanceCountry()) return false;
    const nb = boxNear2(b), p = padding(), host = $("gMap"), W = host.clientWidth, H = host.clientHeight;
    if (pad2.right < W / 2) p.right = Math.max(p.right, pad2.right + 24);
    if (pad2.bottom < H / 2) p.bottom = Math.max(p.bottom, pad2.bottom + 24);
    if (p.left + p.right > W - 60) p.left = p.right = 12;
    if (p.top + p.bottom > H - 60) {
      p.top = 12;
      p.bottom = Math.max(12, H - 72);
    }
    G.map.fitBounds([nb.slice(0, 2), nb.slice(2)], { padding: p, duration: 900, maxZoom });
    return true;
  }
  function glanceMarks(marks) {
    if (!G.k) return false;
    G.marks = marks;
    noteCard();
    if (!G.ready) return false;
    drawMarks();
    if (marks.length) $("gNote").scrollIntoView({ block: "nearest" });
    return true;
  }
  function drawMarks() {
    if (!G.ready || !G.map) return;
    const off = (b) => near((b[0] + b[2]) / 2, G.lon0) - (b[0] + b[2]) / 2;
    const features = G.marks.flatMap((mk, i) => {
      const tone2 = TONES[i % TONES.length];
      if (mk.geometry)
        return [
          {
            type: "Feature",
            properties: { name: mk.name, tone: tone2, frame: 0 },
            geometry: {
              type: mk.geometry.type,
              coordinates: mk.box ? shiftCoords2(mk.geometry.coordinates, off(mk.box)) : mk.geometry.coordinates
            }
          }
        ];
      if (!mk.box) return [];
      const [w, s2, e, n] = boxNear2(mk.box);
      return [
        {
          type: "Feature",
          properties: { name: mk.name, tone: tone2, frame: 1 },
          geometry: {
            type: "LineString",
            coordinates: [
              [w, s2],
              [e, s2],
              [e, n],
              [w, n],
              [w, s2]
            ]
          }
        }
      ];
    });
    try {
      G.map.getSource("ask").setData({ type: "FeatureCollection", features });
    } catch {
      G.map.getSource("ask").setData(EMPTY2);
    }
  }
  var sheetObs = null;
  function syncSheet() {
    const r = $("gCard").getBoundingClientRect();
    document.body.style.setProperty("--gSheet", isSheet() && !$("glance").hidden ? Math.round(innerHeight - r.top) + "px" : "0px");
  }
  function trackSheet() {
    if (sheetObs || typeof ResizeObserver === "undefined") return;
    sheetObs = new ResizeObserver(syncSheet);
    sheetObs.observe($("gCard"));
    addEventListener("resize", syncSheet);
    syncSheet();
  }
  var prevHash = null;
  function glanceEvents() {
    addEventListener("hashchange", (e) => {
      try {
        prevHash = new URL(e.oldURL).hash;
      } catch {
        prevHash = null;
      }
    });
    const up = (to) => {
      if (prevHash === to) history.back();
      else location.hash = to;
    };
    $("gBack").onclick = () => up("");
    $("gOpen").onclick = () => {
      if (G.k) location.hash = "#c/" + slugOf(G.k);
    };
    $("gRetry").onclick = () => {
      if (G.k) load4(G.k);
    };
    $("gAll").onclick = () => setYear(null);
    const r = $("gYear");
    let raf = 0;
    r.oninput = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setYear(+r.value));
    };
    r.addEventListener("pointerup", () => {
      if (G.year == null) setYear(+r.value);
    });
    r.addEventListener("keydown", (e) => {
      if (G.year == null && ["Enter", " ", "ArrowRight", "ArrowUp", "End"].includes(e.key) && r.value === r.max) setYear(+r.value);
    });
    document.querySelectorAll("#gStates button").forEach((b) => {
      const st = b.dataset.st;
      b.textContent = NAME[st];
      b.onclick = () => {
        location.hash = SLUG[st];
      };
    });
    const cUp = document.getElementById("cUp");
    if (cUp)
      cUp.onclick = () => {
        const m = /^#c\/(.+)$/.exec(location.hash);
        if (m) up("#g/" + m[1]);
      };
    addEventListener("resize", () => G.map?.resize());
  }

  // src/views.ts
  function openState(st, fresh2) {
    closeCountry();
    stopPlay();
    closeSheet(true);
    S.st = st;
    S.sel = { type: "state" };
    S.show = { t: "all" };
    S.layer = "count";
    S.odds = "past";
    S.fire = "any";
    respReset();
    V.mask = null;
    V.fineOn = false;
    S.focus = FOCUS0.slice();
    setDraw(false);
    $("hero").hidden = true;
    G2.stop && G2.stop();
    $("app").hidden = false;
    $("card").scrollTop = 0;
    scrollTo(0, 0);
    $("swap").textContent = "Switch to " + NAME[STS.find((k) => k !== st)];
    $("pal").value = S.pal;
    $("preset").textContent = PRESET[st].name;
    $("lat").value = $("lon").value = "";
    $("townList").innerHTML = hexState(st).towns.map((t) => `<option value="${t.n}">`).join("");
    mapSize();
    const f = fitView(hexState(st));
    V.fit = f.s;
    Object.assign(V, f, { s: f.s * (fresh2 ? 0.55 : 1) });
    render();
    if (!extrasReady())
      loadExtras().then(() => {
        if (S.st !== st) return;
        respReset();
        render();
      });
    requestAnimationFrame(() => {
      $("app").classList.add("in");
      if (fresh2) flyTo(f, 1100);
    });
  }
  function openHero() {
    stopPlay();
    S.st = null;
    $("app").classList.remove("in");
    $("app").hidden = true;
    const h2 = $("hero");
    h2.hidden = false;
    h2.classList.remove("leaving");
    if (G2.ok) G2.reset();
  }
  function go(st) {
    if (location.hash !== "#" + SLUG[st]) {
      G2.pending = "#" + SLUG[st];
      location.hash = SLUG[st];
    }
  }
  function goCountry(k, full = false) {
    const h2 = (full ? "#c/" : "#g/") + slugOf(k);
    if (location.hash !== h2) {
      G2.pending = h2;
      location.hash = h2;
    }
  }
  function leaveForCountry() {
    stopPlay();
    closeSheet(true);
    S.st = null;
    $("app").classList.remove("in");
    $("app").hidden = true;
    $("hero").hidden = true;
    G2.stop && G2.stop();
  }
  async function routeCountry(hash) {
    let raw = hash.slice(3).split("/")[0];
    try {
      raw = decodeURIComponent(raw);
    } catch {
    }
    const slug = slugOf(raw);
    let k = WORLD.find((c) => slugOf(c.k) === slug)?.k;
    if (!k) {
      k = await loadIndex().then((list4) => list4.find((c) => slugOf(c.country) === slug)?.country).catch(() => void 0);
      if (location.hash !== hash) return;
    }
    const shape = k ? shapeOf(k) : void 0;
    if (k && shape && G2.pending === hash && G2.ok && !$("hero").hidden) {
      const key = k, b = shape.b;
      G2.pending = null;
      G2.flyTo(aimAt(shape.c[0], shape.c[1], Math.min(lonSpan(shape), 180) * Math.cos(shape.c[1] * Math.PI / 180) + (b[3] - b[1])), () => {
        if (location.hash !== hash) return;
        leaveForCountry();
        openOne(hash, key);
      });
      return;
    }
    G2.pending = null;
    leaveForCountry();
    if (k) openOne(hash, k);
    else {
      closeGlance();
      countryMissing(slug, hash.slice(0, 3));
      $("cUp").hidden = true;
    }
  }
  function openOne(hash, k) {
    if (hash.startsWith("#g/")) {
      closeCountry();
      openGlance(k);
    } else {
      closeGlance();
      $("cUp").hidden = false;
      openCountry(k);
    }
  }
  function route() {
    if (location.hash.startsWith("#c/") || location.hash.startsWith("#g/")) {
      routeCountry(location.hash);
      return;
    }
    closeCountry();
    closeGlance();
    const st = STS.find((k) => "#" + SLUG[k] === location.hash);
    if (!st) {
      closeSheet(true);
      openHero();
      if (location.hash === "#compare") {
        openSheet("compare");
        if (!extrasReady())
          loadExtras().then(() => {
            if (S.sheet === "compare") render();
          });
      }
      return;
    }
    loadExtras();
    if (G2.pending === location.hash && G2.ok && !$("hero").hidden) {
      G2.pending = null;
      G2.flyTo({ ry: G2.st[st].ry, rx: G2.st[st].rx, z: 1.62 }, () => openState(st, true));
    } else {
      G2.pending = null;
      openState(st, !$("hero").hidden);
    }
  }

  // src/globe.ts
  var aimAt = (lon, lat, span3 = 0) => ({
    ry: -((lon + 360) % 360 - 360 + 90) * Math.PI / 180,
    rx: lat * Math.PI / 180,
    z: 1.62 + Math.min(0.9, span3 / 90)
  });
  var G2 = { ok: false, run: false };
  var loadImg = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  async function globeInit() {
    if (!window.THREE) throw new Error("three.js did not load");
    const imEarth = await loadImg(D.tex.earth);
    const T = THREE, cv = $("globe"), ren = new T.WebGLRenderer({ canvas: cv, antialias: false, alpha: false });
    ren.setPixelRatio(1);
    ren.setClearColor(0, 1);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.1, 200), grp = new T.Group();
    scene.add(grp);
    const v3 = (lon, lat, r) => {
      const p = (lon + 180) * Math.PI / 180, t = (90 - lat) * Math.PI / 180;
      return new T.Vector3(-r * Math.cos(p) * Math.sin(t), r * Math.cos(t), r * Math.sin(p) * Math.sin(t));
    };
    const tex = new T.Texture(imEarth);
    tex.needsUpdate = true;
    grp.add(new T.Mesh(new T.SphereGeometry(1, 96, 64), new T.MeshLambertMaterial({ map: tex })));
    scene.add(new T.AmbientLight(16777215, 0.5));
    const sun = new T.DirectionalLight(16777215, 1.05);
    sun.position.set(-3, 2.1, 3.6);
    scene.add(sun);
    const halo = new T.Mesh(
      new T.SphereGeometry(1.07, 64, 48),
      new T.ShaderMaterial({
        side: T.BackSide,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        vertexShader: "varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
        fragmentShader: "varying vec3 n;void main(){float f=pow(max(0.0,0.66-dot(n,vec3(0.0,0.0,1.0))),5.0);gl_FragColor=vec4(vec3(0.25,0.5,1.0)*f*2.4,1.0);}"
      })
    );
    scene.add(halo);
    const NS = 2600, sp = new Float32Array(NS * 3), sc3 = new Float32Array(NS * 3), ss = new Float32Array(NS), sph = new Float32Array(NS), d3 = new T.Vector3();
    const PAL = [
      [0.7, 0.78, 1],
      [1, 1, 1],
      [1, 0.95, 0.85],
      [1, 0.8, 0.6]
    ];
    for (let i = 0; i < NS; i++) {
      const a = Math.random() * 6.2832, z = 2 * Math.random() - 1, q = Math.sqrt(1 - z * z);
      d3.set(q * Math.cos(a), q * Math.sin(a), z);
      sp.set([d3.x * 90, d3.y * 90, d3.z * 90], i * 3);
      const mag = Math.pow(Math.random(), 5), lum = 0.35 + 0.65 * mag;
      sc3.set(
        PAL[Math.floor(Math.random() * 4)].map((c) => c * lum),
        i * 3
      );
      ss[i] = mag > 0.5 ? 3 : mag > 0.1 ? 2 : 1;
      sph[i] = Math.random();
    }
    const sg = new T.BufferGeometry();
    sg.setAttribute("position", new T.BufferAttribute(sp, 3));
    sg.setAttribute("col", new T.BufferAttribute(sc3, 3));
    sg.setAttribute("size", new T.BufferAttribute(ss, 1));
    sg.setAttribute("ph", new T.BufferAttribute(sph, 1));
    const starMat = new T.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      vertexShader: "attribute vec3 col;attribute float size;attribute float ph;uniform float t;varying vec3 c;void main(){c=col*(1.0+0.3*sin(t*(0.6+ph*1.4)+ph*40.0));gl_PointSize=size;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec3 c;void main(){gl_FragColor=vec4(c,1.0);}"
    });
    const stars = new T.Points(sg, starMat);
    stars.rotation.set(0.4, 0, 0.2);
    scene.add(stars);
    const fireM = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), fireMesh = new T.Mesh(new T.SphereGeometry(1.001, 128, 64), fireM);
    fireMesh.visible = false;
    grp.add(fireMesh);
    let fireStats = /* @__PURE__ */ new Map(), fireLo = 0, fireHi = 0, fireT0 = 0, fireLoading = false;
    const giveUp = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("Hugging Face took too long")), ms));
    function loadFire() {
      if (fireStats.size || fireLoading) return;
      fireLoading = true;
      $("heroWait").textContent = "Loading every country from Hugging Face\u2026";
      $("heroRetry").hidden = true;
      $("heroKey").hidden = false;
      Promise.race([loadIndex(), giveUp(15e3)]).then((idx) => {
        const L2 = buildFireLayer(idx);
        if (!L2.stats.size) throw new Error("The country index has no fire totals");
        const ft = new T.CanvasTexture(L2.canvas);
        ft.minFilter = T.LinearFilter;
        fireM.map = ft;
        fireM.needsUpdate = true;
        fireMesh.visible = true;
        fireStats = L2.stats;
        fireT0 = performance.now();
        fireLo = L2.lo;
        fireHi = L2.hi;
        fireMesh.visible = mode === "fire";
        if (mode === "fire") showKey(L2.lo, L2.hi);
        if (hov) tagC.textContent = tagText(hov);
      }).catch(() => {
        $("heroWait").textContent = "Could not load the fire map from Hugging Face.";
        $("heroRetry").hidden = false;
      }).finally(() => fireLoading = false);
    }
    $("heroRetry").onclick = loadFire;
    loadFire();
    const olM = new T.MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false }), olMesh = new T.Mesh(new T.SphereGeometry(1.001, 128, 64), olM);
    olMesh.visible = false;
    grp.add(olMesh);
    let snap = null, mode = "fire";
    const setMode = (m) => {
      if (m === "ol" && !snap) return;
      mode = m;
      fireMesh.visible = m === "fire" && fireStats.size > 0;
      olMesh.visible = m === "ol";
      document.querySelectorAll("#heroMode button").forEach((b) => {
        b.classList.toggle("on", b.dataset.m === m);
        b.setAttribute("aria-pressed", String(b.dataset.m === m));
      });
      $("heroKey").classList.toggle("ol", m === "ol");
      if (m === "ol" && snap) showOlKey(snap);
      else if (fireStats.size) showKey(fireLo, fireHi);
      if (hov) tagC.textContent = tagText(hov);
    };
    document.querySelectorAll("#heroMode button").forEach((b) => b.onclick = () => setMode(b.dataset.m === "ol" ? "ol" : "fire"));
    loadSnapshot().then((s2) => {
      if (!s2) return;
      snap = s2;
      const items = [];
      for (const c of WORLD) {
        const v = s2.c[c.k];
        if (!v || v[0] === 2) continue;
        items.push({ c, area: areaKm2(c), fill: olFill2(v) });
      }
      const t = new T.CanvasTexture(paintCountries(items));
      t.minFilter = T.LinearFilter;
      olM.map = t;
      olM.needsUpdate = true;
      $("heroMode").hidden = false;
    });
    const tops = [], RT2 = 1.003;
    G2.st = {};
    for (const st of STS) {
      const topM = new T.MeshBasicMaterial({ color: 16777215, side: T.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false });
      topM.visible = false;
      let sum2 = new T.Vector3(), cnt = 0;
      for (const r of D.globe.plate[st]) {
        const pts2 = [];
        for (let i = 0; i < r.length - 2; i += 2) pts2.push(new T.Vector2(r[i], r[i + 1]));
        const g = new T.ShapeGeometry(new T.Shape(pts2)), pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const p = v3(pos.getX(i), pos.getY(i), RT2);
          pos.setXYZ(i, p.x, p.y, p.z);
        }
        pos.needsUpdate = true;
        g.computeBoundingSphere();
        const top = new T.Mesh(g, topM);
        top.userData.st = st;
        grp.add(top);
        tops.push(top);
        for (const p of pts2) {
          sum2.add(v3(p.x, p.y, RT2));
          cnt++;
        }
      }
      const cen = sum2.divideScalar(cnt).normalize(), lat = 90 - Math.acos(cen.y) * 180 / Math.PI, lon = Math.atan2(cen.z, -cen.x) * 180 / Math.PI - 180;
      G2.st[st] = {
        topM,
        cen: cen.clone().multiplyScalar(RT2 + 0.02),
        ry: aimAt(lon, lat).ry,
        rx: aimAt(lon, lat).rx,
        hover: false
      };
    }
    const bpos = [], spans = /* @__PURE__ */ new Map(), RB = 1.002;
    for (const c of WORLD) {
      const first = bpos.length / 3;
      for (const r of c.r)
        for (let i = 0; i + 3 < r.length; i += 2) {
          const a0 = r[i], b0 = r[i + 1], a1 = r[i + 2], b1 = r[i + 3];
          if (cutEdge(c.k, a0, b0, a1, b1)) continue;
          const n = Math.max(1, Math.ceil(Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0)) / 1.5));
          for (let j = 0; j < n; j++) {
            const p = v3(a0 + (a1 - a0) * j / n, b0 + (b1 - b0) * j / n, RB), q = v3(a0 + (a1 - a0) * (j + 1) / n, b0 + (b1 - b0) * (j + 1) / n, RB);
            bpos.push(p.x, p.y, p.z, q.x, q.y, q.z);
          }
        }
      spans.set(c.k, [first, bpos.length / 3 - first]);
    }
    const bAttr = new T.Float32BufferAttribute(bpos, 3), bGeo = new T.BufferGeometry(), hlGeo = new T.BufferGeometry();
    bGeo.setAttribute("position", bAttr);
    hlGeo.setAttribute("position", bAttr);
    hlGeo.computeBoundingSphere();
    grp.add(new T.LineSegments(bGeo, new T.LineBasicMaterial({ color: 10466e3, transparent: true, opacity: 0.5, depthWrite: false })));
    const hlLine = new T.LineSegments(hlGeo, new T.LineBasicMaterial({ color: 16747069, depthWrite: false }));
    hlLine.visible = false;
    grp.add(hlLine);
    const tagC = $("tagC");
    let hov = null;
    const setHov = (c) => {
      if (c === hov) return;
      hov = c;
      const sp2 = c && spans.get(c.k);
      hlLine.visible = !!sp2 && sp2[1] > 0;
      if (sp2) hlGeo.setDrawRange(sp2[0], sp2[1]);
      tagC.textContent = c ? tagText(c) : "";
      if (!c) tagC.hidden = true;
    };
    function tagText(c) {
      if (mode === "ol" && snap) return `${c.n}
${olText(snap.c[c.k])}`;
      const f = fireStats.get(c.k);
      return f ? `${c.n}
${short(f.perYear)} hotspots a year` : c.n;
    }
    tagC.onclick = () => {
      if (hov) goCountry(hov.k);
    };
    const rt2 = new T.WebGLRenderTarget(4, 4, { minFilter: T.NearestFilter, magFilter: T.NearestFilter }), post2 = new T.Scene(), pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pmat = new T.ShaderMaterial({
      uniforms: { tex: { value: rt2.texture }, res: { value: new T.Vector2(4, 4) } },
      depthTest: false,
      vertexShader: "varying vec2 u;void main(){u=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
      fragmentShader: "uniform sampler2D tex;uniform vec2 res;varying vec2 u;float B2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}void main(){vec3 c=texture2D(tex,u).rgb;float g=dot(c,vec3(0.3,0.59,0.11));c=clamp(mix(vec3(g),c,1.55)*1.18,0.0,1.0);vec2 p=floor(u*res);float d=B2(0.5*p)*0.25+B2(p);c=floor(c*8.0+d*0.7)/8.0;gl_FragColor=vec4(c,1.0);}"
    });
    post2.add(new T.Mesh(new T.PlaneGeometry(2, 2), pmat));
    const base2 = { ry: 8 * Math.PI / 180, rx: 34 * Math.PI / 180 }, user = { ry: 0, rx: 0 };
    let fly = null, drag = null, off = { x: 0, y: 0 }, camZ = 4.6, last = 0;
    const ray = new T.Raycaster(), ndc = new T.Vector2(), ball = new T.Sphere(new T.Vector3(), 1), hitP = new T.Vector3();
    function size2() {
      const w = cv.clientWidth, h2 = cv.clientHeight;
      if (!w || !h2) return;
      const px = 2, lw = Math.ceil(w / px), lh = Math.ceil(h2 / px);
      ren.setSize(lw, lh, false);
      rt2.setSize(lw, lh);
      pmat.uniforms.res.value.set(lw, lh);
      cam.aspect = w / h2;
      cam.updateProjectionMatrix();
      const wide = w / h2 > 1.05;
      off = { x: 0, y: wide ? 0.06 : 0.25 };
      camZ = wide ? 4.6 : 4.6 / Math.max(0.45, w / h2) * 1.02;
    }
    const pick2 = (e) => {
      const r = cv.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const h2 = ray.intersectObjects(tops);
      return h2.length ? h2[0].object.userData.st : null;
    };
    const SMALL_PX = 12, NEAR_PX = 12, NEAR_LAND_PX = 6, sizeDeg = WORLD.map((c) => Math.max(lonSpan(c) * Math.cos(c.c[1] * Math.PI / 180), c.b[3] - c.b[1])), lp = new T.Vector3(), edge = new T.Vector3();
    const nearestSmall = (e, maxPx) => {
      const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      lp.copy(grp.position).project(cam);
      edge.set(0, 1, 0).add(grp.position).project(cam);
      const perDeg = Math.abs(edge.y - lp.y) * 0.5 * r.height * Math.PI / 180;
      let best = null, bd = maxPx;
      WORLD.forEach((c, i) => {
        if (sizeDeg[i] * perDeg >= SMALL_PX) return;
        lp.copy(v3(c.c[0], c.c[1], 1));
        grp.localToWorld(lp);
        if (lp.clone().sub(grp.position).normalize().dot(cam.position.clone().sub(lp).normalize()) <= 0.15) return;
        lp.project(cam);
        const dd = Math.hypot((lp.x * 0.5 + 0.5) * r.width - px, (-lp.y * 0.5 + 0.5) * r.height - py);
        if (dd < bd) {
          bd = dd;
          best = c;
        }
      });
      return best;
    };
    const pickCountry = (e) => {
      ball.center.copy(grp.position);
      if (!ray.ray.intersectSphere(ball, hitP)) return null;
      grp.worldToLocal(hitP);
      const lat = 90 - Math.acos(Math.max(-1, Math.min(1, hitP.y))) * 180 / Math.PI, lon = (Math.atan2(hitP.z, -hitP.x) * 180 / Math.PI + 360) % 360 - 180, under = countryAt(lon, lat);
      return nearestSmall(e, under ? NEAR_LAND_PX : NEAR_PX) || under;
    };
    cv.onpointerdown = (e) => {
      if (fly) return;
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, ry: user.ry, rx: user.rx, moved: false };
    };
    cv.onpointermove = (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        user.ry = drag.ry + dx * 5e-3;
        user.rx = Math.max(-0.9, Math.min(0.9, drag.rx + dy * 5e-3));
        return;
      }
      if (fly) return;
      const st = pick2(e), c = st ? null : pickCountry(e);
      setHov(c);
      for (const k in G2.st) G2.st[k].hover = k === st;
      cv.style.cursor = st || c ? "pointer" : "grab";
      document.querySelectorAll(".pick,.tag").forEach((b) => b.classList.toggle("hover", b.dataset.st === st));
    };
    cv.onpointerup = (e) => {
      const d = drag;
      drag = null;
      if (d && !d.moved) {
        const st = pick2(e), c = st ? null : pickCountry(e);
        if (st) go(st);
        else if (c) goCountry(c.k);
      }
    };
    cv.onpointerleave = (e) => {
      if (e.relatedTarget !== tagC) setHov(null);
    };
    G2.hover = (st) => {
      for (const k in G2.st) G2.st[k].hover = k === st;
      document.querySelectorAll(".tag[data-st]").forEach((t) => t.classList.toggle("hover", t.dataset.st === st));
    };
    G2.flyTo = (to, done) => {
      if (reduced) {
        done();
        return;
      }
      setHov(null);
      const ry0 = grp.rotation.y;
      fly = {
        /* turn the short way round */
        to: { ...to, ry: ry0 + ((to.ry - ry0) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI },
        t0: performance.now(),
        from: { ry: grp.rotation.y, rx: grp.rotation.x, x: grp.position.x, y: grp.position.y, z: cam.position.z },
        done
      };
    };
    G2.reset = () => {
      fly = null;
      setHov(null);
      user.ry = user.rx = 0;
      size2();
      loadFire();
      if (!G2.run) {
        G2.run = true;
        last = 0;
        requestAnimationFrame(frame2);
      }
    };
    G2.stop = () => {
      G2.run = false;
    };
    const tmp = new T.Vector3();
    function frame2(now) {
      if (!G2.run) return;
      const t = now / 1e3, dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      if (fly) {
        const u = Math.min(1, (now - fly.t0) / 1500), e = ease(u), f = fly.from, s2 = fly.to;
        grp.rotation.y = f.ry + (s2.ry - f.ry) * e;
        grp.rotation.x = f.rx + (s2.rx - f.rx) * e;
        grp.position.x = f.x * (1 - e);
        grp.position.y = f.y * (1 - e);
        cam.position.z = f.z + (s2.z - f.z) * e;
        if (u > 0.62) $("hero").classList.add("leaving");
        if (u >= 1) {
          const d = fly.done;
          fly = null;
          d();
        }
      } else {
        grp.rotation.y = base2.ry + user.ry + (reduced ? 0 : Math.sin(t * 0.2) * 0.13);
        grp.rotation.x = base2.rx + user.rx;
        grp.position.x = off.x;
        grp.position.y = off.y + (reduced ? 0 : Math.sin(t * 0.8) * 0.03);
        cam.position.z = camZ;
      }
      halo.position.copy(grp.position);
      if (fireT0) fireM.opacity = reduced ? 1 : Math.min(1, (now - fireT0) / 1200);
      if (!reduced) {
        stars.rotation.y += dt * 0.012;
        stars.rotation.x += dt * 3e-3;
        starMat.uniforms.t.value = t;
      }
      for (const k in G2.st) {
        const s2 = G2.st[k];
        s2.topM.visible = s2.hover;
        const tag = $("tag" + k);
        tmp.copy(s2.cen);
        grp.localToWorld(tmp);
        const facing = tmp.clone().sub(grp.position).normalize().dot(cam.position.clone().sub(tmp).normalize()) > 0.15;
        tmp.project(cam);
        tag.style.display = facing && !fly ? "block" : "none";
        tag.style.left = (tmp.x * 0.5 + 0.5) * cv.clientWidth + "px";
        tag.style.top = (-tmp.y * 0.5 + 0.5) * cv.clientHeight + "px";
      }
      if (hov) {
        tmp.copy(v3(hov.c[0], hov.c[1], RB));
        grp.localToWorld(tmp);
        const facing = tmp.clone().sub(grp.position).normalize().dot(cam.position.clone().sub(tmp).normalize()) > 0.15;
        tmp.project(cam);
        tagC.hidden = !facing || !!fly;
        const half = tagC.offsetWidth / 2 + 8;
        tagC.style.left = Math.max(half, Math.min(cv.clientWidth - half, (tmp.x * 0.5 + 0.5) * cv.clientWidth)) + "px";
        tagC.style.top = (-tmp.y * 0.5 + 0.5) * cv.clientHeight + "px";
      }
      ren.setRenderTarget(rt2);
      ren.render(scene, cam);
      ren.setRenderTarget(null);
      ren.render(post2, pcam);
      requestAnimationFrame(frame2);
    }
    addEventListener("resize", size2);
    cam.position.set(0, 0, camZ);
    G2.ok = true;
    if (!$("hero").hidden) G2.reset();
  }
  function showKey(lo, hi) {
    const cv = $("heroRamp"), g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    for (let x = 0; x < cv.width; x++) {
      const f = fireColour(x / (cv.width - 1));
      g.fillStyle = `rgb(${f.c[0]},${f.c[1]},${f.c[2]})`;
      g.fillRect(x, 0, 1, cv.height);
    }
    $("hkTitle").textContent = "Fire hotspots a year per 1,000 km\xB2";
    $("hkOl").textContent = "";
    $("hkNote").textContent = "NASA FIRMS, 2001\u20132025, live from Hugging Face. Click any country for its record and a 14-day outlook.";
    $("heroLo").textContent = "\u2264" + fmt(lo);
    $("heroHi").textContent = fmt(hi) + "+";
    $("heroKey").classList.add("ready");
  }
  var NO_OUTLOOK = "rgba(52,56,66,.82)";
  function olFill2(v) {
    if (v[0] !== 0) return NO_OUTLOOK;
    const hex = changeColour(v[1]), n = parseInt(hex.slice(1), 16), near2 = Math.abs(v[1]) < EDGES[3];
    return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${near2 ? 0.5 : 0.8})`;
  }
  function olText(v) {
    if (!v) return "No 14-day outlook here";
    if (v[0] === 2) return "No 14-day outlook: too little fire history";
    if (v[0] === 1) return "No 14-day outlook: it did not beat the usual odds in past tests";
    if (v[0] === 3) return "No reliable outlook today: too much of its forecast is far outside the usual range";
    const d = v[1], r = Math.round(d * 100), pts2 = r === 0 ? "no change" : `${r > 0 ? "+" : "\u2212"}${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"}`;
    return `Next 14 days: ${d >= COUNTRY_STEP ? "busier than usual" : d <= -COUNTRY_STEP ? "quieter than usual" : "about usual"} (${pts2})`;
  }
  var sgn = (x) => `${x > 0 ? "+" : x < 0 ? "\u2212" : ""}${Math.abs(x * 100).toFixed(1)}%`;
  var dayMonth = (iso) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${d} ${MONL[m - 1]}`;
  };
  function showOlKey(s2) {
    const cv = $("heroRamp"), g = cv.getContext("2d"), w = cv.width / RAMP.length;
    g.clearRect(0, 0, cv.width, cv.height);
    RAMP.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(Math.round(i * w), 0, Math.ceil(w), cv.height);
    });
    $("heroLo").textContent = "quieter";
    $("heroHi").textContent = "busier";
    $("hkTitle").textContent = `Next 14 days: busier than usual? ${dayMonth(s2.today)} \u2013 ${dayMonth(s2.end)}`;
    $("hkOl").innerHTML = `How the forecast weather moves each country's chance of more satellite fire detections than in a usual fortnight. <i class="hkSw" style="background:${NO_OUTLOOK}"></i> No outlook we can stand behind. Tested only on past weather, never on real forecasts: a hint, not a warning.`;
    $("hkNote").textContent = `Open-Meteo forecast fetched ${new Date(s2.at).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. Tested on 2012\u20132025: ${sgn(s2.skill.observed)} against the usual odds with the weather that actually happened, ${sgn(s2.skill.live)} with weather as far off as the forecast source. Click a country for its regions.`;
    $("heroKey").classList.add("ready");
  }

  // src/drill.ts
  var fold = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^st\.? /, "saint ").replace(/[^a-z0-9]+/g, " ").trim();
  function countyIndex(st, name) {
    const f = fold(name.replace(/\s+County$/i, ""));
    return f ? D.states[st].counties.findIndex((c) => fold(c.name) === f) : -1;
  }
  var job = 0;
  function stateCounty(st, name, hash) {
    const ci = countyIndex(st, name);
    if (ci < 0) return "";
    const mine = ++job, until = Date.now() + 15e3;
    const tick = () => {
      if (mine !== job || location.hash !== hash || Date.now() > until) return;
      if (S.st === st && !$("app").hidden && $("app").classList.contains("in")) {
        setTimeout(() => {
          if (mine === job && location.hash === hash && S.st === st) setCounty(ci);
        }, 250);
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
    return D.states[st].counties[ci].name;
  }

  // src/askproto.ts
  var isObj3 = (u) => typeof u === "object" && u !== null && !Array.isArray(u);
  var LIMIT = 2e3;
  var text = (u, max = LIMIT) => typeof u === "string" ? u.slice(0, max) : typeof u === "number" && isFinite(u) ? String(u) : "";
  var num3 = (u) => typeof u === "number" && isFinite(u) ? u : null;
  var list3 = (u, max = 200) => Array.isArray(u) ? u.slice(0, max) : [];
  var texts = (u, max = 200) => list3(u, max).map((x) => text(x, 300));
  var nums = (u, max = 400) => list3(u, max).map(num3);
  var TONES2 = ["high", "up", "flat", "down"];
  var tone = (u) => TONES2.find((t) => t === u) ?? null;
  function box(u) {
    const a = list3(u, 4).map(num3).filter((v) => v !== null);
    if (a.length !== 4) return null;
    const [w, s2, e, n] = a;
    return s2 <= n && Math.abs(s2) <= 90 && Math.abs(n) <= 90 && Math.abs(w) <= 540 && Math.abs(e) <= 540 ? [w, s2, e, n] : null;
  }
  function geometry(u) {
    if (!isObj3(u) || !Array.isArray(u.coordinates)) return null;
    return u.type === "Polygon" || u.type === "MultiPolygon" ? { type: u.type, coordinates: u.coordinates } : null;
  }
  function place2(u) {
    if (!isObj3(u)) return null;
    const name = text(u.name, 200);
    if (!name) return null;
    const p = { id: text(u.id, 80), name, label: text(u.label, 300) || name, level: num3(u.level) ?? -1, b: box(u.b), g: geometry(u.g) };
    return p.b && p.b[2] - p.b[0] > 180 ? acrossDateLine(p) : p;
  }
  function eachPoint(c, f) {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") f(c);
    else for (const x of c) eachPoint(x, f);
  }
  function shiftWest(c) {
    if (!Array.isArray(c)) return c;
    if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0] < 0 ? c[0] + 360 : c[0], ...c.slice(1)];
    return c.map(shiftWest);
  }
  function acrossDateLine(p) {
    if (!p.g) return { ...p, b: null };
    let w = Infinity, e = -Infinity, w2 = Infinity, e2 = -Infinity, s2 = Infinity, n = -Infinity;
    eachPoint(p.g.coordinates, ([x, y]) => {
      const x2 = x < 0 ? x + 360 : x;
      w = Math.min(w, x);
      e = Math.max(e, x);
      w2 = Math.min(w2, x2);
      e2 = Math.max(e2, x2);
      s2 = Math.min(s2, y);
      n = Math.max(n, y);
    });
    if (!Number.isFinite(w) || !Number.isFinite(s2)) return { ...p, b: null };
    if (e - w <= e2 - w2) return { ...p, b: [w, s2, e, n] };
    return { ...p, b: [w2, s2, e2, n], g: { type: p.g.type, coordinates: shiftWest(p.g.coordinates) } };
  }
  var places = (u) => list3(u, 60).map(place2).filter((p) => p !== null);
  function badge(u) {
    if (!isObj3(u)) return null;
    const t = text(u.text, 60);
    return t ? { text: t, tone: tone(u.cls) ?? "flat" } : null;
  }
  function action(u) {
    if (!isObj3(u)) return null;
    if (u.type === "goto") {
      const p = place2(u.place);
      return p ? { type: "goto", place: p } : null;
    }
    if (u.type === "outline") return { type: "outline", places: places(u.places) };
    if (u.type === "mark") return { type: "mark", focus: place2(u.focus), places: places(u.places) };
    if (u.type === "highlight") return { type: "highlight", parent: place2(u.parent) };
    return null;
  }
  function chart2(u) {
    if (!isObj3(u)) return null;
    const labels = texts(u.labels, 60);
    if (u.type === "lines") {
      const series = list3(u.series, 6).filter(isObj3).map((s2, i) => ({ name: text(s2.name, 120), values: nums(s2.values, 60), ref: s2.tone === "ref", tone: num3(s2.tone) ?? i }));
      return series.length && labels.length ? { type: "lines", title: text(u.title, 200), labels, series } : null;
    }
    const values = nums(u.values, 60);
    if (!values.length || !labels.length) return null;
    const ref = Array.isArray(u.ref) ? nums(u.ref, 60).map((v) => v ?? 0) : null;
    return {
      type: "bars",
      title: text(u.title, 200),
      labels,
      values,
      ref,
      refLine: num3(u.refLine),
      refLabel: text(u.refLabel, 60) || "usual",
      highlight: nums(u.highlight, 60).filter((v) => v !== null)
    };
  }
  function card(u) {
    if (!isObj3(u)) return null;
    const big2 = isObj3(u.big) ? { value: text(u.big.value, 80), caption: text(u.big.caption, 300) } : null;
    const t = u.table;
    const table = isObj3(t) ? { head: texts(t.head, 6), rows: list3(t.rows, 20).map((r) => texts(Array.isArray(r) ? r : [r], 6)), plain: t.plain === true } : null;
    const rk = u.rank;
    const rank = isObj3(rk) ? {
      title: text(rk.title, 300),
      items: list3(rk.items, 12).filter(isObj3).map((it) => ({
        name: text(it.name, 200),
        sub: text(it.sub, 200),
        value: text(it.value, 40),
        chip: badge(it.chip),
        spark: nums(it.spark, 24).map((v) => v ?? 0),
        b: box(it.b)
      }))
    } : null;
    return {
      eyebrow: text(u.eyebrow, 200),
      title: text(u.title, 200),
      badge: badge(u.badge),
      big: big2,
      chart: chart2(u.chart),
      table: table && table.rows.length ? table : null,
      rank: rank && rank.items.length ? rank : null,
      rows: list3(u.rows, 12).filter(isObj3).map((r) => ({ k: text(r.k, 120), v: text(r.v, 300), tone: tone(r.cls) })),
      foot: text(u.foot, 600),
      go: isObj3(u.go) ? place2(u.go.place) : null,
      suggest: texts(u.suggest, 4).filter(Boolean)
    };
  }
  var cards = (u) => list3(u, 12).map(card).filter((c) => c !== null);
  function turn(u) {
    if (!isObj3(u)) return null;
    if (u.role === "user") return { role: "user", text: text(u.text, 1e3) };
    if (u.role === "assistant") return { role: "assistant", text: text(u.text, 8e3), cards: cards(u.cards), choices: texts(u.choices, 6) };
    return null;
  }
  function parseInbound(raw) {
    let m;
    try {
      m = JSON.parse(typeof raw === "string" ? raw : "");
    } catch {
      return null;
    }
    if (!isObj3(m)) return null;
    switch (m.type) {
      case "hello":
        return {
          type: "hello",
          transcript: list3(m.transcript, 200).map(turn).filter((t) => t !== null)
        };
      case "status":
        return { type: "status", text: text(m.text, 200) };
      case "card": {
        const c = card(m.card);
        return c ? { type: "card", card: c } : null;
      }
      case "action": {
        const a = action(m.action);
        return a ? { type: "action", action: a } : null;
      }
      case "delta":
        return { type: "delta", text: text(m.text, 4e3) };
      case "retract":
        return { type: "retract" };
      case "choices":
        return { type: "choices", options: texts(m.options, 6).filter(Boolean) };
      case "done":
        return { type: "done" };
      case "error":
        return { type: "error", message: text(m.message, 400) || "Something went wrong." };
      default:
        return null;
    }
  }

  // src/askcards.ts
  function h(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  var SVG = "http://www.w3.org/2000/svg";
  function s(tag, attrs, txt) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === "number" ? v.toFixed(1).replace(/\.0$/, "") : v);
    if (txt != null) e.textContent = txt;
    return e;
  }
  var tip2 = (parent, txt) => parent.appendChild(s("title", {}, txt));
  var big = (n) => Math.round(n).toLocaleString("en-US");
  function barsSvg(c) {
    const W = 340, H = 108, x0 = 2, x1 = W - 2, y0 = 6, y1 = H - 20, n = c.values.length, vals = c.values.map((v) => v ?? 0), max = Math.max(1, ...vals, ...c.ref ?? [], c.refLine ?? 0), bw = (x1 - x0) / n, hi = new Set(c.highlight), y = (v) => y1 - v / max * (y1 - y0), svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": c.title || "Chart" });
    svg.appendChild(s("line", { x1: x0, x2: x1, y1, y2: y1, class: "askAxis" }));
    c.values.forEach((v, i) => {
      const hgt = v == null ? 0 : Math.max(v > 0 ? 1.5 : 0, y1 - y(v)), x = x0 + i * bw + bw * 0.14, bar = s("rect", { x, y: y1 - hgt, width: bw * 0.72, height: hgt, class: hi.has(i) ? "askBar hi" : "askBar" });
      const ref = c.ref?.[i];
      tip2(bar, `${c.labels[i] ?? ""}: ${v == null ? "no data" : big(v)}${ref != null ? ` (${c.refLabel} ${big(ref)})` : ""}`);
      svg.appendChild(bar);
      if (ref != null) svg.appendChild(s("line", { x1: x - 1, x2: x + bw * 0.72 + 1, y1: y(ref), y2: y(ref), class: "askRef" }));
    });
    if (c.refLine != null) svg.appendChild(s("line", { x1: x0, x2: x1, y1: y(c.refLine), y2: y(c.refLine), class: "askRefLine" }));
    const label = (i) => svg.appendChild(
      s(
        "text",
        { x: x0 + (i + 0.5) * bw, y: H - 5, "text-anchor": "middle", class: hi.has(i) ? "hi" : "" },
        n === 12 ? (c.labels[i] ?? "").slice(0, 1) : c.labels[i] ?? ""
      )
    );
    if (n === 12) for (let i = 0; i < n; i++) label(i);
    else {
      const placed = [];
      for (const i of [...hi, 0, n - 1]) if (i >= 0 && i < n && !placed.some((j) => Math.abs(j - i) * bw < 32)) placed.push(i), label(i);
    }
    return svg;
  }
  function linesSvg(c) {
    const W = 340, H = 120, x0 = 4, x1 = W - 4, y0 = 6, y1 = H - 20, n = c.labels.length, max = Math.max(1, ...c.series.flatMap((sr) => sr.values.map((v) => v ?? 0))), X = (i) => x0 + (i + 0.5) * (x1 - x0) / n, Y = (v) => y1 - v / max * (y1 - y0), svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": c.title || "Chart" });
    svg.appendChild(s("line", { x1: x0, x2: x1, y1, y2: y1, class: "askAxis" }));
    for (const sr of c.series) {
      const g = s("g", { class: sr.ref ? "askSeries ref" : `askSeries t${sr.tone % 4}` });
      let run = [];
      const flush = () => {
        if (run.length > 1) g.appendChild(s("polyline", { points: run.join(" ") }));
        run = [];
      };
      sr.values.forEach((v, i) => {
        if (v == null) return flush();
        run.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
        if (!sr.ref) {
          const dot = s("circle", { cx: X(i), cy: Y(v), r: 4, class: "askDot" });
          tip2(dot, `${sr.name}, ${c.labels[i] ?? ""}: ${big(v)}`);
          g.appendChild(dot);
        }
      });
      flush();
      svg.appendChild(g);
    }
    c.labels.forEach((l, i) => svg.appendChild(s("text", { x: X(i), y: H - 5, "text-anchor": "middle" }, n === 12 ? l.slice(0, 1) : l)));
    return svg;
  }
  function spark(vals) {
    const max = Math.max(1, ...vals), w = 4, gap = 2, svg = s("svg", { class: "askSpark", viewBox: `0 0 ${vals.length * (w + gap)} 20`, "aria-hidden": "true" });
    vals.forEach((v, i) => {
      const hgt = Math.max(v > 0 ? 1.5 : 0.6, v / max * 18);
      svg.appendChild(
        s("rect", { x: i * (w + gap), y: 20 - hgt, width: w, height: hgt, class: i >= vals.length - 3 ? "askBar hi" : "askBar" })
      );
    });
    return svg;
  }
  function chartEl(c) {
    const fig = h("figure", "askChart"), cap5 = h("figcaption");
    cap5.appendChild(h("span", "", c.title));
    if (c.type === "bars" && (c.ref || c.refLine != null)) {
      const key = h("span", "askKey");
      key.append(h("i", c.ref ? "ln" : "dash"), c.refLabel);
      cap5.appendChild(key);
    }
    fig.appendChild(cap5);
    fig.appendChild(c.type === "lines" ? linesSvg(c) : barsSvg(c));
    if (c.type === "lines") {
      const leg = h("div", "askLegend");
      for (const sr of c.series) {
        const k = h("span", "askKey");
        k.append(h("i", sr.ref ? "dash" : `t${sr.tone % 4}`), sr.name);
        leg.appendChild(k);
      }
      fig.appendChild(leg);
    }
    return fig;
  }
  function cardEl(c, hooks2) {
    const card2 = h("article", "askCard"), head = h("header"), titles = h("div");
    if (c.eyebrow) titles.appendChild(h("p", "askEye", c.eyebrow));
    titles.appendChild(h("h4", "", c.title));
    head.appendChild(titles);
    if (c.badge) head.appendChild(h("span", `askBadge ${c.badge.tone}`, c.badge.text));
    card2.appendChild(head);
    if (c.big) {
      const b = h("p", "askBig");
      b.append(h("b", "", c.big.value), h("span", "", c.big.caption));
      card2.appendChild(b);
    }
    if (c.chart) card2.appendChild(chartEl(c.chart));
    if (c.table) {
      const wrap2 = h("div", "askScroll"), t = h("table", c.table.plain ? "askTable plain" : "askTable"), tr = h("tr");
      c.table.head.forEach((x, i) => {
        const th = h("th");
        if (i && !c.table.plain) th.appendChild(h("i", `t${(i - 1) % 4}`));
        th.append(x);
        tr.appendChild(th);
      });
      t.appendChild(h("thead")).appendChild(tr);
      const body = t.appendChild(h("tbody"));
      c.table.rows.forEach((r, k) => {
        const row2 = body.appendChild(h("tr"));
        r.forEach((x, i) => {
          if (i) return row2.appendChild(h("td", "", x));
          const th = row2.appendChild(h("th"));
          if (c.table.plain) th.appendChild(h("span", "n", String(k + 1)));
          th.append(x);
        });
      });
      wrap2.appendChild(t);
      card2.appendChild(wrap2);
    }
    if (c.rank) {
      card2.appendChild(h("p", "askRankT", c.rank.title));
      const ol = h("ol", "askRank");
      c.rank.items.forEach((it, i) => {
        const li = ol.appendChild(h("li")), row2 = it.b ? h("button", "askRow") : h("div", "askRow");
        if (it.b && row2 instanceof HTMLButtonElement) {
          const b = it.b;
          row2.type = "button";
          row2.title = `Show ${it.name} on the map`;
          row2.onclick = () => hooks2.focus(it.name, b);
        }
        const who = h("span", "who");
        who.append(h("b", "", it.name));
        if (it.sub) who.appendChild(h("small", "", it.sub));
        row2.append(h("span", "n", String(i + 1)), who);
        if (it.spark.length) row2.appendChild(spark(it.spark));
        const val = h("span", "val");
        val.appendChild(h("b", "", it.value));
        if (it.chip) val.appendChild(h("span", `askBadge ${it.chip.tone}`, it.chip.text));
        row2.appendChild(val);
        li.appendChild(row2);
      });
      card2.appendChild(ol);
    }
    if (c.rows.length) {
      const dl = h("dl", "askRows");
      for (const r of c.rows) {
        const d = dl.appendChild(h("div"));
        d.append(h("dt", "", r.k), h("dd", r.tone ?? "", r.v));
      }
      card2.appendChild(dl);
    }
    if (c.foot) card2.appendChild(h("p", "askFoot", c.foot));
    if (c.go) {
      const p = c.go, go2 = h("button", "askGo", "Show it on the page");
      go2.type = "button";
      go2.onclick = () => hooks2.go(p);
      card2.appendChild(go2);
    }
    return card2;
  }
  var INLINE = /\*\*([^*\n]+)\*\*|(https:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
  function inline(parent, line) {
    let at = 0;
    for (const m of line.matchAll(INLINE)) {
      const i = m.index ?? 0;
      if (i > at) parent.append(line.slice(at, i));
      if (m[1] != null) parent.appendChild(h("b", "", m[1]));
      else {
        const a = h("a", "", m[2]);
        a.href = m[2];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        parent.appendChild(a);
      }
      at = i + m[0].length;
    }
    if (at < line.length) parent.append(line.slice(at));
  }
  function prose(box2, raw) {
    box2.textContent = "";
    let ul = null;
    for (const lineRaw of raw.split("\n")) {
      const line = lineRaw.trim(), item2 = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (item2) {
        if (!ul) ul = box2.appendChild(h("ul"));
        inline(ul.appendChild(h("li")), item2[1]);
        continue;
      }
      ul = null;
      if (line) inline(box2.appendChild(h("p")), line.replace(/^#+\s*/, ""));
    }
  }

  // src/voice.ts
  function recognizer() {
    const w = window;
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    return typeof C === "function" ? C : null;
  }
  var canSpeak = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
  var english = () => (navigator.languages ?? []).find((l) => /^en\b/i.test(l));
  var listenLang = () => english() ?? (navigator.language || "en-US");
  function speakLang(text2) {
    const looksEnglish = /\b(the|and|with|were|than|which|there|this|that|hotspots?|fires?|burned)\b/i.test(text2);
    return looksEnglish ? english() ?? "en-US" : navigator.language || "en-US";
  }
  var ALOUD_KEY = "bc-copilot-aloud";
  var STOP_GRACE = 2e3;
  var LISTEN_LIMIT = 3e4;
  var DOUBLE_PRESS = 700;
  var STARTING = "Starting the microphone\u2026";
  var LISTENING = "Listening\u2026";
  var PRIVACY = "Voice uses your browser's speech service; in Chrome that sends audio to Google.";
  var ERRORS = {
    "not-allowed": "Microphone access was blocked. Allow it in the browser to talk to the copilot.",
    "service-not-allowed": "Speech recognition is turned off in this browser. You can type your question instead.",
    "no-speech": "No speech was heard. Press the mic to try again.",
    "audio-capture": "No microphone was found. You can type your question instead.",
    network: "The browser's speech service could not be reached. You can type your question instead.",
    "language-not-supported": "This browser cannot recognise speech in your language. You can type your question instead."
  };
  var OTHER_ERROR = "Voice input stopped. You can type your question instead.";
  var MIC_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><g class="off"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></g><rect class="on" x="6" y="6" width="8" height="8" rx="1.5"/></svg>';
  var SPEAKER_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 8v4h3l4 3.5v-11L6.5 8z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9"/></svg>';
  var V4 = null;
  var lineKind = null;
  var session = null;
  var utter = null;
  var utterHash = "";
  var readAloud = true;
  var lookingAtPage = false;
  function showLine(kind, text2) {
    if (!V4) return;
    lineKind = kind;
    V4.line.dataset.kind = kind;
    V4.lineIcon.innerHTML = kind === "speaking" ? SPEAKER_SVG : "";
    V4.lineText.textContent = text2;
    V4.lineStop.hidden = kind !== "speaking";
    V4.sr.textContent = kind === "note" ? text2 : "";
    if (!V4.line.hidden) return;
    const log = V4.host.log, atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    V4.line.hidden = false;
    if (atEnd) log.scrollTop = log.scrollHeight;
  }
  function hideLine() {
    if (!V4 || V4.line.hidden) return;
    const hadFocus = V4.line.contains(document.activeElement);
    lineKind = null;
    V4.line.hidden = true;
    V4.sr.textContent = "";
    if (hadFocus && !V4.mic.disabled) V4.mic.focus();
  }
  function fit() {
    if (!V4) return;
    const t = V4.host.input;
    t.style.height = "";
    t.style.height = Math.min(120, t.scrollHeight + t.offsetHeight - t.clientHeight) + "px";
  }
  function setMic(on) {
    if (!V4) return;
    V4.mic.setAttribute("aria-pressed", String(on));
    V4.mic.title = on ? "Stop and send" : "Start talking";
    V4.host.root.classList.toggle("listening", on);
    V4.host.send.disabled = on || V4.host.busy();
  }
  function listen() {
    const Ctor = recognizer();
    if (!V4 || !Ctor || session || V4.host.busy()) return;
    hush();
    primeSpeech();
    const r = new Ctor();
    r.lang = listenLang();
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    const input = V4.host.input, s2 = { r, before: input.value, placeholder: input.placeholder, heard: "", error: "", started: false, send: false, stopping: 0, limit: 0 };
    r.onstart = r.onaudiostart = () => began(s2);
    r.onresult = (e) => heard(s2, e);
    r.onerror = (e) => {
      s2.error = e.error;
    };
    r.onend = () => ended(s2);
    try {
      r.start();
    } catch {
      showLine("note", OTHER_ERROR);
      return;
    }
    session = s2;
    setMic(true);
    input.placeholder = STARTING;
    showLine("starting", STARTING);
  }
  function began(s2) {
    if (session !== s2 || !V4 || s2.started) return;
    s2.started = true;
    s2.limit = window.setTimeout(() => stopListening(false), LISTEN_LIMIT);
    if (V4.host.input.placeholder === STARTING) V4.host.input.placeholder = LISTENING;
    if (lineKind === "starting") showLine("listening", "Listening. Ask your question out loud.");
  }
  function heard(s2, e) {
    if (session !== s2 || !V4) return;
    began(s2);
    let words2 = "", final = e.results.length > 0;
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      words2 += res[0]?.transcript ?? "";
      if (!res.isFinal) final = false;
    }
    const most = V4.host.input.maxLength > 0 ? V4.host.input.maxLength : 500;
    words2 = words2.replace(/\s+/g, " ").trim();
    const full = words2.length >= most;
    if (full) words2 = words2.slice(0, most).replace(/\s+\S*$/, "");
    s2.heard = words2;
    V4.host.input.value = words2;
    fit();
    if (final && words2) {
      release(s2, true);
      sendHeard(words2);
    } else if (full) stopListening(true);
  }
  function ended(s2) {
    if (session !== s2 || !V4) return;
    release(s2, false);
    const failed = s2.error && s2.error !== "aborted" ? s2.error : "";
    if (s2.send && s2.heard && !failed) return sendHeard(s2.heard);
    if (!s2.heard) {
      V4.host.input.value = s2.before;
      fit();
    }
    if (failed) showLine("note", ERRORS[failed] ?? OTHER_ERROR);
    else if (s2.heard) showLine("note", "Press send to ask this, or change it first.");
    else hideLine();
  }
  function sendHeard(words2) {
    if (!V4) return;
    hideLine();
    const { host, mic } = V4;
    if (document.activeElement === mic) host.root.focus();
    host.ask(words2);
  }
  function release(s2, abort) {
    s2.r.onstart = s2.r.onaudiostart = s2.r.onresult = s2.r.onerror = s2.r.onend = null;
    clearTimeout(s2.stopping);
    clearTimeout(s2.limit);
    if (abort) {
      try {
        s2.r.abort();
      } catch {
      }
    }
    if (session === s2) session = null;
    setMic(false);
    const ph = V4?.host.input.placeholder;
    if (V4 && (ph === STARTING || ph === LISTENING)) V4.host.input.placeholder = s2.placeholder;
  }
  function stopListening(send) {
    const s2 = session;
    if (!s2) return;
    if (send) s2.send = true;
    if (s2.stopping) return;
    if (!s2.started) return cancelListening(true);
    try {
      s2.r.stop();
    } catch {
    }
    s2.stopping = window.setTimeout(() => {
      if (session !== s2) return;
      try {
        s2.r.abort();
      } catch {
      }
      ended(s2);
    }, STOP_GRACE);
  }
  function cancelListening(restore2) {
    const s2 = session;
    if (!s2 || !V4) return;
    release(s2, true);
    if (lineKind === "listening" || lineKind === "starting") hideLine();
    if (restore2) {
      V4.host.input.value = s2.before;
      fit();
    }
  }
  function spoken(raw) {
    const lines2 = raw.split("\n").map(
      (l) => l.trim().replace(/^>\s*/, "").replace(/^#+\s*/, "").replace(/^(?:[-*•]|\d+[.)])\s+/, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\b(see|visit)\s+https?:\/\/\S+/gi, "$1 the link").replace(/\bhttps?:\/\/\S+/gi, "").replace(/\*+|`+|~~|__/g, "").replace(/(?:~|≈)\s*(?=\d)/g, "about ").replace(/\s*→\s*/g, " to ").replace(/\b(\d{4})\s*[–-]\s*(\d{2,4})\b(?![–-]\d)/g, "$1 to $2").replace(/(\d)\s*×/g, "$1 times").replace(/\s+/g, " ").trim()
    ).filter((l) => /[A-Za-z0-9]/.test(l) && !l.startsWith("|")).map((l) => /[.!?:;。！？]$/.test(l) ? l : l + ".");
    const all = sentences(lines2.join(" "));
    let out = all[0] ?? "";
    if (all[1] && out.length < 110 && out.length + all[1].length < 300) out += " " + all[1];
    if (out.length > 320) out = out.slice(0, 300).replace(/\s+\S*$/, "") + "\u2026";
    return out;
  }
  var SHORT_FORM = /(?:\b(?:e\.g|i\.e|etc|vs|approx|ca|Mt|St|Dr|Mr|Mrs|Ms|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|\b[A-Z])\.$/;
  function sentences(text2) {
    const out = [];
    let start4 = 0;
    for (let i = 0; i < text2.length; i++) {
      const c = text2[i];
      if (c !== "." && c !== "!" && c !== "?" || i + 1 < text2.length && text2[i + 1] !== " ") continue;
      const piece = text2.slice(start4, i + 1);
      if (c === "." && SHORT_FORM.test(piece)) continue;
      if (piece.trim()) out.push(piece.trim());
      start4 = i + 1;
    }
    const rest = text2.slice(start4).trim();
    if (rest) out.push(rest);
    return out;
  }
  var primed = false;
  function primeSpeech() {
    if (primed || !canSpeak()) return;
    primed = true;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }
  function say(text2) {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(text2);
    u.lang = speakLang(text2);
    const watch = window.setInterval(() => {
      if (utter !== u || !synth.speaking && !synth.pending) over();
    }, 1500);
    const over = () => {
      clearInterval(watch);
      if (utter !== u) return;
      utter = null;
      if (lineKind === "speaking") hideLine();
    };
    u.onend = over;
    u.onerror = over;
    utter = u;
    utterHash = location.hash;
    showLine("speaking", "Reading the answer aloud");
    synth.speak(u);
  }
  function hush() {
    if (!utter) return;
    utter = null;
    window.speechSynthesis.cancel();
    if (lineKind === "speaking") hideLine();
  }
  function voiceAnswer(raw) {
    if (!V4 || !V4.aloud || !readAloud || V4.host.root.hidden && !lookingAtPage) return;
    say(spoken(raw) || "The answer is on the screen.");
  }
  function voiceBusy(busy3) {
    if (!V4) return;
    V4.mic.disabled = busy3;
    if (!busy3) return;
    hush();
    cancelListening(false);
    if (lineKind === "note") hideLine();
  }
  function voiceStop(keepReading = false) {
    lookingAtPage = keepReading;
    if (!keepReading) hush();
    cancelListening(true);
    if (lineKind !== "speaking") hideLine();
  }
  function setAloud(on) {
    readAloud = on;
    V4?.aloud?.setAttribute("aria-pressed", String(on));
    if (!on) hush();
    try {
      localStorage.setItem(ALOUD_KEY, on ? "1" : "0");
    } catch {
    }
  }
  function voiceInit(host) {
    if (!recognizer()) return;
    const mic = h("button", "askMic");
    mic.type = "button";
    mic.innerHTML = MIC_SVG;
    mic.setAttribute("aria-label", "Talk to the copilot");
    mic.onclick = () => session ? stopListening(true) : listen();
    host.send.before(mic);
    const line = h("div", "askVoice"), lineIcon = h("span", "askVoiceIcon"), lineText = h("span", "askVoiceText"), lineStop = h("button", "askVoiceStop", "Stop");
    line.hidden = true;
    lineIcon.setAttribute("aria-hidden", "true");
    lineStop.type = "button";
    lineStop.setAttribute("aria-label", "Stop reading aloud");
    lineStop.onclick = hush;
    line.append(lineIcon, lineText, lineStop);
    host.form.before(line);
    const sr = h("span", "askVoiceSr");
    sr.setAttribute("role", "status");
    host.root.append(sr);
    const info = h("span", "askVoiceInfo");
    info.appendChild(h("span", "", PRIVACY));
    let aloud = null;
    if (canSpeak()) {
      aloud = h("button", "askAloud");
      aloud.type = "button";
      aloud.append(h("span", "askSw"), "Read answers aloud");
      aloud.title = "Read the start of each answer to a spoken question aloud";
      aloud.onclick = () => setAloud(!readAloud);
      info.appendChild(aloud);
      try {
        readAloud = localStorage.getItem(ALOUD_KEY) !== "0";
      } catch {
      }
      aloud.setAttribute("aria-pressed", String(readAloud));
    }
    host.note.appendChild(info);
    const quick = h("button", "askLaunchMic");
    quick.type = "button";
    quick.setAttribute("aria-label", "Talk to the fire copilot");
    quick.title = "Talk to the fire copilot";
    quick.innerHTML = MIC_SVG;
    let quickAt = -Infinity;
    quick.onclick = () => {
      quickAt = performance.now();
      host.open();
      if (host.busy()) return;
      listen();
      setTimeout(() => mic.focus(), 90);
    };
    host.launch.after(quick);
    host.root.addEventListener(
      "click",
      (e) => {
        if (performance.now() - quickAt > DOUBLE_PRESS) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
    document.body.classList.add("askVoiceOK");
    new ResizeObserver(() => {
      if (host.launch.offsetWidth) document.body.style.setProperty("--askLW", host.launch.offsetWidth + "px");
    }).observe(host.launch);
    V4 = { host, mic, line, lineIcon, lineText, lineStop, sr, info, aloud };
    setMic(false);
    host.input.addEventListener("input", () => {
      hush();
      cancelListening(false);
      if (lineKind === "note") hideLine();
    });
    host.root.addEventListener(
      "submit",
      (e) => {
        if (!session) return;
        e.preventDefault();
        e.stopPropagation();
        stopListening(true);
      },
      true
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          if (session) cancelListening(true);
          else if (utter) {
            hush();
            if (host.root.hidden) return;
          } else return;
          e.stopPropagation();
          e.preventDefault();
        } else if (e.key === "Enter" && session && e.target === host.input && !e.shiftKey && !e.isComposing) {
          e.stopPropagation();
          e.preventDefault();
          stopListening(true);
        }
      },
      true
    );
    addEventListener("hashchange", () => {
      if (utter && location.hash !== utterHash) hush();
    });
    addEventListener("pagehide", () => {
      hush();
      cancelListening(false);
    });
  }

  // src/copilot.ts
  var SOCKET = "wss://hotspotters.compare/agents/fire-copilot/";
  var SESSION_KEY = "bc-copilot-session";
  var OPEN_TIMEOUT = 12e3;
  var QUIET_LIMIT = 12e4;
  var MAX_TEXT = 12e3;
  var MAX_CARDS = 12;
  var MAX_SUGGEST = 6;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MARK_TONES = ["#2166ac", "#6a3d9a", "#1b7837", "#8c510a"];
  var HONESTY = "Answers come from the HotSpotters copilot (DeepSeek), which counts all FIRMS heat detections, gas flares included. Its totals often run higher than this page's, so compare trends, not exact counts.";
  function here() {
    const hash = location.hash;
    if (hash.startsWith("#c/") || hash.startsWith("#g/")) {
      const full = hash.startsWith("#c/");
      let slug = hash.slice(3);
      try {
        slug = slugOf(decodeURIComponent(slug));
      } catch {
        slug = slugOf(slug);
      }
      const k = WORLD.find((c) => slugOf(c.k) === slug)?.k ?? (full ? countryKey() : glanceKey());
      return { kind: "country", k, name: k ? nameOf(k) : "", full };
    }
    const st = STS.find((s2) => "#" + SLUG[s2] === hash);
    if (st) return { kind: "state", st };
    return hash === "#compare" ? { kind: "compare" } : { kind: "globe" };
  }
  var stateName = (st) => st === "NY" ? "New York State" : NAME[st];
  function whereLabel(at) {
    if (at.kind === "country") return at.name;
    if (at.kind === "state") return NAME[at.st];
    if (at.kind === "compare") return "New York and California";
    return "";
  }
  function placeNote(at) {
    const a = at.kind === "country" ? areaForCopilot() : null;
    if (a) return `(I've selected an area on the map: ${a.name}. "Here" means that area.)`;
    if (at.kind === "country" && at.name) return `(I'm looking at ${theName(at.name)}.)`;
    if (at.kind === "state") return `(I'm looking at ${stateName(at.st)}.)`;
    if (at.kind === "compare") return "(I'm comparing New York State and California.)";
    return "";
  }
  var NOTE_RE = /\s*\((?:I'm (?:looking at|comparing)|I've selected) [^()]*\.\)$/;
  var fold2 = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  var NOT_PLACES = new Set(
    [
      ...MONTHS,
      ...MONTHS.map((m) => m.slice(0, 3)),
      "I",
      "I'm",
      "I'd",
      "I've",
      "NASA",
      "FIRMS",
      "MODIS",
      "VIIRS",
      "NOAA",
      "DeepSeek",
      "HotSpotters",
      "Copilot",
      "OK"
    ].map((w) => w.toLowerCase())
  );
  function namesAPlace(q) {
    const f = ` ${fold2(q)} `;
    if (WORLD.some((c) => f.includes(` ${fold2(c.n)} `))) return true;
    const words2 = q.split(/\s+/);
    return words2.some((w, i) => {
      const bare = w.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "");
      if (i === 0 || !/^[A-Z]/.test(bare) || NOT_PLACES.has(bare.toLowerCase())) return false;
      return !/[.?!:]$/.test(words2[i - 1]);
    });
  }
  var COUNTRY_ALIAS = {
    "united states of america": "United_States",
    usa: "United_States",
    "russian federation": "Russian_Federation",
    czechia: "Czech_Republic",
    turkiye: "Turkey",
    "cabo verde": "Cape_Verde",
    "ivory coast": "Cote_d_Ivoire",
    gambia: "The_Gambia",
    "viet nam": "Vietnam",
    burma: "Myanmar",
    swaziland: "Swaziland",
    "east timor": "Timor-Leste",
    congo: "Republic_of_Congo",
    "democratic republic of congo": "Democratic_Republic_of_the_Congo",
    "dr congo": "Democratic_Republic_of_the_Congo",
    macedonia: "Macedonia_Former_Yugoslav_Republic_of",
    micronesia: "Federated_States_of_Micronesia",
    "korea republic of": "Republic_of_Korea",
    bahamas: "Bahamas"
  };
  function countryNamed(name) {
    const f = fold2(name).replace(/^the /, "");
    if (!f) return null;
    return WORLD.find((c) => fold2(c.n).replace(/^the /, "") === f || fold2(c.k) === f)?.k ?? COUNTRY_ALIAS[f] ?? null;
  }
  function destOf(p) {
    const parts = p.label.split(",").map((t) => t.trim()), country = p.level === 0 ? p.name : parts.length > 1 ? parts[parts.length - 1] : "";
    const k = countryNamed(country) ?? (p.b ? countryAt(near((p.b[0] + p.b[2]) / 2, 0), (p.b[1] + p.b[3]) / 2)?.k ?? null : null);
    if (k === "United_States" && p.level >= 1) {
      const stName = p.level === 1 ? p.name : parts[parts.length - 2] ?? "";
      const st = STS.find((s2) => NAME[s2] === stName);
      if (st) return { kind: "state", st };
    }
    return k ? { kind: "country", k } : null;
  }
  var UI = {
    launch: null,
    root: null,
    log: null,
    input: null,
    send: null,
    fresh: null,
    where: null,
    /** a hidden polite live region: the finished answer is read out once, not on every streamed word */
    said: null
  };
  var ws = null;
  var opening = null;
  var shown = false;
  var turn2 = null;
  var quiet;
  var pendingMap = null;
  function sessionId(fresh2 = false) {
    let id = null;
    try {
      if (!fresh2) id = sessionStorage.getItem(SESSION_KEY);
    } catch {
    }
    if (!id || !/^[a-z0-9]{8,40}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = "bc" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      try {
        sessionStorage.setItem(SESSION_KEY, id);
      } catch {
      }
    }
    return id;
  }
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (opening) return opening;
    opening = new Promise((ok, fail) => {
      let sock;
      try {
        sock = new WebSocket(SOCKET + sessionId());
      } catch {
        return fail(new Error("unreachable"));
      }
      let settled = false;
      const settle = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) fail(err);
        else ok();
      };
      const timer = setTimeout(() => {
        sock.close();
        settle(new Error("timeout"));
      }, OPEN_TIMEOUT);
      sock.onmessage = (e) => {
        const m = parseInbound(e.data);
        if (!m) return;
        if (m.type === "hello") {
          ws = sock;
          if (!shown && !turn2) restore(m.transcript);
          shown = true;
          settle(null);
        } else onEvent(m);
      };
      sock.onerror = () => settle(new Error("unreachable"));
      sock.onclose = () => {
        settle(new Error("closed"));
        if (ws !== sock) return;
        ws = null;
        if (turn2) finish3("The connection to the copilot dropped before the answer finished.");
      };
    }).finally(() => {
      opening = null;
    });
    return opening;
  }
  function post(msg) {
    ws?.send(JSON.stringify(msg));
  }
  function context() {
    const a = here().kind === "country" ? areaForCopilot() : null;
    return {
      selection: a ? { kind: "custom", name: a.name, bbox: a.bbox, series: a.series } : null,
      view: here().kind === "country" ? onMap().view() : null,
      layer: null
    };
  }
  function onMap() {
    const at = here();
    return at.kind === "country" && !at.full ? { host: "gMap", country: glanceCountry, view: glanceView, focus: glanceFocus, marks: glanceMarks } : { host: "cMap", country: mapCountry, view: mapView, focus: mapFocus, marks: mapMarks };
  }
  var scroll = () => {
    if (UI.log) UI.log.scrollTop = UI.log.scrollHeight;
  };
  function nextMonth() {
    return MONTHS[((/* @__PURE__ */ new Date()).getMonth() + 1) % 12];
  }
  function starters(at) {
    const m = nextMonth();
    if (at.kind === "country" && areaForCopilot())
      return ["Was 2025 unusual for this area?", "When is the fire season here?", `What should we expect here in ${m}?`];
    if (at.kind === "country" && at.name) {
      const n = theName(at.name);
      return [
        `Was 2025 an unusual fire year for ${n}?`,
        `Which parts of ${n} should I watch in ${m}?`,
        `What were the worst fire years in ${n}?`
      ];
    }
    if (at.kind === "state") {
      const n = stateName(at.st);
      return [`Which counties in ${n} should I watch in ${m}?`, `Was 2025 unusual for ${n}?`, `Is fire increasing in ${n}?`];
    }
    if (at.kind === "compare") return ["Compare New York State and California in 2025", "When is fire season in New York State?"];
    return [
      `Where should I watch for fire in ${m}?`,
      "Which countries had the most fire in 2025?",
      "What is a hotspot, and where does the data come from?"
    ];
  }
  function chips(list4, cls) {
    const box2 = h("div", `askChips ${cls}`);
    for (const q of list4) {
      const b = h("button", "", q);
      b.type = "button";
      b.onclick = () => ask(q);
      box2.appendChild(b);
    }
    return box2;
  }
  function welcome() {
    const at = here(), box2 = h("div", "askWelcome");
    box2.appendChild(
      h(
        "p",
        "",
        "Ask about fire anywhere on Earth since 2000: a country, a province, a county, a month or a year. When it finds a place this site covers, it opens that page for you."
      )
    );
    box2.appendChild(h("p", "askTry", whereLabel(at) ? `Try, for ${whereLabel(at)}` : "Try"));
    box2.appendChild(chips(starters(at), "start"));
    return box2;
  }
  var hooks = {
    /* the drawn area is already on the page: bring its map into view instead of opening anything */
    go: (p) => p.id === "custom" ? document.getElementById("cMap")?.scrollIntoView({ behavior: "smooth", block: "center" }) : gotoPlace(p, true),
    focus: (name, b) => gotoPlace({ id: "", name, label: name, level: 2, b, g: null }, true)
  };
  function botBlock(cards2, text2) {
    const m = h("div", "askMsg bot");
    for (const c of cards2) m.appendChild(cardEl(c, hooks));
    const t = h("div", "askText");
    prose(t, text2);
    m.appendChild(t);
    return m;
  }
  function restore(items) {
    const log = UI.log;
    log.textContent = "";
    if (!items.length) {
      log.appendChild(welcome());
      return;
    }
    items.forEach((it, i) => {
      if (it.role === "user") log.appendChild(userBlock(it.text.replace(NOTE_RE, "")));
      else {
        log.appendChild(botBlock(it.cards, it.text));
        if (i === items.length - 1 && it.choices.length) log.appendChild(chips(it.choices, "follow"));
      }
    });
    scroll();
  }
  function userBlock(text2, said = false) {
    const m = h("div", "askMsg user"), p = m.appendChild(h("p"));
    if (said) p.appendChild(h("span", "askVia", "Said"));
    p.append(text2);
    return m;
  }
  var IDLE_HINT = "Ask about a place, a month or a year";
  function setBusy(b) {
    UI.root?.classList.toggle("busy", b);
    UI.log?.setAttribute("aria-busy", String(b));
    if (UI.send) UI.send.disabled = b;
    if (UI.fresh) UI.fresh.disabled = b;
    if (UI.input) UI.input.placeholder = b ? "Wait for this answer\u2026" : IDLE_HINT;
    voiceBusy(b);
  }
  var seeIt = () => innerWidth <= 600 ? { label: "See it", run: () => close(true) } : void 0;
  function noteDid(text2, button) {
    const target = turn2 ? turn2.box : UI.log?.lastElementChild;
    if (!(target instanceof HTMLElement)) return null;
    const p = target.appendChild(h("p", "askDid", text2));
    if (button) {
      const b = p.appendChild(h("button", "askSee", button.label));
      b.type = "button";
      b.onclick = button.run;
    }
    scroll();
    return p;
  }
  function noteMoved(text2) {
    turn2?.moved?.remove();
    const p = noteDid(text2, seeIt());
    if (turn2) turn2.moved = p;
  }
  function ask(raw, said = false) {
    const q = raw.trim().slice(0, 500);
    if (!q || turn2) return;
    const log = UI.log;
    log.querySelector(".askWelcome")?.remove();
    log.querySelectorAll(".askChips.follow,.askOffline,.askConnecting").forEach((x) => x.remove());
    if (UI.said) UI.said.textContent = "";
    log.appendChild(userBlock(q, said));
    const box2 = h("div", "askMsg bot"), status = h("div", "askStatus"), statusText = h("span", "", "Connecting");
    status.append(h("span", "askPulse"), statusText);
    const live = {
      box: box2,
      status,
      statusText,
      cards: h("div", "askCards"),
      text: h("div", "askText"),
      raw: "",
      suggest: [],
      choices: [],
      question: q,
      hash: location.hash,
      cardCount: 0,
      frame: 0,
      offered: [],
      said,
      moved: null
    };
    box2.append(status, live.cards, live.text);
    log.appendChild(box2);
    turn2 = live;
    scroll();
    if (UI.input) {
      UI.input.value = "";
      UI.input.style.height = "";
    }
    setBusy(true);
    const at = here(), note = placeNote(at), text2 = note && !namesAPlace(q) ? `${q} ${note}` : q;
    connect().then(
      () => {
        if (turn2 !== live) return;
        live.statusText.textContent = "Thinking";
        post({ type: "chat", text: text2, context: context() });
        wait2();
      },
      () => {
        if (turn2 === live) finish3("unreachable");
      }
    );
  }
  function wait2() {
    clearTimeout(quiet);
    quiet = setTimeout(() => finish3("No answer came back from the copilot."), QUIET_LIMIT);
  }
  function draw3(t) {
    if (t.frame) return;
    t.frame = requestAnimationFrame(() => {
      t.frame = 0;
      prose(t.text, t.raw);
      scroll();
    });
  }
  function onEvent(m) {
    const t = turn2;
    if (!t) return;
    wait2();
    switch (m.type) {
      case "action":
        act(m.action, t);
        return;
      case "status":
        t.statusText.textContent = m.text || "Working";
        break;
      case "card":
        if (t.cardCount >= MAX_CARDS) return;
        t.cardCount++;
        t.cards.appendChild(cardEl(m.card, hooks));
        for (const s2 of m.card.suggest) if (t.suggest.length < MAX_SUGGEST && !t.suggest.includes(s2)) t.suggest.push(s2);
        break;
      case "delta":
        if (t.raw.length >= MAX_TEXT) return;
        t.raw = (t.raw + m.text).slice(0, MAX_TEXT);
        t.status.hidden = true;
        draw3(t);
        return;
      case "retract":
        t.raw = "";
        t.text.textContent = "";
        t.status.hidden = false;
        break;
      case "choices":
        t.choices = m.options;
        break;
      case "error":
        finish3(m.message);
        return;
      case "done":
        finish3();
        return;
      case "hello":
        return;
    }
    scroll();
  }
  function finish3(error) {
    const t = turn2;
    if (!t) return;
    turn2 = null;
    clearTimeout(quiet);
    t.status.remove();
    if (t.frame) cancelAnimationFrame(t.frame);
    t.frame = 0;
    prose(t.text, t.raw);
    if (error && ws) {
      const old = ws;
      ws = null;
      old.close();
    }
    if (UI.said) UI.said.textContent = error ? error === "unreachable" ? UNREACHABLE : error : t.text.textContent || "Answer ready.";
    if (error) {
      const box2 = h("div", "askError");
      box2.appendChild(h("p", "", error === "unreachable" ? UNREACHABLE : error));
      const again = h("button", "askAgain", "Try again");
      again.type = "button";
      again.onclick = () => {
        const asked = t.box.previousElementSibling;
        if (asked?.classList.contains("user")) asked.remove();
        t.box.remove();
        ask(t.question, t.said);
      };
      box2.appendChild(again);
      t.box.appendChild(box2);
    } else if (t.choices.length) UI.log.appendChild(chips(t.choices, "follow"));
    else if (t.suggest.length) UI.log.appendChild(chips(t.suggest.slice(0, 3), "follow"));
    setBusy(false);
    scroll();
    if (innerWidth > 900 && UI.root && !UI.root.hidden) UI.input?.focus();
    if (t.said && !error) voiceAnswer(t.raw);
  }
  var UNREACHABLE = "Can't reach the copilot at hotspotters.compare. It may be down, or this network may block it.";
  function newConversation() {
    if (turn2) return;
    voiceStop();
    pendingMap = null;
    mapMarks([]);
    glanceMarks([]);
    UI.log.textContent = "";
    UI.log.appendChild(welcome());
    shown = true;
    if (ws && ws.readyState === WebSocket.OPEN) post({ type: "reset" });
    else {
      sessionId(true);
      opening?.then(
        () => post({ type: "reset" }),
        () => {
        }
      );
    }
  }
  function mapPad() {
    const pad2 = { right: 0, bottom: 0 }, root = UI.root, host = document.getElementById(onMap().host);
    if (!root || root.hidden || !host) return pad2;
    const r = root.getBoundingClientRect(), m = host.getBoundingClientRect();
    if (r.left > m.left + 120) pad2.right = Math.max(0, m.right - r.left);
    else pad2.bottom = Math.max(0, m.bottom - r.top);
    return pad2;
  }
  function showMapSection() {
    const at = here();
    if (at.kind === "country" && !at.full) return;
    const host = document.getElementById("cMap");
    if (!host) return;
    const r = host.getBoundingClientRect();
    if (r.bottom < 80 || r.top > innerHeight - 120) host.scrollIntoView({ block: "center" });
  }
  function marksFor(list4) {
    return list4.map((p, i) => ({ name: p.name, tone: MARK_TONES[i % MARK_TONES.length], geometry: p.g, box: p.b }));
  }
  function frame(k, list4, focus) {
    const run = () => {
      const M = onMap();
      if (M.country() !== k) return;
      const drawn = list4.filter((p) => p.b || p.g);
      M.marks(marksFor(drawn));
      const b = focus ?? union(drawn.map((p) => p.b).filter((x) => x !== null));
      if (b) M.focus(b, mapPad(), 8);
      showMapSection();
    };
    if (onMap().country() === k) run();
    else {
      pendingMap = { k, run, until: Date.now() + 25e3 };
      tickPending();
    }
  }
  function tickPending() {
    const p = pendingMap;
    if (!p) return;
    if (onMap().country() === p.k) {
      pendingMap = null;
      setTimeout(p.run, 300);
    } else if (Date.now() > p.until || here().kind !== "country") {
      pendingMap = null;
      const at = here();
      if (at.kind === "country" && at.k === p.k) noteDid(`${nameOf(p.k)}'s map did not load, so nothing was framed on it.`);
    } else setTimeout(tickPending, 400);
  }
  function union(bs) {
    if (!bs.length) return null;
    return bs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])]);
  }
  function followed() {
    if (turn2) turn2.hash = location.hash;
  }
  function gotoPlace(p, byHand = false, shapes = [], focus = null) {
    if (p.id === "world") return;
    const dest2 = destOf(p), at = here();
    if (!dest2) {
      if (byHand) noteDid(`${p.name} is not on a page of this site.`);
      return;
    }
    if (dest2.kind === "state") {
      const here0 = at.kind === "state" && at.st === dest2.st, counties = shapes.filter((s2) => s2.level === 2), county2 = p.level === 2 ? p : counties.length && !focus ? counties[0] : null;
      if (!here0) {
        go(dest2.st);
        followed();
      }
      const cname = county2 ? stateCounty(dest2.st, countyName(county2.name), location.hash) : "";
      if (cname) {
        const others = counties.filter((c) => c.label !== county2.label).map((c) => `${countyName(c.name)} County`), also = others.length ? ` It shows one county at a time; also named: ${others.join(", ")}.` : "";
        if (here0) noteDid(`Zoomed to ${cname} County.${also}`, seeIt());
        else noteMoved(`Opened ${NAME[dest2.st]} and zoomed to ${cname} County.${also}`);
        return;
      }
      if (!here0) noteMoved(`Opened ${NAME[dest2.st]}.`);
      else if (byHand) scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const onIt = at.kind === "country" && at.k === dest2.k, list4 = shapes.length ? shapes : p.level >= 1 && p.b ? [p] : [];
    if (!onIt) {
      const name = theName(nameOf(dest2.k));
      noteMoved(
        list4.length === 1 ? `Opened ${name} and framed ${list4[0].name}.` : list4.length ? `Opened ${name} and framed ${list4.length} places.` : `Opened ${name}.`
      );
      goCountry(dest2.k);
      followed();
    }
    if (list4.length || focus) {
      if (onIt) noteDid(outlined(list4), seeIt());
      frame(dest2.k, list4, focus);
    } else if (onIt && byHand) showMapSection();
  }
  var countyName = (name) => name.replace(/\s+County$/i, "").trim();
  var outlined = (list4) => list4.length === 1 ? `Outlined ${list4[0].name} on the map.` : list4.length ? `Outlined ${list4.length} places on the map.` : "Moved the map.";
  function offerPlace(p, t, run) {
    const dest2 = destOf(p);
    if (!dest2) return;
    const at = here();
    if (dest2.kind === "state" ? at.kind === "state" && at.st === dest2.st : at.kind === "country" && at.k === dest2.k) return;
    const name = dest2.kind === "state" ? NAME[dest2.st] : nameOf(dest2.k);
    if (t.offered.includes(name)) return;
    t.offered.push(name);
    noteDid(`This answer is about ${name}.`, { label: `Open ${name}`, run });
  }
  var countryOf = (p) => {
    const d = destOf(p);
    return d?.kind === "country" ? d.k : null;
  };
  function mapHere() {
    const at = here();
    return at.kind === "country" && at.k && onMap().country() === at.k ? at.k : null;
  }
  var placeOf = (hash) => hash.replace(/^#[cg]\//, "#k/");
  var stateOf = (p) => {
    const d = destOf(p);
    return d?.kind === "state" ? d.st : null;
  };
  function act(a, t) {
    const moved = placeOf(location.hash) !== placeOf(t.hash);
    if (a.type === "goto" && a.place.id === "custom") return;
    if (a.type === "outline") {
      const places2 = a.places.filter((p) => p.id !== "custom");
      if (!places2.length) return;
      a = { ...a, places: places2 };
    } else if (a.type === "mark") {
      const places2 = a.places.filter((p) => p.id !== "custom"), focus = a.focus?.id === "custom" ? null : a.focus;
      if (!places2.length && !focus) return;
      a = { ...a, places: places2, focus };
    }
    switch (a.type) {
      case "goto":
        if (moved) return offerPlace(a.place, t, () => gotoPlace(a.place, true));
        return gotoPlace(a.place);
      case "outline":
      case "mark": {
        const focusPlace = a.type === "mark" && a.focus && a.focus.level >= 1 ? a.focus : null, k = moved ? null : mapHere();
        if (k) {
          const list4 = a.places.filter((p) => p.level >= 1 && countryOf(p) === k), focus2 = focusPlace && countryOf(focusPlace) === k ? focusPlace.b : null;
          if (list4.length || focus2) {
            frame(k, list4, focus2);
            noteDid(outlined(list4), seeIt());
            return;
          }
        }
        const lead2 = (a.type === "mark" ? a.focus : null) ?? a.places[0];
        if (!lead2) return;
        const dest2 = countryOf(lead2), st = stateOf(lead2), shapes = dest2 ? a.places.filter((p) => p.level >= 1 && countryOf(p) === dest2) : st ? a.places.filter((p) => p.level === 2 && stateOf(p) === st) : [], focus = dest2 && focusPlace && countryOf(focusPlace) === dest2 ? focusPlace.b : null;
        if (moved) return offerPlace(lead2, t, () => gotoPlace(lead2, true, shapes, focus));
        return gotoPlace(lead2, false, shapes, focus);
      }
      case "highlight": {
        const p = a.parent, k = moved ? null : mapHere();
        if (p && p.level >= 1 && p.b && k && countryOf(p) === k) onMap().focus(p.b, mapPad(), 8);
        return;
      }
    }
  }
  function syncPlace() {
    const at = here(), paper = at.kind === "country" && at.full;
    for (const el of [UI.launch, UI.root]) el?.classList.toggle("paper", paper);
    document.body.dataset.askView = at.kind === "country" && !at.full ? "glance" : at.kind;
    if (UI.where) UI.where.textContent = whereLabel(at);
    const w = UI.log?.querySelector(".askWelcome");
    if (w) w.replaceWith(welcome());
  }
  function open() {
    const { root, launch } = UI;
    if (!root || !launch) return;
    syncPlace();
    root.hidden = false;
    launch.hidden = true;
    launch.setAttribute("aria-expanded", "true");
    if (!shown && !UI.log.childElementCount) UI.log.appendChild(h("p", "askConnecting", "Connecting to the copilot\u2026"));
    if (innerWidth <= 600) root.setAttribute("aria-modal", "true");
    else root.removeAttribute("aria-modal");
    setTimeout(() => (innerWidth > 900 ? UI.input : root)?.focus(), 60);
    connect().catch(() => {
      if (shown || turn2) return;
      const log = UI.log;
      log.textContent = "";
      log.appendChild(welcome());
      shown = true;
      const box2 = h("div", "askError askOffline");
      box2.appendChild(
        h("p", "", "Can't reach the copilot at hotspotters.compare right now. You can still ask; it will try again when you send.")
      );
      log.appendChild(box2);
    });
  }
  function close(keepReading = false) {
    const { root, launch } = UI;
    if (!root || !launch) return;
    voiceStop(keepReading);
    root.hidden = true;
    launch.hidden = false;
    launch.setAttribute("aria-expanded", "false");
    launch.focus();
  }
  function trapTab(e, root) {
    const all = [...root.querySelectorAll("button,textarea,a[href]")].filter((x) => !x.hasAttribute("disabled") && x.offsetParent);
    if (!all.length) return;
    const first = all[0], last = all[all.length - 1], now = document.activeElement;
    if (e.shiftKey && (now === first || now === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && now === last) {
      e.preventDefault();
      first.focus();
    }
  }
  var MARK = () => {
    const m = h("span", "askMark");
    m.setAttribute("aria-hidden", "true");
    m.append(h("i"), h("i"), h("i"));
    return m;
  };
  function askAboutArea() {
    open();
    const log = UI.log;
    if (!log || turn2) return;
    if (!log.querySelector(".askWelcome")) {
      log.querySelectorAll(".askChips.area").forEach((x) => x.remove());
      log.appendChild(chips(starters(here()), "area"));
      scroll();
    }
    if (innerWidth > 600) UI.input?.focus();
  }
  function copilotInit() {
    window.addEventListener("ask-area", askAboutArea);
    const launch = h("button", "askLaunch");
    launch.type = "button";
    launch.id = "askLaunch";
    launch.setAttribute("aria-controls", "ask");
    launch.setAttribute("aria-expanded", "false");
    launch.append(MARK(), h("span", "askLT", "Ask the fire copilot"));
    launch.onclick = open;
    const root = h("section", "ask");
    root.id = "ask";
    root.hidden = true;
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Fire copilot");
    const head = h("header", "askHead"), title = h("div", "askTitle"), where = h("span", "askWhere"), fresh2 = h("button", "askNew", "New conversation"), shut = h("button", "askX");
    title.append(MARK(), h("b", "", "Fire copilot"), where);
    fresh2.type = shut.type = "button";
    fresh2.onclick = newConversation;
    shut.setAttribute("aria-label", "Close the copilot");
    shut.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';
    shut.onclick = () => close();
    head.append(title, fresh2, shut);
    const note = h("p", "askNote", HONESTY), log = h("div", "askLog"), said = h("div", "askSaid");
    said.setAttribute("role", "status");
    said.setAttribute("aria-live", "polite");
    const form = h("form", "askForm"), input = h("textarea"), send = h("button", "askSend");
    input.rows = 1;
    input.maxLength = 500;
    input.placeholder = IDLE_HINT;
    input.setAttribute("aria-label", "Your question");
    input.setAttribute("enterkeyhint", "send");
    send.type = "submit";
    send.setAttribute("aria-label", "Send");
    send.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5"/></svg>';
    form.append(input, send);
    form.onsubmit = (e) => {
      e.preventDefault();
      ask(input.value);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
      else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        ask(input.value);
      }
    });
    input.addEventListener("input", () => {
      input.style.height = "";
      input.style.height = Math.min(120, input.scrollHeight) + "px";
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !root.hidden) {
        e.stopPropagation();
        close();
      } else if (e.key === "Tab" && root.getAttribute("aria-modal") === "true") trapTab(e, root);
    });
    root.append(head, note, log, form, said);
    document.body.append(launch, root);
    Object.assign(UI, { launch, root, log, input, send, fresh: fresh2, where, said });
    voiceInit({ root, log, form, input, send, note, launch, open, ask: (q) => ask(q, true), busy: () => turn2 !== null });
    syncPlace();
    addEventListener("hashchange", () => setTimeout(syncPlace, 0));
    const sheet = document.getElementById("sheetWrap");
    if (sheet) {
      const track = () => document.body.classList.toggle("askOverSheet", !sheet.hidden);
      new MutationObserver(track).observe(sheet, { attributes: true, attributeFilter: ["hidden"] });
      track();
    }
  }

  // src/main.ts
  var fold3 = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^st /, "saint ");
  var ALIAS = {
    us: "United_States",
    usa: "United_States",
    "u s": "United_States",
    "u s a": "United_States",
    america: "United_States",
    "united states of america": "United_States",
    uk: "United_Kingdom",
    "u k": "United_Kingdom",
    britain: "United_Kingdom",
    "great britain": "United_Kingdom",
    england: "United_Kingdom",
    scotland: "United_Kingdom",
    wales: "United_Kingdom",
    "northern ireland": "United_Kingdom",
    "ivory coast": "Cote_d_Ivoire",
    drc: "Democratic_Republic_of_the_Congo",
    "dr congo": "Democratic_Republic_of_the_Congo",
    "congo kinshasa": "Democratic_Republic_of_the_Congo",
    "congo brazzaville": "Republic_of_Congo",
    burma: "Myanmar",
    czechia: "Czech_Republic",
    turkiye: "Turkey",
    "cabo verde": "Cape_Verde",
    "east timor": "Timor-Leste",
    "viet nam": "Vietnam",
    holland: "Netherlands",
    faeroe: "Faeroe_Islands",
    "faeroe islands": "Faeroe_Islands",
    swaziland: "Swaziland",
    macedonia: "Macedonia_Former_Yugoslav_Republic_of",
    micronesia: "Federated_States_of_Micronesia",
    uae: "United_Arab_Emirates",
    bosnia: "Bosnia_and_Herzegovina",
    "south korea": "Republic_of_Korea",
    "north korea": "Dem_Rep_Korea"
  };
  function heroSearch() {
    const list4 = [...STS.map((st) => ({ name: NAME[st], st })), ...WORLD.map((c) => ({ name: c.n, k: c.k }))];
    const fill = () => {
      $("countryList").innerHTML = list4.map((f) => f.name).sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");
    };
    fill();
    let asked = false;
    $("heroFind").onfocus = () => {
      if (asked) return;
      asked = true;
      loadIndex().then((idx) => {
        const have = new Set(WORLD.map((c) => c.k)), extra = idx.filter((c) => !have.has(c.country));
        if (!extra.length) return;
        list4.push(...extra.map((c) => ({ name: c.name, k: c.country })));
        fill();
      }).catch(() => asked = false);
    };
    const find = (q) => {
      const f = fold3(q);
      if (!f) return null;
      const alias = ALIAS[f];
      return list4.find((c) => fold3(c.name) === f || "k" in c && fold3(c.k) === f) || alias && list4.find((c) => "k" in c && c.k === alias) || list4.find((c) => fold3(c.name).startsWith(f)) || /* a word inside the name, such as "guinea" in "Papua New Guinea"; not single letters or pairs */
      f.length >= 3 && list4.find((c) => (" " + fold3(c.name)).includes(" " + f)) || null;
    };
    const open2 = (hit) => {
      $("heroFind").value = "";
      $("heroMsg").textContent = "";
      $("heroFind").blur();
      if ("st" in hit) go(hit.st);
      else goCountry(hit.k);
    };
    $("heroForm").onsubmit = (e) => {
      e.preventDefault();
      const q = $("heroFind").value, hit = find(q);
      if (hit) open2(hit);
      else $("heroMsg").textContent = q.trim() ? `No country called "${q.trim()}". Try another spelling.` : "Type a country's name.";
    };
    $("heroFind").oninput = (e) => {
      $("heroMsg").textContent = "";
      if (e instanceof InputEvent && e.inputType && e.inputType !== "insertReplacementText") return;
      const v = fold3($("heroFind").value), hit = list4.find((c) => fold3(c.name) === v);
      if (hit) open2(hit);
    };
  }
  function init() {
    const yo = [];
    for (let y = Y0; y <= Y1; y++) yo.push(`<option>${y}</option>`);
    $("yTo").innerHTML = $("fY").innerHTML = yo.join("");
    $("yFrom").innerHTML = yo.slice(0, FULL_Y1 - Y0 + 1).join("");
    $("yFrom").value = String(Y0);
    $("yTo").value = String(Y1);
    $("fM").innerHTML = MON.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    $("yFrom").onchange = $("yTo").onchange = (e) => {
      let a = +$("yFrom").value, b = +$("yTo").value;
      if (a > b) {
        if (e.target.id === "yFrom") b = a;
        else a = b;
      }
      S.yFrom = a;
      S.yTo = b;
      $("yFrom").value = String(a);
      $("yTo").value = String(b);
      stopPlay();
      if (S.show.y && (S.show.y < a || S.show.y > b)) S.show = { t: "all" };
      render();
    };
    $("fM").onchange = $("fY").onchange = () => {
      S.focus = [+$("fY").value, +$("fM").value];
      render();
    };
    $("pal").onchange = (e) => {
      S.pal = e.target.value;
      render();
    };
    $("rmMap").innerHTML = $("rmSheet").innerHTML = MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
    $("rmMap").onchange = $("rmSheet").onchange = (e) => {
      S.rm = +e.target.value;
      render();
    };
    document.querySelectorAll("#layerSeg button").forEach(
      (b) => b.onclick = () => {
        stopPlay();
        S.layer = b.dataset.layer;
        if (S.layer !== "count") S.show = { t: "all" };
        render();
        if (S.layer === "outlook" && S.st) olStart(S.st);
      }
    );
    $("town").onchange = (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) return;
      const ts = hexState(S.st).towns, t = ts.find((t2) => t2.n.toLowerCase() === q) || ts.find((t2) => t2.n.toLowerCase().startsWith(q));
      if (!t) {
        $("hint").textContent = `No town or city called "${e.target.value}" in ${NAME[S.st]}.`;
        return;
      }
      e.target.value = "";
      S.sel = { type: "circle", lat: t.lat, lon: t.lon, rad: 15, label: t.n };
      render();
      centerOn(t.lon, t.lat, 2400);
    };
    tileProbe();
    $("drawBtn").onclick = () => setDraw(!S.draw);
    $("stnChk").onchange = (e) => {
      S.stn = e.target.checked;
      mapDraw();
    };
    const tr = $("tlTrack");
    let tlDrag = false;
    const yearAt = (e) => {
      const r = tr.getBoundingClientRect(), n = S.yTo - S.yFrom + 1;
      return S.yFrom + Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n)));
    };
    const setYear2 = (y) => {
      stopPlay();
      if (S.layer === "count" && S.show.t === "year" && S.show.y === y) return;
      S.layer = "count";
      S.show = { t: "year", y };
      render();
    };
    tr.onpointerdown = (e) => {
      tr.setPointerCapture(e.pointerId);
      tlDrag = true;
      setYear2(yearAt(e));
    };
    tr.onpointermove = (e) => {
      if (tlDrag) setYear2(yearAt(e));
    };
    tr.onpointerup = tr.onpointercancel = () => {
      tlDrag = false;
    };
    tr.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1, cur2 = S.show.t === "year" ? S.show.y : d > 0 ? S.yFrom - 1 : S.yTo + 1;
      setYear2(Math.max(S.yFrom, Math.min(S.yTo, cur2 + d)));
    };
    $("showReset").onclick = () => {
      stopPlay();
      S.show = { t: "all" };
      render();
    };
    $("play").onclick = $("playMap").onclick = togglePlay;
    $("toGlobe").onclick = () => {
      location.hash = "";
    };
    $("swap").onclick = () => {
      location.hash = SLUG[STS.find((k) => k !== S.st)];
    };
    $("openData").onclick = () => openSheet("area");
    $("openCmp").onclick = () => openSheet("compare");
    $("heroCmp").onclick = () => {
      location.hash = "compare";
    };
    $("shClose").onclick = $("scrim").onclick = () => closeSheet();
    $("seeMap").onclick = () => closeSheet();
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && S.sheet) closeSheet();
    });
    document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => openSheet(b.dataset.tab));
    const usePt = (lat, lon, rad2) => {
      if (!isFinite(lat) || !isFinite(lon) || !(rad2 > 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        $("dlMsg").textContent = "Enter a latitude, a longitude and a radius first.";
        return;
      }
      S.sel = { type: "circle", lat, lon, rad: rad2 };
      zoomSel();
      render();
      $("sheet").scrollTop = 0;
    };
    $("applyPt").onclick = () => usePt(parseFloat($("lat").value), parseFloat($("lon").value), parseFloat($("rad").value));
    $("preset").onclick = () => {
      const p = PRESET[S.st];
      $("lat").value = String(p.lat);
      $("lon").value = String(p.lon);
      $("rad").value = String(p.rad);
      S.focus = p.focus.slice();
      S.show = { t: "ym", y: p.focus[0], m: p.focus[1] };
      usePt(p.lat, p.lon, p.rad);
    };
    document.querySelectorAll("#modeSeg button").forEach(
      (b) => b.onclick = () => {
        S.mode = b.dataset.mode;
        render();
      }
    );
    document.querySelectorAll(".pick,.tag").forEach((b) => {
      b.onclick = () => go(b.dataset.st);
      b.onmouseenter = () => G2.hover && G2.hover(b.dataset.st);
      b.onmouseleave = () => G2.hover && G2.hover(null);
    });
    heroSearch();
    countryEvents();
    glanceEvents();
    $("dlCal").onclick = csvCal;
    $("dlHot").onclick = csvHot;
    $("dlFc").onclick = csvForecast;
    $("dlFcC").onclick = csvForecastCounty;
    mapEvents();
    respEvents();
    oddsEvents();
    olEvents();
    copilotInit();
    let rt2;
    addEventListener("resize", () => {
      clearTimeout(rt2);
      rt2 = setTimeout(() => {
        if (!S.st) return;
        mapSize();
        const f = fitView(hexState(S.st));
        V.fit = f.s;
        Object.assign(V, fitView(selBounds()));
        mapDraw();
      }, 120);
    });
    globeInit().catch(() => $("hero").classList.add("noglobe"));
    addEventListener("hashchange", route);
    route();
  }
  init();
})();
