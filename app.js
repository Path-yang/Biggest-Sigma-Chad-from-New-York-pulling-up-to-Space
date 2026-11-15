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
    focus: [2024, 10],
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

  // src/model.ts
  var STATE_EPOCHS = { vi0: VI0, aq0: AQ0, bins: D.meta.bins };
  function harmWith(s, e, i, T, A, V2) {
    const m = i % 12;
    if (i >= e.vi0) return { h: V2, lo: V2, hi: V2, src: "VIIRS observed" };
    const terraOnly = i < e.aq0, h = terraOnly ? T * s.r_t[m] : (T + A) * s.r_ta[m], src = terraOnly ? "MODIS Terra, converted" : "MODIS Terra+Aqua, converted";
    if (h === 0) return { h: 0, lo: 0, hi: s.zero_hi, src };
    let b = 0;
    while (b < e.bins.length && h > e.bins[b]) b++;
    return { h, lo: h * s.pi[b][0], hi: h * s.pi[b][1], src };
  }
  var harm = (st, i, T, A, V2) => harmWith(D.states[st], STATE_EPOCHS, i, T, A, V2);
  var HX = {};
  function hexState(st) {
    if (HX[st]) return HX[st];
    const s = D.states[st], n = s.hexes.length / 3, R = s.hex_r, K = s.hex_k, S3 = Math.sqrt(3);
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
      const q = s.hexes[3 * k], r = s.hexes[3 * k + 1];
      o.q[k] = q;
      o.r[k] = r;
      o.c[k] = s.hexes[3 * k + 2];
      o.X[k] = R * S3 * (q + r / 2);
      o.Y[k] = R * 1.5 * r;
      o.key.set(q + "," + r, k);
    }
    const rows = s.hex_rows;
    for (let p = 0; p < rows.length; p += 5) o.H[rows[p] * NM + rows[p + 1]] = harm(st, rows[p + 1], rows[p + 2], rows[p + 3], rows[p + 4]).h;
    o.x0 = Math.min(...o.X) - R;
    o.x1 = Math.max(...o.X) + R;
    o.y0 = Math.min(...o.Y) - R;
    o.y1 = Math.max(...o.Y) + R;
    o.geo = D.geo[st];
    o.geoByFips = {};
    o.geo.forEach((g) => o.geoByFips[g.f] = g);
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
    const sn = pl.stn.length, stn = o.stn = { n: sn, X: new Float32Array(sn), Y: new Float32Array(sn), c: new Int16Array(sn), names: pl.stn };
    for (let i = 0; i < sn; i++) {
      stn.X[i] = pl.stn_xy[2 * i] * K;
      stn.Y[i] = pl.stn_xy[2 * i + 1];
      const k = o.key.get(hexKey(stn.X[i], stn.Y[i], R));
      stn.c[i] = k === void 0 ? -1 : o.c[k];
    }
    return HX[st] = o;
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
    const s = D.states[st], T = new Float64Array(NM), A = new Float64Array(NM), V2 = new Float64Array(NM);
    const byCounty = sel.type === "state" || sel.type === "county", rows = byCounty ? s.county_rows : s.hex_rows, mask = byCounty ? null : maskFor(st, sel);
    for (let p = 0; p < rows.length; p += 5) {
      const k = rows[p];
      if (byCounty ? sel.type === "state" || k === sel.ci : mask[k]) {
        const i = rows[p + 1];
        T[i] += rows[p + 2];
        A[i] += rows[p + 3];
        V2[i] += rows[p + 4];
      }
    }
    const R = analyseSeries({ T, A, V: V2, y0: Y0, yFrom: S.yFrom, yTo: S.yTo, vi0: VI0, harm: (i, t, a, v) => harm(st, i, t, a, v) });
    return { st, ...R };
  }
  function analyseSeries(o) {
    const { T, A, V: V2 } = o;
    const ser = [];
    for (let i = (o.yFrom - o.y0) * 12; i < (o.yTo - o.y0 + 1) * 12; i++)
      ser.push(
        Object.assign({ i, y: o.y0 + Math.floor(i / 12), m: i % 12, T: T[i], A: A[i], V: V2[i] }, o.harm(i, T[i], A[i], V2[i]))
      );
    const quant = (a, q) => {
      const z = a.slice().sort((x, y) => x - y), p = (z.length - 1) * q, f = Math.floor(p);
      return z[f] + (z[Math.min(z.length - 1, f + 1)] - z[f]) * (p - f);
    };
    const stats = MON.map((_, m) => {
      const a = ser.filter((r) => r.m === m).map((r) => r.h);
      return { med: quant(a, 0.5), q1: quant(a, 0.25), q3: quant(a, 0.75), sum: a.reduce((x, y) => x + y, 0) };
    });
    ser.forEach((r) => {
      r.med = stats[r.m].med;
      r.ratio = (r.h + 1) / (r.med + 1);
    });
    const years = [];
    for (let y = o.yFrom; y <= o.yTo; y++) {
      const rr = ser.filter((r) => r.y === y), sum = (k) => rr.reduce((a, r) => a + r[k], 0);
      years.push({ y, h: sum("h"), lo: sum("lo"), hi: sum("hi"), naive: rr.reduce((a, r) => a + (r.i >= o.vi0 ? r.V : r.T + r.A), 0) });
    }
    const total2 = stats.reduce((a, z) => a + z.sum, 0), order = stats.map((z, m) => ({ m, sum: z.sum })).sort((a, b) => b.sum - a.sum), ranked = years.slice().sort((a, b) => b.h - a.h);
    return { ser, stats, years, total: total2, mean: total2 / years.length, order, ranked };
  }
  function verdict(R, focus = S.focus) {
    const [fy, fm] = focus, f = R.ser.find((r) => r.y === fy && r.m === fm);
    if (!f) return null;
    const same = R.ser.filter((r) => r.m === fm).map((r) => r.h), n = same.length, rank = same.filter((v) => v > f.h).length + 1, pct4 = same.filter((v) => v < f.h).length / Math.max(1, n - 1) * 100, med = R.stats[fm].med;
    let label = "Typical", cls = "";
    if (!(f.h === 0 && med === 0)) {
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
      mult: med > 0 ? times(f.h / med) + " a normal " + MON[fm] : fmt(f.h) + (fmt(f.h) === "1" ? " hotspot" : " hotspots")
    };
  }
  var riskYears = () => {
    const a = Math.max(S.yFrom, 2012);
    return a <= S.yTo ? [a, S.yTo] : [S.yFrom, S.yTo];
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
    const s = D.states[st], [a, b] = riskYears(), ny = b - a + 1, nc = s.counties.length, M = new Float64Array(nc * ny), hx = hexState(st), nf = notFire(st), fire = new Float64Array(nc), rows = s.county_rows;
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
    return s.counties.map((c, ci) => {
      const v = Array.from(M.subarray(ci * ny, (ci + 1) * ny)), k = v.filter((x) => x > 0).length, sum = v.reduce((x, y) => x + y, 0);
      return {
        ci,
        name: c.name,
        k,
        n: ny,
        p: k / ny,
        mean: sum / ny,
        hotShare: all ? sum / all : 0,
        e: fire[ci],
        share: fireAll ? fire[ci] / fireAll : 0
      };
    }).sort((x, y) => y.e - x.e || y.p - x.p);
  }
  var leadText = (R) => R.total === 0 ? "No fire hotspots were detected here in these years. Try a larger area." : `Fire activity here peaks in ${MONL[R.order[0].m]}. ${R.ranked[0].y} was the most active year on record, ${times(R.ranked[0].h / R.mean).replace("\xD7", "")} times an average year.`;
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
    let n = 0, near2 = 1e9, c = null, rad = null;
    if (sel.type === "hex") {
      c = [hx.X[sel.k] / hx.K, hx.Y[sel.k]];
      rad = 15;
    } else if (sel.type === "circle") {
      c = [sel.lon, sel.lat];
      rad = sel.rad;
    }
    for (let i = 0; i < sn.n; i++) {
      const lon = sn.X[i] / hx.K, lat = sn.Y[i];
      if (c) {
        const d = kmBetween(c[0], c[1], lon, lat);
        if (d <= rad) n++;
        if (d < near2) near2 = d;
      } else if (sel.type === "state" || sel.type === "county" && sn.c[i] === sel.ci || sel.type === "box" && lon >= sel.w && lon <= sel.e && lat >= sel.s && lat <= sel.n)
        n++;
    }
    return { n, near: c ? near2 : null, rad };
  }
  var placeName = () => {
    const s = S.sel, hx = hexState(S.st);
    return s.type === "state" ? NAME[S.st] : s.type === "hex" ? "Near " + nearestTown(S.st, hx.X[s.k] / hx.K, hx.Y[s.k]).n : s.type === "county" ? D.states[S.st].counties[s.ci].name + " County" : s.type === "box" ? "Your drawn area" : s.label ? `Around ${s.label}` : `${s.rad} km around ${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}`;
  };
  function hexKey(X, Y, R) {
    const q = (Math.sqrt(3) / 3 * X - Y / 3) / R, r = 2 / 3 * Y / R, s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
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
  var hex3 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
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
  function showTip(e, text) {
    tip.textContent = text;
    tip.style.display = "block";
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 12)) + "px";
    tip.style.top = Math.max(8, e.clientY - h - 10) + "px";
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
    let s = "";
    for (let k = 0; k <= n; k++) {
      const v = ymax * k / n, y = m.t + ph * (1 - k / n);
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.1)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${fy(v)}</text>`;
    }
    return s;
  }
  function bars(el, xs, vals, o) {
    const W = 560, H = o.h || 240, m = { l: 42, r: 8, t: 18, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b, n = xs.length, bw = pw / n;
    const ymax = niceMax(Math.max(1e-9, ...vals) * 1.08), Y = (v) => m.t + ph * (1 - Math.min(1, v / ymax));
    const hid = "hatch" + ++hatchN;
    let s = HATCH(hid) + grid(W, m, ph, ymax, short, 2);
    vals.forEach((v, i) => {
      const x = m.l + bw * i + 1.5, w = Math.max(1, bw - 3), y = Y(v), cx = x + w / 2;
      s += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0.5, m.t + ph - y)}" rx="3" fill="${o.hatch && o.hatch(i) ? `url(#${hid})` : "#ff8a3d"}" ${o.sel === i ? 'stroke="#fff" stroke-width="2"' : ""}/>`;
      if (o.lo && o.whisk(i))
        s += `<line x1="${cx}" x2="${cx}" y1="${Y(o.lo[i])}" y2="${Y(o.hi[i])}" stroke="#dfe5ee" stroke-width="1.3"/>`;
      if (o.top && o.top.includes(i)) s += `<text class="hl" x="${cx}" y="${y - 5}" text-anchor="middle">${xs[i]}</text>`;
      if (i % (o.step || 1) === 0) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${xs[i]}</text>`;
    });
    if (o.avg != null) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.avg)}" y2="${Y(o.avg)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
    vals.forEach(
      (v, i) => s += `<rect data-i="${i}" x="${m.l + bw * i}" y="${m.t}" width="${bw}" height="${ph + 18}" fill="transparent" style="cursor:pointer"/>`
    );
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${s}</svg>`;
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
    let s = grid(W, m, ph, ymax, fy, 2);
    if (o.band && o.band.n > 1) {
      const b = o.band, up = [], down = [];
      for (let i = 0; i < b.n; i++) {
        up.push(`${X(i)},${Y(b.hi[i])}`);
        down.unshift(`${X(i)},${Y(b.lo[i])}`);
      }
      s += `<path d="M${up.concat(down).join("L")}Z" fill="${b.c}" stroke="none"/>`;
    }
    xs.forEach((x, i) => {
      if (i % Math.ceil(n / (o.every || 7)) === 0) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${x}</text>`;
    });
    if (o.vline >= 0)
      s += `<line x1="${X(o.vline)}" x2="${X(o.vline)}" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" stroke-dasharray="3 3"/><text class="hl" x="${X(o.vline) + 5}" y="${m.t + 10}">VIIRS starts</text>`;
    if (o.base != null)
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.base)}" y2="${Y(o.base)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
    sers.forEach((z) => {
      let d = "", on = false;
      z.v.forEach((v, i) => {
        if (!Number.isFinite(v)) on = false;
        else {
          d += `${on ? "L" : "M"}${X(i)},${Y(v)}`;
          on = true;
        }
      });
      s += `<path d="${d}" fill="none" stroke="${z.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${z.dash ? ` stroke-dasharray="${z.dash}"` : ""}/>`;
    });
    if (o.labels) {
      const ends = sers.filter((z) => Number.isFinite(z.v[n - 1])).map((z) => ({ z, y: Y(z.v[n - 1]) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      const over = ends.length ? ends[ends.length - 1].y - (m.t + ph - 6) : 0;
      if (over > 0) ends.forEach((e) => e.y -= over);
      ends.forEach(
        (e) => s += `<circle cx="${X(n - 1)}" cy="${Y(e.z.v[n - 1])}" r="4" fill="${e.z.c}" stroke="#0b0f18" stroke-width="2"/><text class="hl" x="${X(n - 1) + 9}" y="${e.y + 4}">${e.z.name}</text>`
      );
    }
    s += `<line id="xh" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">${s}</svg>`;
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
    const lmax = Math.log1p(Math.max(1, ...R.ser.map((r) => r.h))), cmp = !!o.compact, yFrom = R.years[0].y, yTo = R.years[R.years.length - 1].y, focus = o.focusYM || S.focus, vi0 = o.vi0 ?? VI0;
    el.style.gridTemplateColumns = cmp ? "34px repeat(12,minmax(0,1fr))" : "44px repeat(12,minmax(0,1fr)) 70px";
    let h = `<div></div>` + MON.map((m) => `<div class="h">${cmp ? m[0] : m}</div>`).join("") + (cmp ? "" : `<div class="h" style="text-align:right">Year total</div>`);
    for (let y = yTo; y >= yFrom; y--) {
      if (y === 2011 && yTo >= 2012)
        h += `<div class="split">${cmp ? "converted from MODIS below" : "seen by VIIRS above \xB7 converted from MODIS below"}</div>`;
      h += `<div class="y">${y}</div>`;
      for (let m = 0; m < 12; m++) {
        const r = R.ser[(y - yFrom) * 12 + m], c = o.mode === "anom" ? div(Math.log2(r.ratio) / 3) : r.h === 0 ? [22, 28, 40] : seq(0.06 + 0.94 * Math.log1p(r.h) / lmax);
        h += `<button type="button" ${cmp ? 'tabindex="-1"' : ""} class="c${o.focus && focus[0] === y && focus[1] === m ? " focus" : ""}" data-i="${r.i}" style="background:${rgb(c)};color:${inkOn(c)}" aria-label="${MON[m]} ${y}: ${fmt(r.h)} hotspots">${cmp || r.h === 0 ? "" : short(r.h)}</button>`;
      }
      if (!cmp) h += `<div class="t">${fmt(R.years[y - yFrom].h)}</div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll(".c").forEach((b) => {
      const r = R.ser[+b.dataset.i - R.ser[0].i];
      b.onmousemove = (e) => showTip(
        e,
        `${MONL[r.m]} ${r.y}: ${fmt(r.h)} ${fmt(r.h) === "1" ? "hotspot" : "hotspots"}
Normal for ${MON[r.m]}: ${fmt(r.med)}
${r.src}` + (r.i < vi0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "") + (o.more ? "\n" + o.more(r) : "")
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
      const h = arr.length / 2;
      v = true;
      for (let i = 0; i < h && v; i++) if (arr[i] !== arr[h + i]) v = false;
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
      for (let h = 0; h < n; h++)
        if (mask[h] && L2[h * NM + i]) {
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
  function estMin(cal, km, extraA, extraB) {
    let b = 0;
    while (b + 1 < cal.bands_km.length && cal.bands_km[b + 1] <= km) b++;
    return Math.max(km / cal.floor_kmh * 60, km / cal.kmh[b] * 60 + extraA + extraB);
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
    const hx = hexState(st), off = gcKm(lon, lat, hexLon(st, k), hexLat(st, k)), far = off >= LEG_KM && r.e10[k] !== -9999, eK = extraOf(r, k), leg = far ? estMin(r.cal, off, 0, eK) : 0, fj = hx.f.key.get(hexKey(lon * hx.K, lat, hx.f.R)), fs = fj === void 0 ? -1 : r.fine.s[fj], fine = fs >= 0 ? { i: fs, name: hx.stn.names[fs][0], min: r.fine.min10[fj] / 10 } : null, rows = [];
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
    if (fine && rows.length && !rows.some((s) => s.i === fine.i) && fine.min < rows[rows.length - 1].min)
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
      let c = 0, s = 0;
      for (let y = a; y <= b; y++) {
        const v = hx.H[k * NM + (y - Y0) * 12 + m];
        if (v > 0) c++;
        s += v;
      }
      p[k] = c / n;
      e[k] = s / n;
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
    const r = respOf(st), list2 = [];
    let far = 0, maxCrow = 0;
    for (let k = 0; k < r.n; k++) {
      const crow = r.crow10[k] / 10;
      if (crow > maxCrow) maxCrow = crow;
      if (crow <= GAP_KM) continue;
      far++;
      if (risk.p[k] >= minP - 1e-9) list2.push(k);
    }
    list2.sort((x, y) => risk.p[y] - risk.p[x] || r.crow10[y] - r.crow10[x]);
    return { list: list2, far, maxCrow };
  }
  var splitCache = /* @__PURE__ */ new Map();
  function splitFor(st, m) {
    const key = st + "|" + m, hit = splitCache.get(key);
    if (hit) return hit;
    const hx = hexState(st), f = hx.f, r = respOf(st), bit = 1 << m, acc = Array.from({ length: hx.n }, () => /* @__PURE__ */ new Map());
    for (let j = 0; j < f.n; j++) {
      if (!(f.mm[j] & bit)) continue;
      const k = hx.key.get(hexKey(f.X[j], f.Y[j], hx.R));
      if (k === void 0) continue;
      const s = r.fine.s[j];
      acc[k].set(s, (acc[k].get(s) || 0) + 1);
    }
    const out = acc.map((mp, k) => {
      let t = 0;
      mp.forEach((v) => t += v);
      if (!t) return [r.top[3 * k], 1];
      const o = [];
      mp.forEach((v, s) => o.push(s, v / t));
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
        const s = p[q];
        if (s < 0) {
          none += wk * p[q + 1];
          continue;
        }
        hexes[s]++;
        E[s] += wk * p[q + 1];
        if (wk > top[s]) top[s] = wk;
      }
    }
    const past = !risk.fc, hot = new Float64Array(past ? ns : 0), K = new Uint16Array(past ? ns : 0), seen = new Int32Array(past ? ns : 0).fill(-1), nf = notFire(st);
    if (past)
      for (let y = risk.a; y <= risk.b; y++)
        for (let k = 0; k < hx.n; k++) {
          const h = hx.H[k * NM + (y - Y0) * 12 + m];
          if (!(h > 0) || nf[k]) continue;
          const p = parts[k];
          for (let q = 0; q < p.length; q += 2) {
            const s = p[q];
            if (s < 0) continue;
            hot[s] += h * p[q + 1];
            if (seen[s] !== y) {
              seen[s] = y;
              K[s]++;
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
    for (let s = 0; s < N && total2 > 0; s++) {
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
          by[k] = s;
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
        const g = greedyPlan(st, tr.p, T, N).sites.map((s) => s.k), cov = coveredNow(st, T), reach = reachFor(st, T), busy3 = [];
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
    let h = "";
    if (RT.focusStn >= 0) h += focusHtml(st, mo);
    if (tool === "gap") h += gapHtml(st, mo);
    else if (tool === "plan") h += planHtml(st, mo);
    const t = respTarget();
    if (t) h += closestHtml(st, t);
    else if (tool === "near")
      h += `<p class="hint">Click anywhere in ${NAME[st]} to see the three stations with the shortest drive. Turn this off to click into counties again.</p>`;
    else if (!tool && RT.focusStn < 0)
      h += `<p class="hint">Find the stations closest to any spot, the places where fire is common but every station is more than ${GAP_KM} km away, or where extra crews would reach the most fire.</p>`;
    $("respOut").innerHTML = h;
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
    const how2 = (s) => s.via === "patch" ? `by road to the 2 km patch at ${from}` : s.via === "leg" ? `${mins(s.minC)} min (${km1(s.km)} km) by road to the hexagon centre, then about ${mins(s.min - s.minC)} min to ${from}` : s.via === "line" ? `estimated from the straight line` : `${km1(s.km)} km by road`;
    const rows = c.rows.map(
      (s, j) => `<button type="button" class="nr" data-stn="${s.i}"><span class="bd">${j + 1}</span><b>${esc(s.name)}</b><span class="mn">${s.via === "leg" || s.via === "line" ? "~" : ""}${mins(s.min)} min</span><small>${s.town ? esc(s.town) + " \xB7 " : ""}${how2(s)} \xB7 ${km1(s.crow)} km straight${spot ? " from " + from : ""}</small></button>`
    ).join("");
    const legNote = c.rows.some((s) => s.via === "leg" || s.via === "line") ? ` ${spot ? `${from.charAt(0).toUpperCase() + from.slice(1)} is` : "It is"} ${km1(c.off)} km from the centre of its ${hexKm(st)} km hexagon, where the road search ends, so a ~ time is estimated from straight-line distance: the drive to the centre plus the last stretch, or straight from the station, whichever is shorter. These estimates are often 15\u201330% off, and a closer station can be missing from the three.` : "";
    return head + `<div class="nl">${rows}</div><p class="hint">Road searches to the hexagon's centre${c.rows.some((s) => s.via === "patch") ? ", and to the 2 km patch at the spot where fire was seen there" : ""}, at set speeds for each kind of road, with no traffic. Estimated drives, not response times.${legNote}</p>` + (c.fine && !c.rows.some((s) => s.i === c.fine.i) ? `<p class="hint">Fire was seen in the 2 km patch here. Its fastest station by road is ${esc(c.fine.name)}, ${mins(c.fine.min)} min.</p>` : "");
  }
  function gapHtml(st, mo) {
    const { gaps, risk } = cur(), r = respOf(st), n = gaps.list.length, rule = gapRule(risk, mo), when = risk.fc ? `${mo} ${risk.fc}` : mo;
    if (!n)
      return `${srcLine(risk, mo)}<p class="big"><b>None</b> in ${when}.</p><p class="hint">No place in ${NAME[st]} has ${rule}. ${gaps.far ? `${fmt(gaps.far)} hexagons are over ${GAP_KM} km from a station (the farthest ${km1(gaps.maxCrow)} km), but ${risk.fc ? `none has that high a forecast chance in ${when}` : `they burn less often than that in ${mo}`}.` : `Every hexagon has a station within ${GAP_KM} km.`}</p>`;
    const rows = gaps.list.slice(0, 6).map((k) => gapRow(st, k, risk, r.crow10[k] / 10, r.min10[3 * k], r.top[3 * k])).join("");
    return `${srcLine(risk, mo)}<p class="big"><b>${n}</b> ${n === 1 ? "place" : "places"} to watch in ${when}</p><p class="hint"><i class="gk"></i>Outlined on the map: hexagons with ${rule}.</p><div class="nl">${rows}</div>` + (n > 6 ? `<button class="link" type="button" data-act="allGaps">See all ${n} in the full data</button>` : "");
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
    let h = srcLine(risk, mo) + `<div class="cov"><div><span>Today</span><b>${pc1(p.before)}</b></div><span class="arr">\u2192</span><div><span>With ${k} more ${k === 1 ? "crew" : "crews"}</span><b class="em">${pc1(end)}</b></div></div><div class="covBar" role="img" aria-label="${pc1(p.before)} covered today, ${pc1(end)} with the added crews"><i style="width:${(p.before * 100).toFixed(1)}%"></i><i class="add" style="width:${((end - p.before) * 100).toFixed(1)}%"></i></div><p class="hint">Share of ${mo}'s fire risk within ${T} minutes' drive of a station. Each hexagon counts by ${riskWords(risk, mo)}. Each crew below shows the percentage points it adds.</p>`;
    if (k < RT.planN)
      h += `<p class="hint">${k ? `Only ${k} ${k === 1 ? "crew adds" : "crews add"} anything.` : "No crew adds anything."} Every other place with fire in ${mo} is already within ${T} minutes or has no road link.</p>`;
    h += `<div class="nl">` + p.sites.map(
      (s, j) => `<button type="button" class="nr" data-go="${s.k}"><span class="bd site">${j + 1}</span><b>${esc(hexPlace(st, s.k))}</b><span class="mn">+${(s.gain * 100).toFixed(1)} pts</span><small>${esc(county(st, s.k))}</small></button>`
    ).join("") + `</div>`;
    if (test)
      h += `<p class="hint test"><b>${risk.fc ? "The method, checked on past years." : "Checked on later years."}</b> Sites chosen from ${test.train[0]}\u2013${test.train[1]} cover ${pc1(test.greedy)} of ${mo}'s fire risk in ${test.test[0]}\u2013${test.test[1]} (stations alone: ${pc1(test.today)}). Putting the same number of crews in the busiest places no station reaches in time covers ${pc1(test.busiest)}.</p>`;
    const err = calErrFor(respOf(st).cal, T), reach = reachMean(st, T);
    h += `<p class="hint">Each crew goes, one at a time, to the hexagon centre that brings the most still-uncovered fire risk within ${T} minutes. Stations use their road drive times; new sites use an estimate from straight-line distance` + (err ? `, typically ${err.lo === err.hi ? err.lo : `${err.lo}\u2013${err.hi}`}% off at ${err.km0}\u2013${err.km1} km in tests.` : ".") + (reach < 2 ? ` At ${T} minutes a new site reaches on average ${reach.toFixed(1)} of the ${hexKm(st)} km hexagons, mostly its own, so the planner picks nearly the same places as simply taking the busiest places no station reaches in time.` : "") + `</p>`;
    return h;
  }
  function focusHtml(st, mo) {
    const i = RT.focusStn, hx = hexState(st), row = cur().staff.rows.find((r) => r.i === i), risk = cur().risk, n = risk.n;
    if (risk.fc)
      return `<div class="rh"><span>${esc(hx.stn.names[i][0])}</span><button class="link" type="button" data-act="clearStn">Clear</button></div><p class="hint"><i class="sk"></i>${row ? `First to reach ${pct(row.share)} of ${NAME[st]}'s forecast fire risk for ${mo} ${risk.fc}, across the ${row.hexes} outlined ${row.hexes === 1 ? "hexagon" : "hexagons"}. The likeliest has a ${pctP(row.top || 0)} chance of fire.` : `None of the forecast fire risk for ${mo} ${risk.fc} falls in the area this station reaches first.`}</p>`;
    return `<div class="rh"><span>${esc(hx.stn.names[i][0])}</span><button class="link" type="button" data-act="clearStn">Clear</button></div><p class="hint"><i class="sk"></i>${row ? `First by road to ${pct(row.share)} of ${NAME[st]}'s ${mo} fire: about ${row.e < 10 ? row.e.toFixed(1) : fmt(row.e)} of the ${row.hexes} outlined ${row.hexes === 1 ? "hexagon" : "hexagons"} have fire in an average ${mo}. Fire there in ${row.k} of ${n} years, about ${fmt(row.hot || 0)} hotspots in an average ${mo}.` : `No fire in ${mo} falls in the area this station reaches first.`}</p>`;
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
    $("staffNote").textContent = staff.rows.length ? (risk.fc ? `These 8 stations are first by road to ${pct(top8)} of the state's forecast fire risk for ${mo} ${risk.fc}: each hexagon counts by its chance of fire, split among stations the way its ${mo} fire fell since 2012.` : `These 8 stations are first by road to ${pct(top8)} of the state's ${mo} fire; ${fmt(staff.stations)} stations are first to some. Each hexagon counts by its share of years with a hotspot, so a place that burns most years outweighs one huge fire.`) + (oneYear ? ` ${oneYear} of them ${oneYear === 1 ? "rests" : "rest"} on fire in a single year.` : "") + (staff.noneShare > 5e-4 ? ` ${pct(staff.noneShare)} of it falls where no station has a road link.` : "") + " Hotspots are what satellites saw burning, mostly in a few big wildfires: they are not calls or incidents, and this says nothing about how a station is staffed." : "";
    const n = gaps.list.length, r = respOf(st);
    $("gapTitle").textContent = `Far from a station in ${mo}${risk.fc ? " " + risk.fc : ""}: ${n} ${n === 1 ? "place" : "places"}`;
    $("gapNote").textContent = `Hexagons with ${gapRule(risk, mo)}. ` + (n ? "Tap one to see it on the map. The drive time is to the fastest station by road." : gaps.far ? `${fmt(gaps.far)} hexagons are over ${GAP_KM} km from a station (the farthest ${km1(gaps.maxCrow)} km), but none of them ${risk.fc ? "has that high a forecast chance" : "burns that often"} in ${mo}.` : "") + " Change the rule under Fire response on the map.";
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
    const R = window.RESPONSE, r = respOf(st), t = r.cal.test, o = (s) => window.RESPONSE[s].cal.test;
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
    if (RT.tool === "plan" && cur().risk.ptot) return curPlan().sites.map((s) => s.k);
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
      const hx = hexState(S.st), xs = [lon * hx.K, ...cl.rows.map((s) => hx.stn.X[s.i])], ys = [lat, ...cl.rows.map((s) => hx.stn.Y[s.i])], p = hx.R * 2, f = fitView({ x0: Math.min(...xs) - p, x1: Math.max(...xs) + p, y0: Math.min(...ys) - p, y1: Math.max(...ys) + p });
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
    const hexP = (k, s = 1) => {
      const x = sx2(hx.X[k]), y = sy2(hx.Y[k]);
      if (!on(x, y, rr)) return false;
      c.beginPath();
      if (rr < 3.5) {
        c.arc(x, y, 3, 0, 7);
        return true;
      }
      for (let a = 0; a < 6; a++) {
        const t2 = Math.PI / 180 * (30 + 60 * a);
        a ? c.lineTo(x + rr * s * Math.cos(t2), y - rr * s * Math.sin(t2)) : c.moveTo(x + rr * s * Math.cos(t2), y - rr * s * Math.sin(t2));
      }
      c.closePath();
      return true;
    };
    const badge = (x, y, txt, fill, ink, r = 9) => {
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
      if (label) badge(x + 13, y - 12, label, "#fff", "#04121c", 8.5);
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
      p.sites.forEach((s, j) => {
        const x = sx2(hx.X[s.k]), y = sy2(hx.Y[s.k]);
        if (on(x, y, 12)) badge(x, y, String(j + 1), EMBER, "#1b0c02", 10);
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
        for (const s of cl.rows) {
          c.moveTo(x0, y0);
          c.lineTo(sx2(hx.stn.X[s.i]), sy2(hx.stn.Y[s.i]));
        }
        c.stroke();
      }
      c.setLineDash([]);
      cl.rows.forEach((s, j) => station(s.i, String(j + 1)));
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
  function csvCal() {
    const R = analyseFor(S.st, S.sel), rows = [
      "year,month,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,median_for_calendar_month,ratio_to_median"
    ];
    R.ser.forEach(
      (r) => rows.push(
        [
          r.y,
          r.m + 1,
          r.h.toFixed(2),
          r.lo.toFixed(2),
          r.hi.toFixed(2),
          `"${r.src}"`,
          r.T,
          r.A,
          r.V,
          r.med.toFixed(2),
          r.med > 0 ? (r.h / r.med).toFixed(3) : ""
        ].join(",")
      )
    );
    save(`burn-calendar_${selSlug()}_${S.yFrom}-${S.yTo}.csv`, rows.join("\n"));
  }
  function csvHot() {
    const s = D.states[S.st], hx = hexState(S.st), mask = selMask(), cr = s.hex_rows, rows = [
      "hex_center_lat,hex_center_lon,county,year,month,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,harmonized_viirs_equivalent,source"
    ];
    for (let p = 0; p < cr.length; p += 5) {
      const k = cr[p], i = cr[p + 1], y = Y0 + Math.floor(i / 12);
      if (!mask[k] || y < S.yFrom || y > S.yTo) continue;
      const h = harm(S.st, i, cr[p + 2], cr[p + 3], cr[p + 4]);
      rows.push(
        [
          hx.Y[k].toFixed(3),
          (hx.X[k] / hx.K).toFixed(3),
          `"${s.counties[hx.c[k]].name}"`,
          y,
          i % 12 + 1,
          cr[p + 2],
          cr[p + 3],
          cr[p + 4],
          h.h.toFixed(2),
          `"${h.src}"`
        ].join(",")
      );
    }
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
    const F2 = fcData(), hx = hexState(st), s = D.states[st], n = hx.n, any = F2[st].any.p, L2 = largeOf(st), LM = largeMarked(st), [a, b] = riskYears(), [la, lb] = largeYears(), nf = notFire(st), pa = pastShares(n, a, b, (k, i) => !nf[k] && hx.H[k * NM + i] > 0), pl = L2 && LM ? pastShares(n, la, lb, (k, i) => LM[k * NM + i] === 1) : null, rows = [
      `state,county,hex_id,hex_center_lat,hex_center_lon,year,month,p_any${L2 ? ",p_large" : ""},past_any_${a}_${b}${pl ? `,past_large_${la}_${lb}` : ""}`
    ];
    for (let k = 0; k < n; k++) {
      if (!mask[k]) continue;
      const head = `${st},"${s.counties[hx.c[k]].name}",${k},${hx.Y[k].toFixed(4)},${(hx.X[k] / hx.K).toFixed(4)}`;
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
    const F2 = fcData(), hx = hexState(st), s = D.states[st], nc = s.counties.length, hexAny = F2[st].any.p, any = F2[st].any.county.slice(), L2 = largeOf(st), [a, b] = riskYears(), [la, lb] = largeYears(), seen = new Uint8Array(nc), fire = new Uint8Array(nc * NM), big = new Uint8Array(nc * NM), cr = s.county_rows;
    for (let k = 0; k < hx.n; k++) if (mask[k]) seen[hx.c[k]] = 1;
    for (let t = 0; t < 12 * FC_YEARS.length; t++)
      for (let k = 0; k < hx.n; k++) {
        const u = t * nc + hx.c[k];
        if (hexAny[t * hx.n + k] > any[u]) any[u] = hexAny[t * hx.n + k];
      }
    for (let p = 0; p < cr.length; p += 5) if (harm(st, cr[p + 1], cr[p + 2], cr[p + 3], cr[p + 4]).h > 0) fire[cr[p] * NM + cr[p + 1]] = 1;
    if (L2) {
      for (let p = 0; p < L2.past.county_rows.length; p += 4)
        if (L2.past.county_rows[p + 2] > 0) big[L2.past.county_rows[p] * NM + L2.past.county_rows[p + 1]] = 1;
    }
    const pa = pastShares(nc, a, b, (c, i) => fire[c * NM + i] === 1), pl = L2 ? pastShares(nc, la, lb, (c, i) => big[c * NM + i] === 1) : null, rows = [
      `state,county,fips,year,month,p_any${L2 && L2.county ? ",p_large" : ""},past_any_${a}_${b}${pl ? `,past_large_${la}_${lb}` : ""}`
    ];
    for (let c = 0; c < nc; c++) {
      if (!seen[c]) continue;
      FC_YEARS.forEach((y, yi) => {
        for (let m = 0; m < 12; m++) {
          const t = (yi * 12 + m) * nc + c;
          rows.push(
            `${st},"${s.counties[c].name}",${s.counties[c].fips},${y},${m + 1},${pm(any[t])}${L2 && L2.county ? "," + pm(L2.county[t]) : ""},${pa[c * 12 + m].toFixed(3)}${pl ? "," + pl[c * 12 + m].toFixed(3) : ""}`
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
  function countyOutlook(D2, S2, ci, today, rain, et0) {
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
    const base2 = S2.base[ci * 365 + doy365(today)] / 1e4;
    if (!(base2 > 0 && base2 < 1)) return null;
    const x = [Math.log(base2 / (1 - base2)), Math.log1p(rain14), dry / H, et14 / H, Math.log1p(rain30), (et30 - rain30) / T];
    let z = S2.coef[0];
    for (let j = 0; j < x.length; j++) z += S2.coef[j + 1] * x[j];
    const p = 1 / (1 + Math.exp(-z)), norm2 = 1 / (1 + Math.exp(-(S2.norm_coef[0] + S2.norm_coef[1] * x[0])));
    return { p, base: base2, ratio: p / base2, norm: norm2, wx_ratio: p / norm2, today };
  }
  function forecastUrl(st, cis, models) {
    const S2 = O().states[st], q = new URLSearchParams();
    q.set("latitude", cis.map((ci) => S2.pts[ci][0].toFixed(3)).join(","));
    q.set("longitude", cis.map((ci) => S2.pts[ci][1].toFixed(3)).join(","));
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
      const list2 = Array.isArray(j) ? j : [j];
      if (list2.length !== cis.length) throw new WeatherError("The weather service sent a forecast for the wrong number of places.");
      return list2.map((o) => o && typeof o === "object" && o.daily || {});
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
      const s = JSON.parse(raw);
      if (!s || typeof s.at !== "number" || !Array.isArray(s.rows) || s.rows.length !== O().states[st].pts.length) return null;
      const rows = s.rows.map((r) => r ? { p: r[0], base: r[1], ratio: r[0] / r[1], norm: r[2], wx_ratio: r[0] / r[2], today: r[3] } : null), run = finish(rows, s.fallback, s.at);
      return run.status === "ok" && fresh(st, run.at, run.today) ? run : null;
    } catch {
      return null;
    }
  }
  function toStore(st, run) {
    try {
      const s = { at: run.at, fallback: run.fallback, rows: run.rows.map((r) => r ? [r.p, r.base, r.norm, r.today] : null) };
      localStorage.setItem(storeKey(st), JSON.stringify(s));
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
  var yearsBetter = (s) => {
    const v = Object.values(s.bss_by_year);
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
      const n = r.rows.length, rows = r.rows.map((o, ci) => ({ o, ci })).filter((x) => !!x.o), list2 = sortBy === "p" ? rows.sort((a, b) => b.o.p - a.o.p || b.o.wx_ratio - a.o.wx_ratio) : rows.filter((x) => x.o.base >= RARE).sort((a, b) => b.o.wx_ratio - a.o.wx_ratio || b.o.p - a.o.p), shown = showAll ? list2 : list2.slice(0, 9), up = rows.filter((x) => raised(x.o)).length, down = rows.filter((x) => lowered(x.o)).length;
      $("olTitle").textContent = `Counties to watch in the next 14 days: ${olRange(st)}`;
      $("olNoteS").textContent = `Each county's chance of at least one VIIRS hotspot from ${dayName(r.today)} through ${dayName(r.end)}, from its usual odds for these dates and Open-Meteo's weather forecast. The weather raises the chance in ${up} of ${n} counties and lowers it in ${down}, against the model's chance with no weather. ` + (r.missing ? `${r.missing} ${r.missing === 1 ? "county has" : "counties have"} no forecast this time${r.err ? " (" + r.err.charAt(0).toLowerCase() + r.err.slice(1).replace(/\.$/, "") + ")" : ""}; Retry asks again. ` : "") + (sortBy === "p" ? "Ranked by chance. " : `Ranked by how much the weather raises the chance; counties where fire is usually under ${Math.round(RARE * 100)}% at this time of year are left out, since there the effect is mostly noise. `) + "A hotspot is a satellite detection, often a farm or prescribed burn: this is not a fire-danger rating. Tap a county to see it on the map.";
      $("olList").innerHTML = shown.map(
        ({ o, ci }, i) => `<button type="button" class="w" data-ci="${ci}"><span class="rk">${i + 1}</span><b>${esc2(D.states[st].counties[ci].name)}</b><span class="pc">${pct2(o.p)}</span><small>Usual for these dates ${pct2(o.base)}${o.base >= RARE ? ` \xB7 ${weatherCue(o)}` : " \xB7 fire is rare here now"}</small></button>`
      ).join("");
      $("olMore").textContent = showAll ? "Show the top 9" : `Show all ${list2.length}`;
      $("olMore").hidden = list2.length <= 9;
    }
    $("olList").querySelectorAll(".w").forEach(
      (b) => b.onclick = () => {
        closeSheet();
        stopPlay();
        S.layer = "outlook";
        setCounty(+b.dataset.ci);
      }
    );
    $("olHow").innerHTML = `Each county's <b>usual chance</b> is how often VIIRS saw a hotspot there in the same 14-day window of the year, ${so.climatology.years[0]}\u2013${so.climatology.years[1]}. A small model (a logistic regression, fitted on ${so.metrics.years[0]}\u2013${so.metrics.years[so.metrics.years.length - 1]}) nudges it with ${OM}'s ECMWF weather: rain and drying over the past 30 days and the next 14, above all the number of dry days ahead. <b>The test is generous:</b> it gave the model the weather that actually happened, and even then it beat the usual odds by only ${(sk.bss * 100).toFixed(1)}%. A real forecast goes wrong, more so in the second week, so expect less; real forecasts were not tested, because Open-Meteo's archive of past forecasts was beyond its free daily limit.`;
    const recal = bt["recalibrated climatology"], beyond = (s) => recal ? 1 - (1 - s.bss) / (1 - recal.bss) : null, sp = (x) => x == null ? "\u2013" : (x >= 0 ? "+" : "\u2212") + Math.abs(x * 100).toFixed(2) + "%";
    $("olTable").innerHTML = `<tr><th>Tested on ${so.metrics.years[0]}\u2013${so.metrics.years[so.metrics.years.length - 1]}, one year left out at a time</th><th>Brier</th><th>Against the usual odds</th><th>Against the recalibrated odds</th><th>AUC</th><th>Years better than usual</th></tr>` + ROWS.filter(([k]) => bt[k]).map(([k, lab]) => {
      const s = bt[k], base2 = k === "climatology", wx = !base2 && k !== "recalibrated climatology", last = k === ROWS[ROWS.length - 1][0];
      return `<tr><td class="u">${lab}</td><td>${s.brier.toFixed(4)}</td><td>${base2 ? "\u2013" : sp(s.bss)}</td><td class="${last ? "em" : ""}">${wx ? sp(beyond(s)) : "\u2013"}</td><td>${s.auc.toFixed(3)}</td><td>${base2 ? "\u2013" : yearsBetter(s)}</td></tr>`;
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
    $("shCrumb").textContent = (S.sel.type === "state" ? "State" : NAME[S.st]) + ` \xB7 ${S.yFrom}\u2013${S.yTo}`;
    $("shLead").textContent = leadText(R);
    if (R.total === 0) {
      $("a1").textContent = $("a2").textContent = "None";
      $("a1n").textContent = $("a2n").textContent = "";
    } else {
      const top2 = R.order.slice(0, 3);
      $("a1").textContent = top2.map((o) => MON[o.m]).join(", ");
      $("a1n").textContent = `These three months hold ${Math.round(top2.reduce((a, o) => a + o.sum, 0) / R.total * 100)}% of all hotspots. ${MONL[R.order[11].m]} is the quietest.`;
      $("a2").textContent = R.ranked.slice(0, 3).map((y) => y.y).join(", ");
      $("a2n").textContent = R.ranked.slice(0, 3).map((y) => `${y.y}: ${fmt(y.h)}${y.y < 2012 ? " (converted)" : ""}`).join(" \xB7 ") + `. An average year has ${fmt(R.mean)}.`;
    }
    const v = verdict(R);
    $("fM").value = String(S.focus[1]);
    $("fY").value = String(S.focus[0]);
    if (!v) {
      $("a3").textContent = "Outside the chosen years";
      $("a3n").textContent = "";
    } else {
      $("a3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
      $("a3n").textContent = `${fmt(v.f.h)} hotspots against a normal ${fmt(v.med)}. Rank ${v.rank} of ${v.n} years.` + (v.f.i < VI0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : " Seen directly by VIIRS.");
    }
    const rk = riskFor(R, S.rm), mo = MONL[S.rm];
    $("rmSheet").value = String(S.rm);
    $("a4").textContent = rk.n ? `${Math.round(rk.p * 100)}%` : "No data";
    $("a4n").textContent = rk.n ? `Fire was detected here in ${rk.k} of the ${rk.n} ${mo}s from ${rk.a} to ${rk.b}.` + (rk.k ? ` When it burns, typically ${fmt(rk.typical)} hotspots; the worst was ${fmt(rk.worst.h)} in ${rk.worst.y}. Most recent: ${rk.last}.` : "") + " History, not a forecast." + notFireNote(S.st, selMask()) + forecastLine(S.st) : "";
    const share = (x) => x >= 0.095 ? Math.round(x * 100) + "%" : x >= 1e-3 ? (x * 100).toFixed(1) + "%" : x > 0 ? "<0.1%" : "0%", who = window.RESPONSE ? "Counties, and the stations that reach each place first by road," : "Counties";
    if (isFc() && fcOn(S.st)) {
      const yr = S.odds;
      $("watchTitle").textContent = `Where to watch in ${mo} ${yr}: forecast`;
      $("watchNote").textContent = `${who} ranked by their share of ${NAME[S.st]}'s forecast fire risk for ${mo} ${yr}: each hexagon counts by its chance of at least one hotspot. The forecast is built from fire history alone, not weather, and says nothing about how each station is staffed. Tap one to see it on the map.`;
      $("watch").innerHTML = countyRiskFc(S.st, S.rm, yr).slice(0, 8).map(
        (w, i) => `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${share(w.share)}</span><small>Chance of fire somewhere in the county ${pctP(w.p)} \xB7 about ${w.e < 10 ? w.e.toFixed(1) : fmt(w.e)} of its hexagons expected to burn</small></button>`
      ).join("");
    } else {
      const wl = countyRisk(S.st, S.rm).slice(0, 8);
      $("watchTitle").textContent = `Where to watch in ${mo}: past odds`;
      $("watchNote").textContent = `${who} ranked by how often fire comes to their hexagons in ${mo}, ${rk.a}\u2013${rk.b}: each hexagon counts by its share of years with a hotspot, so a place that burns most years outweighs one huge fire. The percentage is their share of ${NAME[S.st]}'s. This is the historical pattern, not a forecast for this year. Hotspots are what satellites saw burning, not calls or incidents, and this says nothing about how a station is staffed. Tap one to see it on the map.`;
      $("watch").innerHTML = wl.map(
        (w, i) => `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${share(w.share)}</span><small>Fire in ${w.k} of ${w.n} ${mo}s \xB7 about ${w.e < 10 ? w.e.toFixed(1) : fmt(w.e)} of its hexagons burn in an average ${mo} \xB7 about ${fmt(w.mean)} hotspots</small></button>`
      ).join("");
    }
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
    const sh = S.show, ys = R.years, xs = ys.map((y) => y.y), pick = (show) => {
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
        click: (m) => pick(sh.t === "cmonth" && sh.m === m ? { t: "all" } : { t: "cmonth", m })
      }
    );
    const top = [];
    ys.map((y, i) => [y.h, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).forEach((a) => {
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
        lo: ys.map((y) => y.lo),
        hi: ys.map((y) => y.hi),
        whisk: (i) => xs[i] < 2012,
        tip: (i) => `${xs[i]}: ${fmt(ys[i].h)} hotspots
${R.mean > 0 ? (ys[i].h >= R.mean ? "+" : "") + Math.round((ys[i].h / R.mean - 1) * 100) + "% against the average year" : ""}` + (xs[i] < 2012 ? `
Converted from MODIS, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "\nSeen by VIIRS"),
        click: (i) => pick(sh.t === "year" && sh.y === xs[i] ? { t: "all" } : { t: "year", y: xs[i] })
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
    $("calNote").textContent = S.mode === "count" ? "Every month of every year, newest at the top. Brighter means more hotspots. Tap a month to test whether it was unusual and to put it on the map." : "Red months ran above what is normal for that month, blue months below. Tap a month to test it.";
    paintRamp("calRamp", S.mode === "count" ? seq : (t) => div(t * 2 - 1));
    $("calLo").textContent = S.mode === "count" ? "fewer" : "\u215B\xD7 normal";
    $("calHi").textContent = S.mode === "count" ? "more (log scale)" : "8\xD7 normal";
    lines(
      $("chSeam"),
      xs,
      [
        { v: ys.map((y) => y.naive), c: "#6fa8ff" },
        { v: ys.map((y) => y.h), c: "#ff8a3d" }
      ],
      {
        W: 660,
        vline: xs.indexOf(2012),
        aria: "Raw joined counts against the harmonized record",
        tip: (i) => `${xs[i]}
Harmonized: ${fmt(ys[i].h)}
Raw counts: ${fmt(ys[i].naive)}`
      }
    );
    const avg = (a, b, k) => {
      const r = ys.filter((y) => y.y >= a && y.y <= b);
      return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
    };
    const n0 = avg(2007, 2011, "naive"), n1 = avg(2012, 2016, "naive"), h0 = avg(2007, 2011, "h"), h1 = avg(2012, 2016, "h");
    $("seamNote").textContent = n0 && h0 && n1 != null && h1 != null && S.sel.type === "state" ? `Raw counts make 2012\u20132016 look ${(n1 / n0).toFixed(1)}\xD7 busier than 2007\u20132011. In the harmonized record the step is ${(h1 / h0).toFixed(1)}\xD7.` : "The blue line jumps in 2012 only because the sensor changed. Choose the whole state and all years to measure the step.";
    const s = D.states[S.st], val = s.val, pc2 = (x) => Math.round(x * 100) + "%";
    $("tiles").innerHTML = `<div class="tile"><b>${val.raw_factor.toFixed(1)}\xD7</b><span>more hotspots from VIIRS than MODIS for the same fires in ${NAME[S.st]}</span></div><div class="tile"><b>${pc2(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div><div class="tile"><b>${pc2(val.annual_max_err)}</b><span>error in the worst tested year</span></div>`;
    $("maskTxt").textContent = `${s.mask.static_sites} sites removed in ${NAME[S.st]}.`;
    $("rates").innerHTML = `<tr><th>Rate</th>${MON.map((m) => `<th>${m}</th>`).join("")}</tr><tr><td>Terra+Aqua</td>${s.r_ta.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr><tr><td>Terra only</td>${s.r_t.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
    $("mapNote").hidden = sh.t === "all" || S.layer === "chance";
    $("mapNoteTxt").textContent = "The map behind now shows: " + showLabel().toLowerCase() + ".";
  }
  function cmpStats(st) {
    const R = analyseFor(st, { type: "state" }), s = D.states[st], tot = new Float64Array(s.counties.length), i0 = (S.yFrom - Y0) * 12, i1 = (S.yTo - Y0 + 1) * 12, rows = s.county_rows;
    for (let p = 0; p < rows.length; p += 5) {
      const i = rows[p + 1];
      if (i >= i0 && i < i1) tot[rows[p]] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
    }
    let k = 0;
    for (let c = 1; c < tot.length; c++) if (tot[c] > tot[k]) k = c;
    let acc = 0, season = 0;
    for (const o of R.order) {
      if (acc >= 0.8 * R.total) break;
      acc += o.sum;
      season++;
    }
    return {
      st,
      R,
      mean: R.mean,
      dens: R.mean / LAND_KM2[st] * 1e3,
      peak: R.order[0].m,
      season,
      worst: R.ranked[0],
      worstX: R.mean ? R.ranked[0].h / R.mean : 0,
      county: s.counties[k].name,
      countyShare: R.total ? tot[k] / R.total : 0
    };
  }
  function renderCompare() {
    const C = STS.map(cmpStats), big = C.slice().sort((a, b) => b.mean - a.mean)[0], small = C.find((c) => c !== big);
    $("shTitle").textContent = STS.map((k) => NAME[k]).join(" and ");
    $("shCrumb").textContent = `Compare states \xB7 ${S.yFrom}\u2013${S.yTo}`;
    $("cmpLead").textContent = small.mean > 0 ? `${NAME[big.st]} records about ${Math.round(big.mean / small.mean)} times as many fire hotspots as ${NAME[small.st]} in an average year, and ${Math.round(big.dens / small.dens)} times as many for its size. ${NAME[small.st]} burns mostly in ${MONL[small.peak]}; ${NAME[big.st]} in ${MONL[big.peak]}.` : "";
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
    let h = `<div class="sh"></div>` + C.map((c) => `<div class="sh"><i style="background:${STC[c.st]}"></i>${NAME[c.st]}</div>`).join("");
    for (const [label, val, num, sub] of rowsDef) {
      const mx = num ? Math.max(...C.map(num)) : 0;
      h += `<div class="sl">${label}</div>` + C.map(
        (c) => `<div class="sv"><b>${val(c)}</b>${sub ? `<small>${sub(c)}</small>` : ""}${num ? `<div class="bar" style="width:${mx ? Math.max(0.5, num(c) / mx * 100) : 0}%;background:${STC[c.st]}"></div>` : ""}</div>`
      ).join("");
    }
    $("score").innerHTML = h;
    const key = C.map((c) => `<span><i style="background:${STC[c.st]};height:3px"></i>${NAME[c.st]}</span>`).join("");
    $("cmpKey1").innerHTML = $("cmpKey2").innerHTML = key;
    const share = (c) => c.R.stats.map((z) => c.R.total ? z.sum / c.R.total * 100 : 0), idx = (c) => c.R.years.map((y) => c.mean ? y.h / c.mean : 0), xs = C[0].R.years.map((y) => y.y);
    lines(
      $("chCmpMonths"),
      MON,
      C.map((c) => ({ name: NAME[c.st], c: STC[c.st], v: share(c) })),
      {
        W: 560,
        h: 250,
        labels: true,
        every: 12,
        fy: (v) => Math.round(v) + "%",
        aria: "Share of yearly hotspots by month, by state",
        tip: (m) => MONL[m] + "\n" + C.map((c) => `${NAME[c.st]}: ${share(c)[m].toFixed(1)}% of its year`).join("\n")
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
  var verdictWord = (s) => s >= 0.1 ? "clearly better than" : s >= 0.02 ? "modestly better than" : s > 5e-3 ? "slightly better than" : s > -5e-3 ? "about the same as" : "worse than";
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
    const big = S.fire === "large", F2 = fcData(), mo = MONL[S.rm];
    let h;
    if (isFc()) {
      const bt = F2.backtest[st].hex, low = runsLow(st);
      h = big ? `<b>Forecast for ${monthWhen()}</b>: chance a large fire starts and reaches each hexagon, from fire history alone, not weather.<span class="more"> It picks out the likelier places and months better than past odds but cannot tell a big fire year from a quiet one.</span>` : `<b>Forecast for ${monthWhen()}</b>: chance of at least one hotspot, from fire history alone, not weather.<span class="more"> Tested on 2018\u20132025, ${verdictWord(bt.brier_skill_vs_history)} past odds.</span>` + (low > 0.1 ? ` In tests it ran ${Math.round(low * 100)}% low overall.` : "");
      if (S.odds === 2027 && fcSame(st, big ? "large" : "any"))
        h += ` <span class="more">The 2027 map equals 2026's: the model found no trend to carry forward here.</span>`;
    } else if (big) {
      const [a, b] = largeYears();
      h = `<b>Past odds of a large fire</b> (1,000+ acres)<span class="more"> on CAL FIRE's fire perimeter maps</span> in ${mo}, ${a}\u2013${b}. History, not a forecast.`;
    } else {
      const [a, b] = [Math.max(S.yFrom, 2012), S.yTo];
      h = `<b>Past odds</b>: share of ${mo}s ${a <= b ? `${a}\u2013${b}` : `${S.yFrom}\u2013${S.yTo}`} with a hotspot. History, not a forecast.`;
    }
    if (!L2) h += ` <span title="${esc3(NY_WHY)}">Large fires: California only.</span>`;
    $("oddsNote").innerHTML = h;
    $("oddsNote").title = L2 ? "" : NY_WHY;
  }
  function chanceCard(R) {
    const st = S.st, sl = S.sel, mo = MON[S.rm], big = S.fire === "large" && !!largeOf(st);
    if (!isFc() || !fcOn(st)) {
      if (big) {
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
    const year = S.odds, fire = big ? "large" : "any", w = fcHex(st, fire, year, S.rm), what = big ? "a large fire" : "fire", q = `${big ? "Large fire" : "Fire"}, ${mo} ${year} forecast`;
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
    let s = 0, n = 0;
    for (let k = 0; k < w.length; k++)
      if (m[k]) {
        s += w[k];
        n++;
      }
    return {
      q: `Hexagons with ${big ? "large " : ""}fire, ${mo} ${year}`,
      v: "\u2248 " + (s < 10 ? s.toFixed(1) : fmt(s)),
      title: `Expected number of the ${fmt(n)} hexagons here with ${big ? "a large fire" : "at least one hotspot"} in ${MONL[S.rm]} ${year}: the sum of their forecast chances.` + (!big && runsLow(st) > 0.1 ? ` In tests ${NAME[st]} totals ran about ${Math.round(runsLow(st) * 100)}% low, so this is probably too low.` : "")
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
      let s = 0;
      for (let k = 0; k < w.length; k++) if (m[k]) s += w[k];
      return "about " + (s < 10 ? s.toFixed(1) : fmt(s)) + " hexagons with fire";
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
    const B = F2.backtest[st], L2 = largeOf(st), h = B.hex, c = B.county, lh = L2 ? L2.backtest.hex.horizon_1y : null, lc = L2 ? L2.backtest.county.horizon_1y : null;
    let v = `Any fire: <b>${verdictWord(Math.min(h.brier_skill_vs_history, c.brier_skill_vs_history))} past odds</b>. Predicting each year 2018\u20132025 from the years before it, its Brier score was ${pctGain(h.brier_skill_vs_history)} lower for hexagons (better in ${h.years_model_better_brier} years) and ${pctGain(c.brier_skill_vs_history)} lower for counties.`;
    if (lh && lc)
      v += ` Large fires: <b>${verdictWord(lh.brier_skill_vs_history_alone)} past odds</b> for hexagons (${pctGain(lh.brier_skill_vs_history_alone)} lower), only ${pctGain(lh.brier_skill_vs_state_seasonal_average)} better than the state's plain seasonal average, and ${verdictWord(lc.brier_skill_vs_history_alone)} past odds for counties.`;
    $("fcVerdict").innerHTML = v;
    const same = [fcSame(st, "any") && "hexagons", fcSame(st, "any", true) && "counties"].filter(Boolean);
    $("fcNote").textContent = `It gives the chance of at least one hotspot in each hexagon and county, in each month of 2026 and 2027${L2 ? ", and in California the chance that a large fire (1,000+ acres) starts and reaches it" : ""}. It is built from fire history alone: no weather, fuel or ignitions. So it is the long-run chance for the month, not a warning that a given month will be unusual. Pick Forecast 2026 or 2027 on the map's Chance of fire layer, or above, to use it.` + (same.length ? ` For ${NAME[st]} ${same.join(" and ")}, any fire, 2027's chances are the same as 2026's: the backtest chose no trend term there, so the two years differ only in how far ahead they were tested.` : "");
    $("dlFcNote").textContent = "The forecast for every month of 2026 and 2027, for the area chosen above, with past odds alongside. Chances run from 0 to 1; 0 means under 0.0005." + (same.length ? ` For ${NAME[st]} ${same.join(" and ")}, the 2027 rows repeat 2026's any-fire chances.` : "") + " The county file gives a county at least its likeliest hexagon's chance, as the page does.";
    const row = (u, m) => `<tr><td class="u">${u}</td><td>${br(m.model.brier)}</td><td>${br(m.history_alone.brier)}</td><td class="em">${pctGain(m.brier_skill_vs_history)}</td><td>${auc(m.model.auc)}</td><td>${auc(m.history_alone.auc)}</td><td>${m.years_model_better_brier}</td><td>${pctGain(m.horizon2.brier_skill_vs_history)}</td></tr>`;
    const lrow = (u, b) => `<tr><td class="u">${u}</td><td>${br(b.horizon_1y.model.brier)}</td><td>${br(b.horizon_1y.history_alone.brier)}</td><td class="em">${pctGain(b.horizon_1y.brier_skill_vs_history_alone)}</td><td>${auc(b.horizon_1y.model.auc)}</td><td>${auc(b.horizon_1y.history_alone.auc)}</td><td>\u2013</td><td>${pctGain(largeSkill2(b.horizon_2y))}</td></tr>`;
    $("fcTable").innerHTML = `<tr><th>Tested on 2018\u20132025</th><th>Brier, forecast</th><th>Brier, past odds</th><th>Lower by</th><th>AUC, forecast</th><th>AUC, past odds</th><th>Years better</th><th>2 years ahead, lower by</th></tr><tr class="grp"><td colspan="8">Any fire: at least one hotspot</td></tr>` + row("Hexagons", h) + row("Counties", c) + (L2 ? `<tr class="grp"><td colspan="8">Large fires: 1,000+ acres, CAL FIRE perimeters</td></tr>` + lrow("Hexagons", L2.backtest.hex) + lrow("Counties", L2.backtest.county) : "");
    $("fcKey").textContent = "Brier score: the average squared gap between the chance given and what happened; lower is better. AUC: how often a place that burned was given a higher chance than one that did not; 0.5 is a coin toss, 1 is perfect. Past odds: the share of earlier years with fire in that place and month, which is what the map shows under Past odds. 2 years ahead is the 2027 case: trained on years up to two before the test year." + (L2 ? " Large fires have no per-year Brier table, so that column is blank." : "");
    const anyRel = relChart(`Any fire, hexagons`, norm(h.model.reliability || []), norm(h.history_alone.reliability || []));
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
    const py = h.per_year, g = (r) => 1 - r.brier_model / r.brier_history;
    if (py.length > 1)
      lim.push(
        `<b>The gain is shrinking</b> as history piles up: for hexagons it was ${pctGain(g(py[0]))} in ${py[0].year} and ${pctGain(g(py[py.length - 1]))} in ${py[py.length - 1].year}, so expect the low end for 2026.`
      );
    const low = (h.model.reliability || []).filter((r) => r.bin[1] <= 0.01 && r.n >= 50 && r.mean_p && r.observed != null);
    if (low.length) {
      const ratios = low.map((r) => r.observed / r.mean_p), obs = low.map((r) => r.observed);
      lim.push(
        `<b>Small chances run low.</b> Where the forecast said under 1%, fire came ${Math.min(...ratios).toFixed(1)}\u2013${Math.max(...ratios).toFixed(1)} times as often as it said, though still only ${pctP(Math.min(...obs))}\u2013${pctP(Math.max(...obs))} of the time.`
      );
    }
    const z = (h.history_alone.reliability || []).find((r) => r.bin[0] === 0 && r.n > 0);
    if (z && z.observed)
      lim.push(
        `Past odds said 0% for ${fmt(z.n)} of the ${fmt(h.history_alone.n)} test hexagon-months; fire came in ${pctP(z.observed)} of them. The forecast gives such places a small chance instead of none.`
      );
    const ratio = h.model.mean_p / h.model.base_rate;
    if (ratio < 0.9)
      lim.push(
        `<b>${NAME[st]} runs low overall.</b> In the tests the forecast expected ${pctP(h.model.mean_p)} of hexagon-months to have fire; ${pctP(h.model.base_rate)} did, because fire there has been rising. Treat any ${NAME[st]} total as probably too low.`
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
    $("fcMethod").innerHTML = `<p>${esc3(F2.method)}</p><p class="note small" style="margin-top:6px">Settings for ${NAME[st]}: hexagons ${esc3(h.final_settings_label)}; counties ${esc3(c.final_settings_label)}. Settings for each test year were chosen only on earlier years (${esc3(h.settings_chosen_on)}).</p>` + (L2 ? `<p style="margin-top:8px"><b>Large fires.</b> ${esc3(L2.definition)} ${esc3(L2.method)}</p><ul class="steps">${L2.limits.map((t) => `<li>${esc3(t)}</li>`).join("")}<li>${Math.round(L2.firms_inside.viirs * 100)}% of California's VIIRS hotspots fall inside a large-fire perimeter while it burned, but far fewer in quiet years, so large fires and all fires make different maps.</li></ul><p class="note small" style="margin-top:6px">${esc3(L2.credit)} <a href="${esc3(L2.source_page)}" target="_blank" rel="noopener">CAL FIRE FRAP fire perimeters</a>, retrieved ${esc3(L2.retrieved)}.</p>` : `<p class="note small" style="margin-top:6px">${esc3(NY_WHY)}</p>`);
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
      let s = `<polyline fill="none" stroke="${col}" stroke-width="1.6" stroke-opacity=".7" points="${r.map((b) => `${X(b.p).toFixed(1)},${Y(b.o).toFixed(1)}`).join(" ")}"/>`;
      for (const b of r)
        s += `<circle cx="${X(b.p).toFixed(1)}" cy="${Y(b.o).toFixed(1)}" r="${(2.5 + 5 * Math.sqrt(b.n / nMax)).toFixed(1)}" fill="${col}" stroke="#000" stroke-width="1" data-tip="${esc3(`${who} said ${lab(b.lo)}\u2013${lab(b.hi)}
${fmt(b.n)} hexagon-months, ${pctP(b.p, true)} on average
Fire came in ${pctP(b.o, true)}`)}"/>`;
      return s;
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
    const w = fcHex(st, "any", year, m), cp = fcHex(st, "any", year, m, true), hx = hexState(st), cs = D.states[st].counties, sum = new Float64Array(cs.length), top = new Float32Array(cs.length);
    let all = 0;
    for (let k = 0; k < hx.n; k++) {
      sum[hx.c[k]] += w[k];
      all += w[k];
      if (w[k] > top[hx.c[k]]) top[hx.c[k]] = w[k];
    }
    return cs.map((c, ci) => ({ ci, name: c.name, e: sum[ci], share: all ? sum[ci] / all : 0, p: Math.max(cp ? cp[ci] : 0, top[ci]) })).sort((x, y) => y.e - x.e || y.p - x.p);
  }

  // src/card.ts
  function renderCard(R) {
    const hx = hexState(S.st), sl = S.sel, cty = (ci) => D.states[S.st].counties[ci].name + " County";
    $("place").textContent = placeName();
    $("lead").textContent = leadText(R);
    $("crumb").innerHTML = (sl.type === "state" ? "State" : `<button type="button" data-go="state">${NAME[S.st]}</button>` + (sl.type === "hex" ? ` \u203A <button type="button" data-ci="${hx.c[sl.k]}">${cty(hx.c[sl.k])}</button>` : "")) + ` \xB7 ${S.yFrom}\u2013${S.yTo}`;
    $("crumb").querySelectorAll("button").forEach((b) => b.onclick = () => setCounty(b.dataset.go ? null : +b.dataset.ci));
    const sf = stationsFor(S.st, sl);
    $("c5q").textContent = sf.rad ? `Fire stations within ${sf.rad} km` : "Fire and EMS stations";
    $("c5").textContent = sf.n.toLocaleString("en-US") + (sf.near != null && sf.near < 1e8 ? ` \xB7 nearest ${sf.near < 10 ? sf.near.toFixed(1) : Math.round(sf.near)} km` : "");
    $("hint").textContent = sl.type === "state" ? "Click a county, then a hexagon, to zoom in. Scroll to zoom, drag to move." : sl.type === "county" ? "Click a hexagon in this county to zoom into it." : "Click a small hexagon to go closer. Blue squares are fire and EMS stations.";
    $("c1").textContent = R.total ? R.order.slice(0, 3).map((o) => MON[o.m]).join(", ") : "None";
    $("c2").textContent = R.total ? R.ranked.slice(0, 3).map((y) => y.y).join(", ") : "None";
    const v = verdict(R);
    $("c3q").textContent = `${MON[S.focus[1]]} ${S.focus[0]}`;
    $("c3").innerHTML = v ? `<span class="pill ${v.cls}" style="margin:0">${v.label}</span>` : "Outside these years";
    const cc = olCard() || chanceCard(R);
    $("c4q").textContent = cc.q;
    $("c4").textContent = cc.v;
    $("c4").parentElement.title = cc.title;
    $("openCmp").textContent = "Compare with " + NAME[STS.find((k) => k !== S.st)];
  }
  function renderTimeline(R) {
    const ys = R.years, n = ys.length, W = 600, bw = W / n, mx = Math.max(1, ...ys.map((y) => y.h)), cur2 = S.show.t === "year" && S.layer === "count" ? S.show.y : null;
    let g = "";
    ys.forEach((y, i) => {
      const h = Math.max(2, 32 * Math.sqrt(y.h / mx)), on = y.y === cur2;
      g += `<rect x="${i * bw + 1.5}" y="${38 - h}" width="${bw - 3}" height="${h}" rx="2" fill="${on ? "#ff8a3d" : cur2 == null ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.28)"}"/>`;
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
    const yr = cur2 != null ? ys[cur2 - S.yFrom] : null;
    $("tlLabel").innerHTML = yr ? `<b>${cur2}</b>${fmt(yr.h)} hotspots${cur2 < 2012 ? " (converted from MODIS)" : ""}` : S.layer === "chance" ? "Drag along the years to see where each one burned" : S.show.t === "all" ? "Drag along the years to see where each one burned" : "Map shows: " + showLabel();
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
    const pad2 = 70, s = Math.min((V.W - inset() - 2 * pad2) / (b.x1 - b.x0), (V.H - 216) / (b.y1 - b.y0));
    return { cx: (b.x0 + b.x1) / 2 + inset() / 2 / s, cy: (b.y0 + b.y1) / 2 - 30 / s, s };
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
  var centerOn = (lon, lat, s, ms) => flyTo({ cx: lon * hexState(S.st).K + inset() / 2 / s, cy: lat, s }, ms || 1300);
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
    return sh.t === "all" ? `All hotspots, ${S.yFrom} to ${S.yTo}` : sh.t === "year" ? `Hotspots in ${sh.y}` : sh.t === "cmonth" ? `A typical ${MONL[sh.m]}` : `${MONL[sh.m]} ${sh.y}`;
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
          for (let i = i0 + sh.m; i < i1; i += 12) a += hx.H[b + i];
          a /= S.yTo - S.yFrom + 1;
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
    const v = CH.max * Math.pow(t, 1 / CH.pow), s = v >= 0.02 ? Math.round(v * 100) + "%" : (v * 100).toFixed(1) + "%";
    return s + (top && CH.max < 1 ? "+" : "");
  };
  function legend() {
    if (S.layer === "outlook") {
      olLegend();
      return;
    }
    const ch = S.layer === "chance", f = V.fineOn, sh = S.show, [a, b] = CH && CH.years ? CH.years : riskYears(), big = S.fire === "large", lut2 = LUT(), mx = f ? hexState(S.st).f.max : V.max;
    $("legTitle").textContent = f ? ch ? "How often each 2 km hexagon has burned since 2012" : "Hotspots per 2 km hexagon since 2012" : ch ? isFc() ? `Forecast for ${monthWhen()}: chance of ${big ? "a large fire (1,000+ acres) starting and reaching the hexagon" : "at least one hotspot"}` : big ? `Large fires in ${MONL[S.rm]}: share of years ${a} to ${b} when one (1,000+ acres) started and reached the hexagon` : `Chance of fire in ${MONL[S.rm]}: share of years ${a} to ${b} with a hotspot` : sh.t === "cmonth" ? `Average hotspots per hexagon in ${MONL[sh.m]}` : `Hotspots per hexagon, ${sh.t === "year" ? sh.y : sh.t === "ym" ? MON[sh.m] + " " + sh.y : S.yFrom + " to " + S.yTo}`;
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
    $("legCap").textContent = (S.pal === "fire" ? "Bigger and redder" : "Bigger and brighter") + (ch ? big ? " means large fires more often." : " means fire more often." : " means more fire.") + (ch && isFc() ? " From fire history alone, not weather." : "") + (ch && big ? " Fire perimeters: CAL FIRE." : "") + (V.early ? " 2 km detail starts in 2012." : "");
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
    const z = Math.max(0, Math.min(18, Math.round(zf))), n = Math.pow(2, z), lon0 = ix(0) / hx.K, lon1 = ix(V.W) / hx.K, lat1 = iy(0), lat0 = iy(V.H);
    const tx = (lon) => Math.floor((lon + 180) / 360 * n), ty = (lat) => {
      const r = lat * Math.PI / 180;
      return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    };
    const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, x0 = tx(lon0), x1 = tx(lon1), y0 = ty(lat1), y1 = ty(lat0);
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
    const zr = V.s / V.fit, K = Math.min(hx.towns.length, Math.round(80 * Math.pow(zr, 1.6))), pad2 = Math.max(5, 15 - 2.5 * zr), cap3 = Math.round(12 + 5 * zr), boxes = [];
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    for (let i = 0; i < K && boxes.length < cap3; i++) {
      const t = hx.towns[i], x = sx(t.X), y = sy(t.Y);
      if (x < 4 || y < 12 || x > V.W - 30 || y > V.H - 12) continue;
      const big = t.pop >= 1e5, w = (big ? 7.6 : 6.6) * t.n.length, hit = (b2) => boxes.some((o) => b2[0] < o[2] && b2[2] > o[0] && b2[1] < o[3] && b2[3] > o[1]);
      let b = [x - 6 - pad2, y - 9 - pad2, x + 9 + w + pad2, y + 9 + pad2], left = false;
      if (hit(b)) {
        b = [x - 9 - w - pad2, y - 9 - pad2, x + 6 + pad2, y + 9 + pad2];
        left = true;
        if (hit(b) || b[0] < 4) continue;
      }
      boxes.push(b);
      c.font = (big ? "600 14px" : "500 12.5px") + " 'Instrument Sans',sans-serif";
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(x, y, big ? 3 : 2.3, 0, 7);
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
        const t = ch ? pop(f.ym[j]) / 14 : Math.log1p(f.c[j]) / lm;
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
    const box = V.drag && V.drag.box ? V.drag.box : sel.type === "box" ? sel : null;
    if (box) c.strokeRect(sx(box.w * hx.K), sy(box.n), sx(box.e * hx.K) - sx(box.w * hx.K), sy(box.s) - sy(box.n));
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
    const big = S.fire === "large", past = (c) => c.years ? `${big ? "a large fire started and reached here" : "fire detected here"} in ${Math.round(c.v[k] * (c.years[1] - c.years[0] + 1))} of ${c.years[1] - c.years[0] + 1} ${MONL[S.rm]}s, ${c.years[0]}\u2013${c.years[1]}` : "";
    if (!CH) return "";
    if (!isFc()) return `${past(CH).replace(/^./, (c) => c.toUpperCase())} (${pctP(CH.v[k], true)})`;
    return `Forecast for ${monthWhen()}: ${pctP(CH.v[k])} chance of ${big ? "a large fire reaching here" : "at least one hotspot"}
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
Burned in ${pop(f.ym[j])} of 14 years, last in ${2012 + 31 - Math.clz32(f.ym[j])}
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
      const hx = hexState(S.st), ci = hx.c[k], s = S.sel;
      if (V.fineOn) {
        S.sel = { type: "hex", k };
        render();
        const z = Math.min(zmax(), V.s * 2.2);
        flyTo({ cx: ix(p[0]) + inset() / 2 / z, cy: iy(p[1]), s: z }, 700);
      } else if (s.type === "county" && s.ci === ci || s.type === "hex") {
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
  var SUMMARY_DIR = "summary/v2";
  var summaryPath = (k) => `${SUMMARY_DIR}/${encodeURIComponent(k)}.json`;
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
    if (!isObj(x) || x.v !== 2 || x.country !== k || typeof x.name !== "string") return false;
    if (typeof x.y0 !== "number" || typeof x.y1 !== "number" || x.y1 < x.y0) return false;
    const nm = (x.y1 - x.y0 + 1) * 12, mo = x.monthly, val = x.val, src = x.source, tot = x.totals;
    return isNums(x.viirs_from, 2) && isNums(x.aqua_from, 2) && isNums(x.bins) && typeof x.filter === "string" && isObj(mo) && ["T", "A", "V", "N20"].every((s) => isNums(mo[s], nm)) && ["r_ta", "r_t", "r_ta_lo", "r_ta_hi"].every((s) => isNums(x[s], 12)) && typeof x.r_all === "number" && Array.isArray(x.pi) && x.pi.length === x.bins.length + 1 && x.pi.every((p) => isNums(p, 2)) && typeof x.zero_hi === "number" && typeof x.rate_note === "string" && isObj(val) && ["raw_factor", "annual_med_err", "annual_max_err", "monthly_wape"].every((s) => isNumOrNull(val[s])) && Array.isArray(val.loyo) && val.loyo.every((r) => isObj(r) && ["y", "obs", "pred", "modis"].every((s) => typeof r[s] === "number")) && isNums(x.bbox, 4) && typeof x.cell === "number" && x.cell > 0 && isNums(x.cells) && isNums(x.cell_rows) && x.cell_rows.length % 5 === 0 && isObj(tot) && isObj(src) && typeof src.firms_updated === "string" && typeof src.files === "number";
  }
  var isIndexEntry = (x) => isObj(x) && typeof x.country === "string" && typeof x.name === "string" && typeof x.file === "string";
  var SUMMARIES = /* @__PURE__ */ new Map();
  function loadSummary(k, onProgress) {
    const had = SUMMARIES.get(k);
    if (had) {
      had.tell.listen = onProgress;
      return had.p;
    }
    const tell = { listen: onProgress }, p = fetchText(fileUrl(summaryPath(k)), () => tell.listen).then((text) => {
      const data = JSON.parse(text);
      if (!isSummary(data, k)) throw new Error("The file from Hugging Face is not in the expected format");
      return data;
    });
    p.catch(() => SUMMARIES.delete(k));
    SUMMARIES.set(k, { p, tell });
    return p;
  }
  var index = null;
  function loadIndex() {
    if (!index) {
      index = fetchText(fileUrl(`${SUMMARY_DIR}/index.json`), () => null).then((text) => {
        const data = JSON.parse(text);
        if (!isObj(data) || !Array.isArray(data.countries)) throw new Error("The country index is not in the expected format");
        return data.countries.filter(isIndexEntry);
      });
      index.catch(() => index = null);
    }
    return index;
  }

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
  var near = (lon, lon0) => lon - 360 * Math.round((lon - lon0) / 360);
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
    let sum = 0;
    for (const r of c.r) {
      let s = 0;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2)
        s += (r[j] - r[i]) * Math.PI / 180 * (Math.sin(r[j + 1] * Math.PI / 180) + Math.sin(r[i + 1] * Math.PI / 180));
      sum += Math.abs(s) / 2;
    }
    return sum * R_KM * R_KM;
  }
  function ringBox(r) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      w = Math.min(w, r[i]);
      e = Math.max(e, r[i]);
      s = Math.min(s, r[i + 1]);
      n = Math.max(n, r[i + 1]);
    }
    return [w, s, e, n];
  }
  var quantile = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  function buildFireLayer(index2, width = 2048) {
    const total2 = new Map(index2.map((e) => [e.country, e.total])), raw = [];
    for (const c of WORLD) {
      const tot = total2.get(c.k), area = areaKm2(c);
      if (!tot || !(tot > 0) || !(area > 0)) continue;
      const perYear = tot / FIRE_YEARS;
      raw.push({ c, area, perYear, density: perYear / area * 1e3 });
    }
    const logs = raw.map((x) => Math.log10(x.density)).sort((a, b) => a - b), l0 = logs.length ? quantile(logs, 0.05) : 0, l1 = logs.length ? Math.max(l0 + 0.5, quantile(logs, 0.97)) : 1, stats = /* @__PURE__ */ new Map();
    for (const x of raw) stats.set(x.c.k, { perYear: x.perYear, density: x.density, t: (Math.log10(x.density) - l0) / (l1 - l0) });
    const h = width / 2, cv = document.createElement("canvas");
    cv.width = width;
    cv.height = h;
    const g = cv.getContext("2d"), X = (lon) => (lon + 180) / 360 * width, Y = (lat) => (90 - lat) / 180 * h;
    raw.sort((a, b) => b.area - a.area);
    for (const x of raw) {
      const col = css2(fireColour(stats.get(x.c.k).t));
      g.fillStyle = col;
      g.beginPath();
      for (const r of x.c.r) {
        g.moveTo(X(r[0]), Y(r[1]));
        for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1]));
        g.closePath();
      }
      g.fill();
      const boxes = x.c.r.map(ringBox);
      if (boxes.every(([w, s, e, n]) => X(e) - X(w) < 3 && Y(s) - Y(n) < 3)) {
        g.beginPath();
        for (const [w, s, e, n] of boxes) {
          const cx = X((w + e) / 2), cy = Y((s + n) / 2);
          g.moveTo(cx + 2, cy);
          g.arc(cx, cy, 2, 0, 2 * Math.PI);
        }
        g.fill();
      }
    }
    return { canvas: cv, stats, lo: Math.pow(10, l0), hi: Math.pow(10, l1) };
  }

  // src/wol.ts
  var SRC = "world_outlook.js?v=1";
  var fileP = null;
  function loadWorldOutlook() {
    if (window.WORLD_OUTLOOK) return Promise.resolve(window.WORLD_OUTLOOK);
    if (!fileP) {
      fileP = new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = SRC;
        s.async = true;
        s.onload = () => window.WORLD_OUTLOOK ? ok(window.WORLD_OUTLOOK) : fail(new Error("the outlook file was empty"));
        s.onerror = () => {
          s.remove();
          fail(new Error("the outlook file did not load"));
        };
        document.head.appendChild(s);
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
    const doy = doy3652(today), hm = halfMonth(today), a = 2 * Math.PI * doy / 365, h = [1];
    for (let k = 1; k <= O2.nharm; k++) h.push(Math.cos(k * a), Math.sin(k * a));
    const base2 = O2.base[ri * 24 + hm] / 1e3;
    if (!(base2 > 0 && base2 < 1)) return null;
    const lb = Math.log(base2 / (1 - base2));
    let z = O2.coef[0] + O2.coef[1] * lb, zMax = 0;
    O2.features.forEach((f, j) => {
      const C = O2.clim[f.id];
      let mu = 0, v = 0;
      for (let k = 0; k < K; k++) {
        mu += h[k] * C.mu[ri * K + k];
        v += h[k] * C.var[ri * K + k];
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
      const list2 = Array.isArray(j) ? j : [j];
      if (list2.length !== ris.length) throw new WeatherError2("The weather service sent a forecast for the wrong number of places.");
      return list2.map((o) => o && typeof o === "object" && o.daily || {});
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
      const s = JSON.parse(raw);
      if (!s || typeof s.at !== "number" || Date.now() - s.at > KEEP_MS2 || !Array.isArray(s.rows)) return null;
      const rows = /* @__PURE__ */ new Map();
      for (const [ri, p, base2, norm2, thr, hm, today, zMax] of s.rows)
        rows.set(ri, { p, base: base2, ratio: p / base2, norm: norm2, wxRatio: p / norm2, thr, hm, today, zMax });
      for (const ri of Array.isArray(s.gaps) ? s.gaps : []) rows.set(ri, null);
      if (want.some((ri) => !rows.has(ri))) return null;
      const run = finish2(O2, rows, s.at);
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
  var MIN_SHARE = 0.75;
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
      try {
        const chunks = [];
        const size = Math.min(CHUNK2, O2.api.max_points_per_get);
        for (let i = 0; i < want.length; i += size) chunks.push(want.slice(i, i + size));
        const got = await Promise.allSettled(chunks.map((c) => getDailyTwice(O2, c)));
        const failed = got.find((g) => g.status === "rejected");
        const rows = new Map(keep ? keep.rows : regs.map((r) => [r.ri, null]));
        got.forEach((g, j) => {
          if (g.status === "fulfilled") chunks[j].forEach((ri, i) => rows.set(ri, work2(O2, ri, g.value[i])));
        });
        let answered = 0;
        rows.forEach((r, ri) => answered += r ? shareOf.get(ri) || 0 : 0);
        if (answered / total2 < MIN_SHARE) throw failed ? failed.reason : new WeatherError2("The weather service sent no usable forecast.");
        const run = finish2(O2, rows, keep ? keep.at : Date.now());
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
  var COUNTRY_STEP = 0.03;
  var EDGES = [-0.15, -0.08, -0.03, 0.03, 0.08, 0.15];
  var RAMP = ["#2166ac", "#67a9cf", "#d1e5f0", "#f4f2ec", "#fddbc7", "#ef8a62", "#b2182b"];
  var MINOR = "#e4e0d7";
  var ODD_Z = 3.5;
  var ODD = "#c9c2b4";
  var P_CAP = 0.85;
  var esc4 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  var colour = (d) => RAMP[EDGES.filter((e) => d >= e).length];
  var pct3 = (p) => p > P_CAP ? "over 85%" : p < 0.02 ? "under 2%" : Math.round(p * 100) + "%";
  var pts = (d) => {
    const r = Math.round(d * 100);
    return r === 0 ? "no change" : `${r > 0 ? "+" : "\u2212"}${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"}`;
  };
  var signed = (x, dp = 1) => `${x > 0 ? "+" : x < 0 ? "\u2212" : ""}${Math.abs(x * 100).toFixed(dp)}%`;
  var deg = (v, p, n) => `${Math.abs(v).toFixed(1)}\xB0${v < 0 ? n : p}`;
  function span(a, b) {
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
    const { used, minor } = countryRegions(O2, k), all = [...used.map((r) => ({ ...r, minor: false })), ...minor.map((r) => ({ ...r, minor: true }))], shape = shapeOf(k), b0 = cellBounds(O2.regions.band[all[0].ri], O2.regions.col[all[0].ri]), lon0 = shape ? shape.c[0] : (b0[0] + b0[2]) / 2, boxes = all.map((r) => {
      const b = cellBounds(O2.regions.band[r.ri], O2.regions.col[r.ri]), w = b[2] - b[0], c = near((b[0] + b[2]) / 2, lon0);
      return [c - w / 2, b[1], c + w / 2, b[3]];
    }), latMid = boxes.reduce((a, b) => a + (b[1] + b[3]) / 2, 0) / boxes.length, kx = Math.max(0.2, Math.cos(latMid * Math.PI / 180)), run = wolRun(k);
    return {
      lon0,
      kx,
      cells: all.map((r, i) => ({
        ...r,
        box: boxes[i],
        x: (boxes[i][0] + boxes[i][2]) / 2 * kx,
        y: (boxes[i][1] + boxes[i][3]) / 2,
        r: !r.minor && run?.rows.get(r.ri) || null,
        noSkill: (O2.regions.bss[r.ri] ?? 1) <= 0,
        odd: !r.minor && (run?.rows.get(r.ri)?.zMax ?? 0) > ODD_Z
      }))
    };
  }
  function compass(cells, sub) {
    const wt = (c) => c.share + 1e-6, mean = (cs) => {
      const s2 = cs.reduce((a2, c) => a2 + wt(c), 0);
      return [cs.reduce((a2, c) => a2 + c.x * wt(c), 0) / s2, cs.reduce((a2, c) => a2 + c.y * wt(c), 0) / s2];
    };
    const [x0, y0] = mean(cells), [x1, y1] = mean(sub), s = cells.reduce((a2, c) => a2 + c.share, 0) || 1, spread2 = Math.sqrt(cells.reduce((a2, c) => a2 + c.share * ((c.x - x0) ** 2 + (c.y - y0) ** 2), 0) / s), dx = x1 - x0, dy = y1 - y0;
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
        if (m[0] <= 0) return noSkill(O2, k, name);
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
    $("cOlSub").textContent = n ? `NASA's VIIRS satellite counted only ${n.toLocaleString("en-US")} fire hotspot${n === 1 ? "" : "s"} in ${theName(name)} from 2012 to 2025. That is too few to say what a usual fortnight looks like, so there is no 14-day outlook here.` : `NASA's VIIRS satellite counted no fire hotspots in ${theName(name)} from 2012 to 2025, so there is nothing to forecast here.`;
    state("");
    $("cOlHow").innerHTML = "";
    $("cOlSrc").textContent = `The 14-day outlook covers the ${Object.keys(O2.countries).length} countries and territories with enough fire history.`;
  }
  function noSkill(O2, k, name) {
    const m = O2.metrics.by_country[k];
    $("cOlTitle").textContent = `No 14-day outlook we can stand behind for ${theName(name)}`;
    $("cOlSub").textContent = `In past years this outlook did not beat the usual odds in ${theName(name)} (Brier skill ${signed(m[0])}), even when it was given the weather that actually happened. Treat the next two weeks as usual for the time of year. We do not fetch a forecast for it.`;
    state("");
    how(O2, k, name);
  }
  function draw(O2, k) {
    const run = wolRun(k), name = nameOf(k), tn = theName(name), n = countryRegions(O2, k).used.length;
    if (!run) return;
    if (run.status === "loading") {
      $("cOlMain").hidden = true;
      state(`Fetching the weather forecast for ${poss(tn)} ${n} region${n === 1 ? "" : "s"} from Open-Meteo\u2026`);
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
    const L2 = place(O2, k), live = L2.cells.filter((c) => c.r && !c.odd), odd = L2.cells.filter((c) => c.r && c.odd), allShare = L2.cells.filter((c) => c.r).reduce((a, c) => a + c.share, 0) || 1, oddShare = odd.reduce((a, c) => a + c.share, 0) / allShare, sw = live.reduce((a, c) => a + c.share, 0) || 1, P = live.reduce((a, c) => a + c.share * c.r.p, 0) / sw, N = live.reduce((a, c) => a + c.share * c.r.norm, 0) / sw, D2 = P - N, up = live.filter((c) => c.r.p - c.r.norm >= REGION_STEP), down = live.filter((c) => c.r.p - c.r.norm <= -REGION_STEP), upShare = up.reduce((a, c) => a + c.share, 0) / sw, downShare = down.reduce((a, c) => a + c.share, 0) / sw, many = live.length > 2, where = (sub, share) => {
      if (!many) return "";
      if (share >= 0.6) return " across most of the country";
      const w = compass(live, sub);
      return w === "scattered" ? " in scattered regions" : w === "centre" ? " in the centre of the country" : ` in the ${w}`;
    };
    const lead2 = "Fire risk over the next two weeks is";
    let head;
    if (!live.length) head = `No reliable outlook for ${tn} today: the forecast weather is far outside the usual range for the date`;
    else if (D2 >= COUNTRY_STEP) head = `${lead2} above normal${where(up.length ? up : live, up.length ? upShare : 1)}`;
    else if (D2 <= -COUNTRY_STEP) head = `${lead2} below normal${where(down.length ? down : live, down.length ? downShare : 1)}`;
    else if (upShare >= 0.1 && downShare >= 0.1 && many)
      head = `${lead2} close to normal overall: above normal${where(up, upShare)}, below${where(down, downShare)}`;
    else if (upShare >= 0.1 && many) head = `${lead2} close to normal overall, but above normal${where(up, upShare)}`;
    else if (downShare >= 0.1 && many) head = `${lead2} close to normal overall, but below normal${where(down, downShare)}`;
    else head = `${lead2} close to normal`;
    const hm = halfMonth(run.today);
    $("cOlKick").textContent = `Next 14 days \xB7 ${span(run.today, run.end)}`;
    $("cOlTitle").textContent = head;
    $("cOlSub").textContent = `The chance that each region sees more satellite fire detections over ${span(run.today, run.end)} than in a usual fortnight for ${halfName(hm)}, against its chance with average weather. Weather: Open-Meteo forecast; trained on NASA POWER.` + (odd.length && oddShare >= 0.25 ? ` Read with care: in ${odd.length} of ${odd.length + live.length} regions, holding ${Math.round(oddShare * 100)}% of the fire, the forecast weather is far outside anything seen at this time of year, more likely a disagreement between the two weather sources than real weather. They are shown in grey and left out of the summaries.` : "");
    const m = O2.metrics.by_country[k], verdict2 = D2 >= COUNTRY_STEP ? ["hi", "Above normal"] : D2 <= -COUNTRY_STEP ? ["lo", "Below normal"] : ["", "Near normal"];
    $("cOlFigs").innerHTML = `<div class="cpAns"><h2>The whole country</h2><p class="cpFig"><span class="${verdict2[0]}">${verdict2[1]}</span><small>${pct3(P)} chance of a busier fortnight than usual, against ${pct3(N)} with average weather</small></p><p>Averaged over ${many ? `its ${live.length} regions` : live.length === 2 ? "its two regions" : "its one region"}, each weighted by its share of ${esc4(poss(tn))} fire.` + (odd.length ? ` ${odd.length === 1 ? "One region is" : `${odd.length} regions are`} left out: ${odd.length === 1 ? "its" : "their"} forecast weather is far outside the usual range.` : "") + `</p></div><div class="cpAns"><h2>Regions above normal</h2><p class="cpFig">${up.length} of ${live.length}</p><p>The weather raises the chance by 5 points or more in ${up.length === 1 ? "one region" : `${up.length} regions`}, and lowers it as much in ${down.length === 1 ? "one" : down.length}. A region is about 280 km across.</p></div><div class="cpAns"><h2>Track record</h2><p class="cpFig">${signed(m[0])}<small>against the usual odds</small></p><p>Brier skill in ${esc4(tn)}, tested on 2012\u20132025 with the weather that actually happened. With a real forecast, expect less.</p></div>`;
    legend2(L2);
    drawMap(L2, k, run.missing);
    list(O2, L2, tn);
    $("cOlFigs").hidden = $("cOlList").parentElement.hidden = !live.length;
    $("cOlMain").hidden = false;
    how(O2, k, name, run.at);
  }
  function legend2(L2) {
    const steps = RAMP.map(
      (c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : (EDGES[i - 1] > 0 ? "+" : "") + Math.round(EDGES[i - 1] * 100)}</span></div>`
    ).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span></span></div>`;
    const hatch = L2.cells.some((c) => c.noSkill), minor = L2.cells.some((c) => c.minor), odd = L2.cells.some((c) => c.odd);
    $("cOlLegend").innerHTML = `<div><b>Change from the weather, percentage points</b><div class="cpKey">${steps}</div></div>` + (hatch ? `<span class="cpNone"><i class="cpHatch"></i>no skill here in past tests</span>` : "") + (odd ? `<span class="cpNone"><i style="background:${ODD}"></i>weather far outside its usual range, left out</span>` : "") + (minor ? `<span class="cpNone"><i style="background:${MINOR}"></i>little fire, not forecast</span>` : "");
  }
  function drawMap(L2, k, missing) {
    const S2 = 10, X = (lon) => (lon - L2.lon0) * L2.kx * S2, Y = (lat) => -lat * S2;
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
      const fill = c.minor ? MINOR : c.odd ? ODD : c.r ? colour(c.r.p - c.r.norm) : "#fff";
      const rect = `x="${X(c.box[0]).toFixed(1)}" y="${Y(c.box[3]).toFixed(1)}" width="${(X(c.box[2]) - X(c.box[0])).toFixed(1)}" height="${(Y(c.box[1]) - Y(c.box[3])).toFixed(1)}"`;
      return `<rect ${rect} fill="${fill}" class="olCell" data-i="${i}"/>` + (c.noSkill && c.r ? `<rect ${rect} fill="url(#olHatch)" pointer-events="none"/>` : "");
    }).join("");
    $("cOlMap").innerHTML = `<svg viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}" role="img" aria-label="Map of ${esc4(poss(theName(nameOf(k))))} regions, coloured by how much the forecast weather changes the chance of a busier fortnight than usual"><defs><pattern id="olHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#55524c" stroke-width="1.2" vector-effect="non-scaling-stroke"/></pattern></defs><path d="${land}" fill="#ebe8e1" fill-rule="evenodd"/><g stroke="#fffefa" stroke-width="1" vector-effect="non-scaling-stroke">${cells}</g><path d="${lines2}" fill="none" stroke="#1b1b1b" stroke-opacity=".75" stroke-width="1.1" vector-effect="non-scaling-stroke" pointer-events="none"/></svg>`;
    const pick = $("cOlPick"), idle = (coarseP() ? "Tap" : "Point at") + " a square for its numbers." + (missing ? ` ${missing} region${missing === 1 ? "" : "s"} had gaps in the forecast and show white.` : "");
    pick.textContent = idle;
    const svg = $("cOlMap").querySelector("svg");
    let on = null;
    const show = (e) => {
      const t = e.target;
      if (!(t instanceof SVGRectElement) || !t.classList.contains("olCell")) return;
      if (on) on.classList.remove("on");
      on = t;
      t.classList.add("on");
      pick.innerHTML = cellText(L2, L2.cells[Number(t.dataset.i)]);
    };
    svg.onpointerover = show;
    svg.onclick = show;
    svg.onpointerleave = () => {
      if (coarseP()) return;
      if (on) on.classList.remove("on");
      on = null;
      pick.textContent = idle;
    };
  }
  var coarseP = () => matchMedia("(pointer: coarse)").matches;
  function cellText(L2, c) {
    const b = c.box, pos = `${deg(b[1], "N", "S")}\u2013${deg(b[3], "N", "S")}, ${deg(near(b[0], 0), "E", "W")}\u2013${deg(near(b[2], 0), "E", "W")}`, sh = c.share >= 0.01 ? `${Math.round(c.share * 100)}%` : c.share >= 1e-3 ? `${(c.share * 100).toFixed(1)}%` : "under 0.1%";
    if (c.minor) return `<b>${cap(whereIn(L2.cells, c))}, ${pos}</b>: ${sh} of the country's fire, too little to forecast here.`;
    if (!c.r) return `<b>${cap(whereIn(L2.cells, c))}, ${pos}</b>: no outlook, the forecast had gaps.`;
    const r = c.r;
    return `<b>${cap(whereIn(L2.cells, c))}, ${pos}</b>: ${pct3(r.p)} chance of ${busier(r.thr)} in 14 days, against ${pct3(r.norm)} with average weather (${pts(r.p - r.norm)}). ${sh} of the country's fire.` + (c.noSkill ? " In past tests the outlook did not beat the usual odds in this region." : "") + (c.odd ? ` Left out: the forecast weather here is ${c.r.zMax.toFixed(1)} standard deviations from the usual for the date, which happened in about 1 in 100 past fortnights; more likely the two weather sources disagree.` : "");
  }
  function list(O2, L2, tn) {
    const live = L2.cells.filter((c) => c.r && !c.odd), big = live.filter((c) => c.share >= 0.01), pool = big.length >= 3 ? big : live, by = (c) => c.r.p - c.r.norm, rising = pool.some((c) => by(c) >= 0.03) || !pool.some((c) => by(c) <= -0.03), rows = pool.slice().sort((a, b) => rising ? by(b) - by(a) : by(a) - by(b)).slice(0, 5);
    $("cOlListT").textContent = rising ? "Where the weather raises the odds most" : "Where the weather lowers the odds most";
    $("cOlList").innerHTML = rows.map((c) => {
      const r = c.r, d = by(c);
      return `<li><span class="olW"><b>${cap(whereIn(L2.cells, c))}${c.noSkill ? " \u2020" : ""}</b><small>near ${deg(O2.regions.lat[c.ri], "N", "S")}, ${deg(O2.regions.lon[c.ri], "E", "W")} \xB7 ${Math.round(c.share * 100) || "<1"}% of ${esc4(poss(tn))} fire</small><small>busier than usual: ${busier(r.thr)} in 14 days</small></span><span class="olN">${pct3(r.p)}<small>vs ${pct3(r.norm)}</small></span><span class="olD" style="--c:${colour(d)}">${pts(d)}</span></li>`;
    }).join("");
    $("cOlListNote").textContent = (big.length >= 3 ? "Regions holding at least 1% of the country's fire. " : "") + (rows.some((c) => c.noSkill) ? "\u2020 In past tests the outlook did not beat the usual odds in this region." : "");
  }
  function how(O2, k, name, at = 0) {
    const tn = theName(name), m = O2.metrics.by_country[k], regs = O2.countries[k] || [], zw = /* @__PURE__ */ new Map();
    regs.forEach(([ri, s]) => zw.set(O2.regions.zone[ri], (zw.get(O2.regions.zone[ri]) || 0) + s + 1e-3));
    const zi = [...zw.entries()].sort((a, b) => b[1] - a[1])[0]?.[0], zone = zi == null ? null : O2.zones[zi], zm = zone ? O2.metrics.by_zone[zone] : null, all = O2.metrics.variants, shipped = Object.entries(all).find(([key]) => /^shipped: observed next 14/.test(key))?.[1], blurred = Object.entries(all).find(([key]) => /blurred/.test(key))?.[1];
    const skill2 = !!m && m[0] > 0, test = m && zm && zone ? !skill2 ? `Tested year by year on 2012\u20132025, each year predicted by a model fitted on the others, it did not beat the usual odds in ${esc4(tn)} (Brier skill ${signed(m[0])}; AUC ${m[2].toFixed(2)} \u2192 ${m[1].toFixed(2)}), though it did by ${signed(zm.model.bss)} across ${ZONE_NAME[zone] || zone} as a whole. ` : `Tested year by year on 2012\u20132025, each year predicted by a model fitted on the others, it beat the usual odds by ${signed(m[0])} in ${esc4(tn)} and by ${signed(zm.model.bss)} across ${ZONE_NAME[zone] || zone} (Brier skill; AUC ${m[2].toFixed(2)} \u2192 ${m[1].toFixed(2)} in ${esc4(tn)}). ` : "";
    $("cOlHow").innerHTML = `<b>How this works.</b> For each region about 280 km across, a statistical model starts from how often this half of the month has been busier than usual (VIIRS hotspots, 2012\u20132025) and moves that chance with the forecast heat, air dryness and rain of the next 14 days and the rain of the past 30. ` + test + (!skill2 ? `<b>Those tests used the weather that actually happened (NASA POWER), not a forecast,</b> so a real forecast would not do better here.` : `<b>Those tests used the weather that actually happened (NASA POWER), not a forecast,</b> so they are a best case: with Open-Meteo's forecast, a different source, expect a few percent better than the usual odds (the gap between the two sources alone cut the worldwide score from ${shipped ? signed(shipped.bss) : "+8.9%"} to ${blurred ? signed(blurred.bss) : "+5.2%"} in a simulation).`);
    $("cOlSrc").textContent = (at ? `Forecast fetched ${new Date(at).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. ` : "") + `Weather: Open-Meteo forecast; trained on NASA POWER (MERRA-2). Fire history: NASA FIRMS, VIIRS on Suomi NPP. Each region's weather is read at one point, the centre of its busiest patch, and regions cross borders. Hotspots are detections, not fires, and many are farm or managed burns.`;
  }

  // src/libs.ts
  var MAPLIBRE = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js";
  var MAPLIBRE_CSS = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css";
  var D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
  var PLOT = "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/dist/plot.umd.min.js";
  var FONTS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400&display=swap";
  function script(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => ok();
      s.onerror = () => {
        s.remove();
        fail(new Error(`${new URL(src).hostname} did not answer`));
      };
      document.head.appendChild(s);
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
    let lon0 = shape ? shape.c[0] : (d.bbox[0] + d.bbox[2]) / 2;
    if (!shape && nc) {
      const ls = Array.from(lo, (v) => v * cell).sort((a, b) => a - b);
      lon0 = ls[Math.floor(ls.length / 2)];
    }
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
      const s = la[c] * cell, w = near(lo[c] * cell + cell / 2, lon0) - cell / 2, e = w + cell, n = s + cell;
      grow(w, s);
      grow(e, n);
      cells.push({
        type: "Feature",
        properties: { n: tot[c], mo: modis[c], vi: viirs[c], s, w: lo[c] * cell },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s]
            ]
          ]
        }
      });
    }
    const lines2 = [];
    if (shape)
      for (const r of shape.r) {
        const off = near(r[0], lon0) - r[0];
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
      grow(near(d.bbox[0], lon0), d.bbox[1]);
      grow(near(d.bbox[2], lon0), d.bbox[3]);
    }
    const all = pad([x0, y0, x1, y1]);
    let bounds = all;
    if (cells.length) {
      const wt = cells.map((f) => Math.max(f.properties.n, 0.01)), sum = wt.reduce((a, b) => a + b, 0), at = (key, q) => {
        const idx = cells.map((_, i) => i).sort((a, b) => key(a) - key(b));
        let acc = 0;
        for (const i of idx) {
          acc += wt[i];
          if (acc >= q * sum) return key(i);
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
    let map;
    try {
      map = new ml.Map({
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
    live.map = map;
    host._map = map;
    live.popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", className: "cpPop", offset: 8 });
    map.touchZoomRotate.disableRotation();
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ml.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
    let swapped = style2 === FALLBACK;
    const swap = () => {
      if (swapped || live.ready || L !== live) return;
      swapped = true;
      onBasemap();
      map.setStyle(FALLBACK);
    };
    map.on("error", (e) => {
      if (e.sourceId && e.sourceId !== "cells" && e.sourceId !== "outline" && !e.tile) onBasemap();
      setTimeout(swap, 4e3);
    });
    map.on("style.load", () => {
      if (L !== live || live.ready) return;
      addLayers(map, d, live);
    });
  }
  function addLayers(map, d, live) {
    const data = live.next;
    const under = map.getLayer("boundary_3") ? "boundary_3" : void 0, labels = map.getLayer("water_name_point_label") ? "water_name_point_label" : void 0;
    map.addSource("cells", { type: "geojson", data: data.cells, tolerance: 0, buffer: 2, generateId: true });
    map.addSource("outline", { type: "geojson", data: data.outline });
    map.addLayer(
      {
        id: "cells",
        type: "fill",
        source: "cells",
        paint: { "fill-color": fillExpr(data.breaks), "fill-opacity": 0.9, "fill-antialias": false }
      },
      under
    );
    if (data.n < 400)
      map.addLayer(
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
    map.addLayer(
      {
        id: "cells-hover",
        type: "line",
        source: "cells",
        paint: { "line-color": INK, "line-width": 1.5, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0] }
      },
      labels
    );
    map.addLayer(
      { id: "outline", type: "line", source: "outline", paint: { "line-color": INK, "line-width": 1.1, "line-opacity": 0.75 } },
      labels
    );
    live.ready = true;
    live.next = null;
    const host = map.getContainer();
    const fold2 = () => host.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    fold2();
    map.once("idle", fold2);
    const clear = () => {
      if (live.hover != null) map.setFeatureState({ source: "cells", id: live.hover }, { hover: false });
      live.hover = null;
    };
    const show = (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      if (live.hover !== f.id) {
        clear();
        live.hover = f.id;
        map.setFeatureState({ source: "cells", id: f.id }, { hover: true });
      }
      map.getCanvas().style.cursor = "default";
      live.popup.setLngLat(e.lngLat).setHTML(popupHtml(f.properties, d.cell, live.yFrom, live.yTo)).addTo(map);
    };
    map.on("mousemove", "cells", show);
    map.on("click", "cells", show);
    map.on("mouseleave", "cells", () => {
      clear();
      live.popup.remove();
      map.getCanvas().style.cursor = "";
    });
    map.on("click", (e) => {
      if (!map.queryRenderedFeatures(e.point, { layers: ["cells"] }).length) {
        clear();
        live.popup.remove();
      }
    });
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
    const Plot = Pl(), W = top.clientWidth || 640, ph = phone(W), rowH = ph ? 17 : 20, mL = ph ? 38 : 44, mR = ph ? 44 : 64, color = calendarScale(R, o.mode), totals = new Map(R.years.map((y) => [y.y, y.h]));
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
        f ? Plot.cell([f], { x: "m", y: "y", fill: "none", stroke: INK2, strokeWidth: 2, inset: 0 }) : null,
        Plot.text(years, {
          y: (d) => d,
          text: (d) => total(totals.get(d) ?? 0),
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
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 16, mB = 30, st = R.stats.map((s, m) => {
      const v = R.ser.filter((r) => r.m === m).map((r) => r.h);
      return { m, ...s, min: Math.min(...v), max: Math.max(...v) };
    }), yr = R.ser.filter((r) => r.y === year), ymax = yTop(Math.max(1e-9, ...st.map((s) => s.max))), labs = spread(
      [{ v: st[11].med, text: "Typical", fill: TYPICAL }, ...yr.length ? [{ v: yr[11].h, text: String(year), fill: RED }] : []],
      ymax,
      H,
      mT,
      mB
    ), px = (v) => v / ymax * (H - mT - mB), at = (f, k) => {
      const a = Math.floor(k), b = Math.min(11, a + 1);
      return f(a) + (f(b) - f(a)) * (k - a);
    }, lines2 = (k) => [at((m) => st[m].med, k), ...yr.length ? [at((m) => yr[m].h, k)] : []], monthPx = (W - 44 - 64) / 11, place2 = (lo, hi, t) => {
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
      ...place2(
        (m) => st[m].q1,
        (m) => st[m].q3,
        "Middle half of years"
      ),
      ...place2(
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
          Plot.ruleX(st, Plot.pointerX({ x: "m", stroke: "#b9b3a6" })),
          Plot.tip(
            st,
            Plot.pointerX({
              x: "m",
              y: "med",
              ...TIP,
              title: (s) => `${MONL[s.m]}
Typical (median): ${fmt(s.med)} hotspots
Middle half of years: ${fmt(s.q1)} to ${fmt(s.q3)}
Range: ${fmt(s.min)} to ${fmt(s.max)}` + (yr.length ? `
${year}: ${fmt(yr[s.m].h)}` : "") + `
Click to test ${MONL[s.m]} ${year} at the top`
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
          Plot.barY(ys, { x: "y", y: "h", fill }),
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
  function cumulative(el, R, year) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 16, mB = 30, rows = [];
    for (const yr of R.years) {
      let c = 0;
      for (const r of R.ser.filter((r2) => r2.y === yr.y)) rows.push({ y: yr.y, m: r.m, c: c += r.h });
    }
    const worst = R.ranked[0]?.y, has = rows.some((r) => r.y === year), ymax = yTop(Math.max(1e-9, ...rows.map((r) => r.c))), endOf = (y) => rows.find((r) => r.y === y && r.m === 11)?.c ?? 0, labs = spread(
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
            { x: "m", y: "c", z: "y", stroke: CONTEXT, strokeWidth: 1 }
          ),
          worst !== void 0 && worst !== year ? Plot.lineY(
            rows.filter((r) => r.y === worst),
            { x: "m", y: "c", stroke: INK2, strokeWidth: 1.5 }
          ) : null,
          Plot.lineY(
            rows.filter((r) => r.y === year),
            { x: "m", y: "c", stroke: RED, strokeWidth: 2.5 }
          ),
          ...endLabels(Plot, labs, 11),
          Plot.tip(
            rows,
            Plot.pointer({
              x: "m",
              y: "c",
              ...TIP,
              title: (r) => `${r.y}, January to ${MONL[r.m]}
${fmt(r.c)} hotspots so far`
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", "Running total of hotspots through each year");
    mount(el, fig);
  }
  function seam(el, R, viirsYear2) {
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 280, mT = 22, mB = 30, ys = R.years, last = ys[ys.length - 1], band = ys.filter((y) => y.y <= viirsYear2), ymax = yTop(Math.max(1e-9, ...ys.map((y) => Math.max(y.h, y.naive)), ...band.map((y) => y.hi))), labs = spread(
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
          xs[0] < viirsYear2 && xs[xs.length - 1] >= viirsYear2 ? [
            Plot.ruleX([viirsYear2], { stroke: INK2, strokeOpacity: 0.45 }),
            Plot.text([viirsYear2], {
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
Harmonized: ${fmt(y.h)}` + (y.y <= viirsYear2 ? `, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "") + `
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
    const Plot = Pl(), W = el.clientWidth || 600, ph = phone(W), H = ph ? 240 : 270, mT = 16, mB = 30, rows = per.flatMap((s) => xs.map((x, i) => ({ s: s.name, x, v: s.v[i] }))), ymax = yTop(Math.max(1e-9, ...rows.map((r) => r.v).filter(Number.isFinite))), n = xs.length - 1, labs = spread(
      per.filter((s) => Number.isFinite(s.v[n])).map((s) => ({ v: s.v[n], text: s.name, fill: s.c })),
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
            (s) => Plot.lineY(
              xs.map((x, i) => ({ x, v: s.v[i] })),
              { x: "x", y: "v", stroke: s.c, strokeWidth: 1.8, strokeDasharray: s.dash }
            )
          ),
          ...xs.length === 1 ? per.map((s) => Plot.dot([{ x: xs[0], v: s.v[0] }], { x: "x", y: "v", fill: s.c })) : [],
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
` + per.map((s) => `${s.name}: ${Number.isFinite(s.v[i]) ? fmt(s.v[i]) : "not flying"}`).join("\n");
              }
            })
          )
        ]
      })
    );
    fig.setAttribute("aria-label", "Raw detections per year from each satellite");
    mount(el, fig);
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
  var esc5 = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var pc = (x) => x == null ? "n/a" : Math.round(x * 100) + "%";
  var nHot = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  var epochs = (d) => ({
    vi0: (d.viirs_from[0] - d.y0) * 12 + d.viirs_from[1] - 1,
    aq0: (d.aqua_from[0] - d.y0) * 12 + d.aqua_from[1] - 1,
    bins: d.bins
  });
  var viirsYear = (d) => d.viirs_from[0];
  var ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  var the = theName;
  var cap2 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  var yrs = () => CV.yFrom === CV.yTo ? String(CV.yFrom) : `${CV.yFrom}\u2013${CV.yTo}`;
  var longDate = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return y && m && d ? `${d} ${MONL[m - 1]} ${y}` : iso.slice(0, 10);
  };
  var VOLCANIC = /* @__PURE__ */ new Set(["Iceland"]);
  var coarse = () => matchMedia("(pointer: coarse)").matches;
  function stepped(title, cols, breaks, max) {
    if (!breaks.length)
      return `<b>${title}</b><div class="cpKey"><div class="cpStep"><i style="background:${cols[0]}"></i><span>${short(max)}</span></div></div>`;
    return `<b>${title}</b><div class="cpKey">` + cols.map((c, i) => `<div class="cpStep"><i style="background:${c}"></i><span>${i === 0 ? "" : short(breaks[i - 1])}</span></div>`).join("") + `<div class="cpStep" style="flex:0 0 1px"><i style="background:none"></i><span>${short(max)}</span></div></div>`;
  }
  function monthRun(ms) {
    const s = ms.slice().sort((a, b) => a - b);
    if (s.length > 1 && s.every((m, i) => i === 0 || m === s[i - 1] + 1)) return `${MON[s[0]]}\u2013${MON[s[s.length - 1]]}`;
    if (s.length === 3 && s[0] === 0 && s[2] === 11 && (s[1] === 1 || s[1] === 10)) return s[1] === 1 ? `Dec\u2013${MON[1]}` : `${MON[10]}\u2013Jan`;
    return s.map((m) => MON[m]).join(", ");
  }
  function openCountry(k) {
    if (CV.k === k && CV.d) return;
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
    load();
    olOpen(k);
  }
  function closeCountry() {
    if (CV.k === null) return;
    CV.k = null;
    CV.mapKey = "";
    olClose();
    destroyMap();
    const el = $("country");
    el.classList.remove("in");
    el.hidden = true;
  }
  function countryMissing(slug) {
    CV.k = "";
    CV.d = CV.R = null;
    olClose();
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
    $("cMsg").textContent = `Nothing lives at "#c/${slug}". Go back to the globe and pick a country there, or search for one by name.`;
  }
  function load() {
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
    $("cFrom").innerHTML = $("cTo").innerHTML = $("cfY").innerHTML = yo.join("");
    CV.yFrom = d.y0;
    CV.yTo = d.y1;
    $("cFrom").value = String(d.y0);
    $("cTo").value = String(d.y1);
    const last = (d.y1 - d.y0) * 12, ep = epochs(d), hs = MON.map((_, m) => harmWith(d, ep, last + m, d.monthly.T[last + m], d.monthly.A[last + m], d.monthly.V[last + m]).h);
    CV.focus = [d.y1, hs.indexOf(Math.max(...hs))];
    if (Math.max(...hs) === 0) {
      for (let i = last + 11; i >= 0; i--)
        if (harmWith(d, ep, i, d.monthly.T[i], d.monthly.A[i], d.monthly.V[i]).h > 0) {
          CV.focus = [d.y0 + Math.floor(i / 12), i % 12];
          break;
        }
    }
    $("cStatus").hidden = true;
    $("cBody").hidden = $("cCtl").hidden = false;
    $("cName").textContent = d.name;
    renderCountry();
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
      harm: (i, t, a, v) => harmWith(d, ep, i, t, a, v)
    });
    CV.R = R;
    $("cCrumb").textContent = `Fire, month by month \xB7 ${yrs()}`;
    $("cLead").textContent = lead(d, R);
    $("cDate").textContent = `Fire detections from NASA satellites, ${d.y0}\u2013${d.y1}. Years before ${viirsYear(d)} come from an older satellite and are adjusted to match. Data as of ${longDate(d.source.firms_updated)}.`;
    answers(R);
    const key = `${d.country}|${CV.yFrom}|${CV.yTo}`;
    if (key !== CV.mapKey) {
      CV.mapKey = key;
      drawMap2(d);
    }
    method(d);
    calendarText(d, R);
    chartText(d, R);
    drawCharts();
  }
  function lead(d, R) {
    const name = the(d.name);
    if (R.total === 0) return `No vegetation fire hotspots were counted in ${name} in ${yrs()}.`;
    const peak = R.order[0].m, w = R.ranked[0], span2 = CV.yTo - CV.yFrom + 1;
    let t = `${cap2(name)} burns most in ${MONL[peak]}.`;
    if (span2 > 2 && R.mean > 0)
      t += ` ${w.y} was its worst year ${span2 === d.y1 - d.y0 + 1 ? "on record" : `between ${CV.yFrom} and ${CV.yTo}`}, with ${times(w.h / R.mean)} the hotspots of an average year.`;
    if (VOLCANIC.has(d.country)) t += ` Most of these detections are lava from eruptions, which the satellites cannot tell apart from fire.`;
    if (CV.yFrom < viirsYear(d) && d.val.monthly_wape != null && d.val.monthly_wape > 1)
      t += ` Treat the years before ${viirsYear(d)} as rough: tested on years VIIRS saw, converted months were off by ${pc(d.val.monthly_wape)} on average.`;
    return t;
  }
  function answers(R) {
    if (R.total === 0) {
      $("ca1").textContent = $("ca2").textContent = "None";
      $("ca1n").textContent = $("ca2n").textContent = "No hotspots in these years.";
    } else {
      const top = R.order.slice(0, 3).filter((o) => o.sum > 0), worst = R.ranked.slice(0, 3).filter((y) => y.h > 0), quiet = R.order.filter((o) => o.sum === 0), share = Math.round(top.reduce((a, o) => a + o.sum, 0) / R.total * 100);
      $("ca1").textContent = monthRun(top.map((o) => o.m));
      $("ca1n").textContent = (top.length === 1 ? `Every hotspot fell in ${MONL[top[0].m]}.` : `${top.length === 2 ? "These two months" : "These three months"} hold ${share}% of all hotspots.`) + (quiet.length > 1 ? ` ${quiet.length} months had none in these years.` : ` ${MONL[R.order[11].m]} is the quietest${quiet.length ? ", with none" : ""}.`);
      const vy = viirsYear(CV.d), est = worst.some((y) => y.y < vy);
      $("ca2").textContent = worst.map((y) => y.y).join(", ");
      $("ca2n").innerHTML = worst.map((y) => `<span class="cpRow">${y.y} \xB7 ${fmt(y.h)}${y.y < vy ? "*" : ""}</span>`).join("") + `<span class="cpRow">An average year: ${fmt(R.mean)}</span>` + (est ? `<span class="cpRow cpFn">* estimated from the older satellite</span>` : "");
    }
    const v = verdict(R, CV.focus), vi0 = epochs(CV.d).vi0;
    $("cfM").value = String(CV.focus[1]);
    $("cfY").value = String(CV.focus[0]);
    if (!v) {
      $("ca3").textContent = "Outside the chosen years";
      $("ca3n").textContent = "Pick a month inside the years chosen at the top.";
    } else if (R.ser.every((r) => r.m !== v.fm || r.h === 0)) {
      $("ca3").textContent = "No hotspots";
      $("ca3n").textContent = `No hotspots in ${MONL[v.fm]} in any of these years, so there is nothing to compare.`;
    } else {
      $("ca3").innerHTML = `<span class="${v.cls}">${esc5(v.label)}</span><small>${esc5(v.mult)}</small>`;
      $("ca3n").textContent = `${cap2(nHot(v.f.h))} against a normal ${fmt(v.med)}; ${v.rank === 1 ? "the busiest" : v.rank === v.n ? "the quietest" : `the ${ordinal(v.rank)} busiest`} of ${v.n} ${MONL[v.fm]}s.` + (v.f.i < vi0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : " Seen directly by VIIRS.");
    }
  }
  function calendarText(d, R) {
    const peaks = new Array(12).fill(0);
    let n = 0;
    for (const y of R.years) {
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
    const vy = viirsYear(d);
    $("cCalTopH").textContent = CV.yTo >= vy ? `Seen by VIIRS, ${Math.max(vy, CV.yFrom)}\u2013${CV.yTo}` : "";
    $("cCalBotH").textContent = CV.yFrom < vy ? `Converted from MODIS, ${CV.yFrom}\u2013${Math.min(vy - 1, CV.yTo)}` : "";
    $("cCalNote").textContent = CV.mode === "count" ? `The outlined month is the one tested at the top; click any month to test it instead.` : `Each month against the median of the same month in ${yrs()}. Click any month to test it.`;
    const cc = calendarClasses(R);
    $("cCalLegend").innerHTML = CV.mode === "count" ? cc.max > 0 ? `<div>${stepped("Hotspots in a month", cc.colours, cc.breaks, cc.max)}</div><span class="cpNone"><i></i>none</span>` : "" : `<div class="cpRamp"><span>\xBC of normal</span><i style="background:linear-gradient(90deg,#2166ac,#67a9cf,#d1e5f0,#f7f7f7,#fddbc7,#ef8a62,#b2182b)"></i><span>4\xD7 normal</span></div><span>white: a normal month</span>`;
  }
  function chartText(d, R) {
    const st = R.stats, meds = st.map((s) => s.med), pk = meds.indexOf(Math.max(...meds)), lo = meds.indexOf(Math.min(...meds)), fy = CV.focus[0], span2 = yrs(), top = R.order.slice(0, 3).filter((o) => o.sum > 0), topShare = R.total > 0 ? top.reduce((a, o) => a + o.sum, 0) / R.total : 0;
    $("cMonthsT").textContent = R.total === 0 ? "No month stands out" : meds[lo] >= 10 && meds[pk] / meds[lo] >= 1.5 ? `A typical ${MONL[pk]} has ${times(meds[pk] / meds[lo])} the hotspots of a typical ${MONL[lo]}` : topShare >= 0.5 && top.length > 1 ? `${topShare >= 0.8 ? "Almost all" : "Most"} of the fire in ${the(d.name)} comes in ${monthRun(top.map((o) => o.m))}; a typical ${MONL[lo]} has ${meds[lo] === 0 ? "none" : nHot(meds[lo])}` : meds[pk] > 0 ? `A typical ${MONL[pk]} brings ${nHot(meds[pk])}; ${meds[lo] === 0 ? `a typical ${MONL[lo]}, none` : "the other months are close behind"}` : `Most months pass with no hotspots at all`;
    $("cMonthsS").textContent = `Hotspots per month, ${span2}, with ${fy} in red. Click a month to test it.`;
    const w = R.ranked[0];
    $("cYearsT").textContent = R.total === 0 ? "No year stands out" : R.years.length > 1 && R.mean > 0 ? `${w.y} was the worst year, at ${times(w.h / R.mean)} the average` : `${fmt(w.h)} hotspots in ${w.y}`;
    $("cYearsS").textContent = `Hotspots per year, with ${fy} in red. Paler bars are estimated from the older satellite, with a line for the likely range.`;
    const fyRow = R.years.find((y) => y.y === fy), rank = fyRow ? R.ranked.indexOf(fyRow) + 1 : 0;
    $("cCumT").textContent = !fyRow || R.total === 0 ? "How each year adds up" : rank === 1 ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the most of any year` : rank === R.years.length ? `${fy} ended with ${fmt(fyRow.h)} hotspots, the fewest of ${R.years.length} years` : `${fy} ended with ${fmt(fyRow.h)} hotspots, the ${ordinal(rank)} most of ${R.years.length} years`;
    $("cCumS").textContent = `Running total of hotspots from January, one line per year.`;
    const ys = R.years, avg = (a, b, k) => {
      const r = ys.filter((y) => y.y >= a && y.y <= b);
      return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
    };
    const n0 = avg(2007, 2011, "naive"), n1 = avg(2012, 2016, "naive"), h0 = avg(2007, 2011, "h"), h1 = avg(2012, 2016, "h");
    const can = n0 != null && h0 != null && n1 != null && h1 != null && n0 > 0 && h0 > 0;
    $("cSeamT").textContent = can ? `Joined raw, 2012 looks like a ${(n1 / n0).toFixed(1)}\xD7 jump. Harmonized, it is ${(h1 / h0).toFixed(1)}\xD7` : "Raw counts against the harmonized record";
    $("cSeamNote").textContent = can ? `Average hotspots a year, 2012\u20132016 against 2007\u20132011. The jump in the raw line is the change of satellite, not more fire.` : n0 === 0 || h0 === 0 ? "MODIS counted no hotspots here in 2007\u20132011, so the step at 2012 cannot be measured." : "The dashed line jumps in 2012 only because the sensor changed. Choose years from 2007 to 2016 or wider to measure the step.";
    const none = R.total === 0;
    $("cCharts").hidden = $("cRawFig").hidden = none;
    $("cNoFire").hidden = !none;
    $("cNoFire").textContent = none ? `No fire was detected in ${the(d.name)} in ${span2}, so there is nothing to chart.` : "";
  }
  function chartsFailed() {
    const msg = `<p class="cpMapMsg" style="position:static">The charts did not load (cdnjs or jsdelivr did not answer). The numbers above are unaffected; reload to try again.</p>`;
    ["cCal", "cMonths", "cYears", "cCum", "cSeam", "cRaw"].forEach((id) => $(id).innerHTML = msg);
    $("cCal2").innerHTML = "";
  }
  function drawCharts() {
    const d = CV.d, R = CV.R;
    if (!d || !R) return;
    if (!window.Plot || !window.d3) {
      const k = CV.k;
      ["cCal", "cMonths", "cYears", "cCum", "cSeam", "cRaw"].forEach((id) => {
        if (!$(id).firstChild) $(id).innerHTML = `<p class="cpCap">Drawing\u2026</p>`;
      });
      loadPlotLib().then(
        () => CV.k === k && drawCharts(),
        () => CV.k === k && chartsFailed()
      );
      return;
    }
    const N20 = d.monthly.N20, vy = viirsYear(d), pick = (y, m) => {
      CV.focus = [y, m];
      renderCountry();
    };
    calendar($("cCal"), $("cCal2"), R, {
      mode: CV.mode,
      focus: CV.focus,
      viirsYear: vy,
      tip: (r) => `${MONL[r.m]} ${r.y}: ${nHot(r.h)}
Normal for ${MONL[r.m]}: ${fmt(r.med)}` + (r.med > 0 || r.h > 0 ? ` (${times(r.ratio)} normal)` : "") + `
${r.src}` + (r.i < epochs(d).vi0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "") + `
Raw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(r.V)}, NOAA-20 ${fmt(N20[r.i])} (not used)
Click to test this month`,
      click: (r) => pick(r.y, r.m)
    });
    seasonal($("cMonths"), R, CV.focus[0], (m) => pick(CV.focus[0], m));
    annual($("cYears"), R, {
      viirsYear: vy,
      focusYear: CV.focus[0],
      tip: (y) => `${y.y}: ${nHot(y.h)}` + (R.mean > 0 ? `
${y.h >= R.mean ? "+" : ""}${Math.round((y.h / R.mean - 1) * 100)}% against the average year` : "") + (y.y < vy ? `
Estimated from MODIS, likely ${fmt(y.lo)} to ${fmt(y.hi)}` : "\nSeen by VIIRS") + `
Click to test ${MONL[CV.focus[1]]} ${y.y}`,
      click: (y) => pick(y, CV.focus[1])
    });
    cumulative($("cCum"), R, CV.focus[0]);
    seam($("cSeam"), R, vy);
    const from = { ...SENSOR_FROM, A: d.aqua_from[0] }, xs = R.years.map((y) => y.y);
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
  function mapMsg(text) {
    $("cMap").innerHTML = `<p class="cpMapMsg">${esc5(text)}</p>`;
  }
  function drawMap2(d) {
    const data = mapData(d, CV.yFrom, CV.yTo), k = d.country;
    $("cMapLegend").innerHTML = data.n ? `<div>${stepped("Hotspots per square", classColours(data.breaks), data.breaks, data.max)}</div>` : "";
    const vals = data.cells.features.map((f) => f.properties.n).sort((a, b) => b - a), tot = vals.reduce((a, b) => a + b, 0);
    let acc = 0, k50 = 0;
    for (const v of vals) {
      acc += v;
      k50++;
      if (acc >= tot / 2) break;
    }
    const share = vals.length ? k50 / vals.length * 100 : 0;
    $("cMapTitle").textContent = tot > 0 && vals.length >= 10 ? `Half of all hotspots fell in ${share < 1 ? "under 1" : Math.round(share)}% of the squares that burned` : "Where it burns";
    $("cMapSub").textContent = `Hotspots counted in each ${d.cell}\xB0 square (about ${Math.round(d.cell * 111)} km across), ${yrs()}.`;
    const name = the(d.name);
    $("cMapNote").innerHTML = data.n ? (coarse() ? "Tap a square for its numbers. Use two fingers to move and zoom." : "Hover over a square for its numbers. Use the buttons, or Ctrl/\u2318 and scroll, to zoom.") + (data.cropped ? ` <button class="cpText cpSmall" id="cMapAll" type="button">Show all of ${esc5(name)}</button>` : "") + `<span id="cMapBase"></span>` : `No hotspots were counted anywhere in ${esc5(name)} in these years, so the map has no squares.<span id="cMapBase"></span>`;
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
    const item = (v, t) => `<div><dt>${v}</dt><dd>${t}</dd></div>`;
    $("cTiles").innerHTML = item(
      val.raw_factor == null ? "n/a" : val.raw_factor.toFixed(1) + "\xD7",
      `more hotspots from VIIRS than MODIS for the same fires in ${esc5(the(d.name))}, 2012\u20132025`
    ) + item(pc(val.annual_med_err), "typical error of a converted year, tested on years we could check") + item(pc(val.annual_max_err), "error in the worst tested year") + item(pc(val.monthly_wape), "typical error of a converted month, weighted by size");
    $("cRateNote").textContent = d.rate_note;
    $("cFilter").textContent = d.filter;
    $("cCell").textContent = `${d.cell}\xB0`;
    const row = (label, a) => `<tr><td>${label}</td>${a.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
    $("cRates").innerHTML = `<tr><th>VIIRS per MODIS hotspot</th>${MON.map((m) => `<th>${m}</th>`).join("")}</tr>` + row("Terra+Aqua", d.r_ta) + row("90% low", d.r_ta_lo) + row("90% high", d.r_ta_hi) + row("Terra only", d.r_t);
    $("cLoyo").innerHTML = `<tr><th>Held-out year</th><th>Seen by VIIRS</th><th>Predicted from MODIS</th><th>Raw MODIS</th><th>Error</th></tr>` + val.loyo.map(
      (r) => `<tr><td>${Number(r.y)}</td><td>${fmt(r.obs)}</td><td>${fmt(r.pred)}</td><td>${fmt(r.modis)}</td><td>${r.obs > 0 ? (r.pred >= r.obs ? "+" : "") + Math.round((r.pred / r.obs - 1) * 100) + "%" : "n/a"}</td></tr>`
    ).join("");
    const path = summaryPath(d.country), url = fileUrl(path);
    $("cSrc").innerHTML = `Data: <a href="${esc5(url)}" target="_blank" rel="noopener">${esc5(path)}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built from ${d.source.files} FIRMS files (latest FIRMS update ${esc5(d.source.firms_updated.slice(0, 10))}). We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">https://earthdata.nasa.gov/firms</a>), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (<a href="https://earthdata.nasa.gov/lance" target="_blank" rel="noopener">https://earthdata.nasa.gov/lance</a>) and NASA's Earth Science Data and Information System (ESDIS). Outlines: Natural Earth.`;
  }
  function csv() {
    const d = CV.d, R = CV.R;
    if (!d || !R) return;
    const N20 = d.monthly.N20, rows = [
      "year,month,harmonized_viirs_equivalent,range90_low,range90_high,source,raw_terra_modis,raw_aqua_modis,raw_snpp_viirs,raw_noaa20_viirs_not_used"
    ];
    R.ser.forEach(
      (r) => rows.push([r.y, r.m + 1, r.h.toFixed(2), r.lo.toFixed(2), r.hi.toFixed(2), `"${r.src}"`, r.T, r.A, r.V, N20[r.i]].join(","))
    );
    save(`burn-calendar_${d.country}_${CV.yFrom}-${CV.yTo}.csv`, rows.join("\n"), $("cDlMsg"));
  }
  function countryEvents() {
    $("cBack").onclick = () => {
      location.hash = "";
    };
    $("cRetry").onclick = () => {
      if (CV.k) load();
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
    $("cDl").onclick = csv;
    olEventsWorld();
    let rt, lastW = 0;
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const w = $("cBody").clientWidth;
        if (!CV.d || $("country").hidden || w === lastW) return;
        lastW = w;
        drawCharts();
      }, 150);
    });
  }

  // src/extras.ts
  var FILES = ["response.js?v=1", "forecast.js?v=3", "outlook.js?v=1"];
  var loading = null;
  var ready = false;
  var extrasReady = () => ready;
  function loadExtras() {
    if (!loading)
      loading = Promise.all(
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
    return loading;
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
    S.focus = PRESET[st].focus.slice();
    setDraw(false);
    $("hero").hidden = true;
    G.stop && G.stop();
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
    const h = $("hero");
    h.hidden = false;
    h.classList.remove("leaving");
    if (G.ok) G.reset();
  }
  function go(st) {
    if (location.hash !== "#" + SLUG[st]) {
      G.pending = "#" + SLUG[st];
      location.hash = SLUG[st];
    }
  }
  function goCountry(k) {
    const h = "#c/" + slugOf(k);
    if (location.hash !== h) {
      G.pending = h;
      location.hash = h;
    }
  }
  function leaveForCountry() {
    stopPlay();
    closeSheet(true);
    S.st = null;
    $("app").classList.remove("in");
    $("app").hidden = true;
    $("hero").hidden = true;
    G.stop && G.stop();
  }
  async function routeCountry(hash) {
    let raw = hash.slice(3);
    try {
      raw = decodeURIComponent(raw);
    } catch {
    }
    const slug = slugOf(raw);
    let k = WORLD.find((c) => slugOf(c.k) === slug)?.k;
    if (!k) {
      k = await loadIndex().then((list2) => list2.find((c) => slugOf(c.country) === slug)?.country).catch(() => void 0);
      if (location.hash !== hash) return;
    }
    const shape = k ? shapeOf(k) : void 0;
    if (k && shape && G.pending === hash && G.ok && !$("hero").hidden) {
      const key = k, b = shape.b;
      G.pending = null;
      G.flyTo(aimAt(shape.c[0], shape.c[1], Math.min(lonSpan(shape), 180) * Math.cos(shape.c[1] * Math.PI / 180) + (b[3] - b[1])), () => {
        if (location.hash !== hash) return;
        leaveForCountry();
        openCountry(key);
      });
      return;
    }
    G.pending = null;
    leaveForCountry();
    if (k) openCountry(k);
    else countryMissing(slug);
  }
  function route() {
    if (location.hash.startsWith("#c/")) {
      routeCountry(location.hash);
      return;
    }
    closeCountry();
    const st = STS.find((k) => "#" + SLUG[k] === location.hash);
    if (!st) {
      closeSheet(true);
      openHero();
      if (location.hash === "#compare") openSheet("compare");
      return;
    }
    loadExtras();
    if (G.pending === location.hash && G.ok && !$("hero").hidden) {
      G.pending = null;
      G.flyTo({ ry: G.st[st].ry, rx: G.st[st].rx, z: 1.62 }, () => openState(st, true));
    } else {
      G.pending = null;
      openState(st, !$("hero").hidden);
    }
  }

  // src/globe.ts
  var aimAt = (lon, lat, span2 = 0) => ({
    ry: -((lon + 360) % 360 - 360 + 90) * Math.PI / 180,
    rx: lat * Math.PI / 180,
    z: 1.62 + Math.min(0.9, span2 / 90)
  });
  var G = { ok: false, run: false };
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
    let fireStats = /* @__PURE__ */ new Map(), fireT0 = 0, fireLoading = false;
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
        showKey(L2.lo, L2.hi);
        if (hov) tagC.textContent = tagText(hov);
      }).catch(() => {
        $("heroWait").textContent = "Could not load the fire map from Hugging Face.";
        $("heroRetry").hidden = false;
      }).finally(() => fireLoading = false);
    }
    $("heroRetry").onclick = loadFire;
    loadFire();
    const tops = [], RT2 = 1.003;
    G.st = {};
    for (const st of STS) {
      const topM = new T.MeshBasicMaterial({ color: 16777215, side: T.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false });
      topM.visible = false;
      let sum = new T.Vector3(), cnt = 0;
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
          sum.add(v3(p.x, p.y, RT2));
          cnt++;
        }
      }
      const cen = sum.divideScalar(cnt).normalize(), lat = 90 - Math.acos(cen.y) * 180 / Math.PI, lon = Math.atan2(cen.z, -cen.x) * 180 / Math.PI - 180;
      G.st[st] = {
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
      const f = fireStats.get(c.k);
      return f ? `${c.n}
${short(f.perYear)} hotspots a year` : c.n;
    }
    tagC.onclick = () => {
      if (hov) goCountry(hov.k);
    };
    const rt = new T.WebGLRenderTarget(4, 4, { minFilter: T.NearestFilter, magFilter: T.NearestFilter }), post = new T.Scene(), pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pmat = new T.ShaderMaterial({
      uniforms: { tex: { value: rt.texture }, res: { value: new T.Vector2(4, 4) } },
      depthTest: false,
      vertexShader: "varying vec2 u;void main(){u=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
      fragmentShader: "uniform sampler2D tex;uniform vec2 res;varying vec2 u;float B2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}void main(){vec3 c=texture2D(tex,u).rgb;float g=dot(c,vec3(0.3,0.59,0.11));c=clamp(mix(vec3(g),c,1.55)*1.18,0.0,1.0);vec2 p=floor(u*res);float d=B2(0.5*p)*0.25+B2(p);c=floor(c*8.0+d*0.7)/8.0;gl_FragColor=vec4(c,1.0);}"
    });
    post.add(new T.Mesh(new T.PlaneGeometry(2, 2), pmat));
    const base2 = { ry: 8 * Math.PI / 180, rx: 34 * Math.PI / 180 }, user = { ry: 0, rx: 0 };
    let fly = null, drag = null, off = { x: 0, y: 0 }, camZ = 4.6, last = 0;
    const ray = new T.Raycaster(), ndc = new T.Vector2(), ball = new T.Sphere(new T.Vector3(), 1), hitP = new T.Vector3();
    function size() {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const px = 2, lw = Math.ceil(w / px), lh = Math.ceil(h / px);
      ren.setSize(lw, lh, false);
      rt.setSize(lw, lh);
      pmat.uniforms.res.value.set(lw, lh);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      const wide = w / h > 1.05;
      off = { x: 0, y: wide ? 0.06 : 0.25 };
      camZ = wide ? 4.6 : 4.6 / Math.max(0.45, w / h) * 1.02;
    }
    const pick = (e) => {
      const r = cv.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const h = ray.intersectObjects(tops);
      return h.length ? h[0].object.userData.st : null;
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
      const st = pick(e), c = st ? null : pickCountry(e);
      setHov(c);
      for (const k in G.st) G.st[k].hover = k === st;
      cv.style.cursor = st || c ? "pointer" : "grab";
      document.querySelectorAll(".pick").forEach((b) => b.classList.toggle("hover", b.dataset.st === st));
    };
    cv.onpointerup = (e) => {
      const d = drag;
      drag = null;
      if (d && !d.moved) {
        const st = pick(e), c = st ? null : pickCountry(e);
        if (st) go(st);
        else if (c) goCountry(c.k);
      }
    };
    cv.onpointerleave = (e) => {
      if (e.relatedTarget !== tagC) setHov(null);
    };
    G.hover = (st) => {
      for (const k in G.st) G.st[k].hover = k === st;
    };
    G.flyTo = (to, done) => {
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
    G.reset = () => {
      fly = null;
      setHov(null);
      user.ry = user.rx = 0;
      size();
      loadFire();
      if (!G.run) {
        G.run = true;
        last = 0;
        requestAnimationFrame(frame);
      }
    };
    G.stop = () => {
      G.run = false;
    };
    const tmp = new T.Vector3();
    function frame(now) {
      if (!G.run) return;
      const t = now / 1e3, dt = last ? Math.min(0.1, t - last) : 0;
      last = t;
      if (fly) {
        const u = Math.min(1, (now - fly.t0) / 1500), e = ease(u), f = fly.from, s = fly.to;
        grp.rotation.y = f.ry + (s.ry - f.ry) * e;
        grp.rotation.x = f.rx + (s.rx - f.rx) * e;
        grp.position.x = f.x * (1 - e);
        grp.position.y = f.y * (1 - e);
        cam.position.z = f.z + (s.z - f.z) * e;
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
      for (const k in G.st) {
        const s = G.st[k];
        s.topM.visible = s.hover;
        const tag = $("tag" + k);
        tmp.copy(s.cen);
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
      ren.setRenderTarget(rt);
      ren.render(scene, cam);
      ren.setRenderTarget(null);
      ren.render(post, pcam);
      requestAnimationFrame(frame);
    }
    addEventListener("resize", size);
    cam.position.set(0, 0, camZ);
    G.ok = true;
    if (!$("hero").hidden) G.reset();
  }
  function showKey(lo, hi) {
    const cv = $("heroRamp"), g = cv.getContext("2d");
    for (let x = 0; x < cv.width; x++) {
      const f = fireColour(x / (cv.width - 1));
      g.fillStyle = `rgb(${f.c[0]},${f.c[1]},${f.c[2]})`;
      g.fillRect(x, 0, 1, cv.height);
    }
    $("heroLo").textContent = "\u2264" + fmt(lo);
    $("heroHi").textContent = fmt(hi) + "+";
    $("heroKey").classList.add("ready");
  }

  // src/main.ts
  var fold = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^st /, "saint ");
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
    const list2 = [...STS.map((st) => ({ name: NAME[st], st })), ...WORLD.map((c) => ({ name: c.n, k: c.k }))];
    const fill = () => {
      $("countryList").innerHTML = list2.map((f) => f.name).sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");
    };
    fill();
    let asked = false;
    $("heroFind").onfocus = () => {
      if (asked) return;
      asked = true;
      loadIndex().then((idx) => {
        const have = new Set(WORLD.map((c) => c.k)), extra = idx.filter((c) => !have.has(c.country));
        if (!extra.length) return;
        list2.push(...extra.map((c) => ({ name: c.name, k: c.country })));
        fill();
      }).catch(() => asked = false);
    };
    const find = (q) => {
      const f = fold(q);
      if (!f) return null;
      const alias = ALIAS[f];
      return list2.find((c) => fold(c.name) === f || "k" in c && fold(c.k) === f) || alias && list2.find((c) => "k" in c && c.k === alias) || list2.find((c) => fold(c.name).startsWith(f)) || /* a word inside the name, such as "guinea" in "Papua New Guinea"; not single letters or pairs */
      f.length >= 3 && list2.find((c) => (" " + fold(c.name)).includes(" " + f)) || null;
    };
    const open = (hit) => {
      $("heroFind").value = "";
      $("heroMsg").textContent = "";
      $("heroFind").blur();
      if ("st" in hit) go(hit.st);
      else goCountry(hit.k);
    };
    $("heroForm").onsubmit = (e) => {
      e.preventDefault();
      const q = $("heroFind").value, hit = find(q);
      if (hit) open(hit);
      else $("heroMsg").textContent = q.trim() ? `No country called "${q.trim()}". Try another spelling.` : "Type a country's name.";
    };
    $("heroFind").oninput = (e) => {
      $("heroMsg").textContent = "";
      if (e instanceof InputEvent && e.inputType && e.inputType !== "insertReplacementText") return;
      const v = fold($("heroFind").value), hit = list2.find((c) => fold(c.name) === v);
      if (hit) open(hit);
    };
  }
  function init() {
    const yo = [];
    for (let y = Y0; y <= Y1; y++) yo.push(`<option>${y}</option>`);
    $("yFrom").innerHTML = $("yTo").innerHTML = $("fY").innerHTML = yo.join("");
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
    const setYear = (y) => {
      stopPlay();
      if (S.layer === "count" && S.show.t === "year" && S.show.y === y) return;
      S.layer = "count";
      S.show = { t: "year", y };
      render();
    };
    tr.onpointerdown = (e) => {
      tr.setPointerCapture(e.pointerId);
      tlDrag = true;
      setYear(yearAt(e));
    };
    tr.onpointermove = (e) => {
      if (tlDrag) setYear(yearAt(e));
    };
    tr.onpointerup = tr.onpointercancel = () => {
      tlDrag = false;
    };
    tr.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1, cur2 = S.show.t === "year" ? S.show.y : d > 0 ? S.yFrom - 1 : S.yTo + 1;
      setYear(Math.max(S.yFrom, Math.min(S.yTo, cur2 + d)));
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
    const usePt = (lat, lon, rad) => {
      if (!isFinite(lat) || !isFinite(lon) || !(rad > 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        $("dlMsg").textContent = "Enter a latitude, a longitude and a radius first.";
        return;
      }
      S.sel = { type: "circle", lat, lon, rad };
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
      b.onmouseenter = () => G.hover && G.hover(b.dataset.st);
      b.onmouseleave = () => G.hover && G.hover(null);
    });
    heroSearch();
    countryEvents();
    $("dlCal").onclick = csvCal;
    $("dlHot").onclick = csvHot;
    $("dlFc").onclick = csvForecast;
    $("dlFcC").onclick = csvForecastCounty;
    mapEvents();
    respEvents();
    oddsEvents();
    olEvents();
    let rt;
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
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
