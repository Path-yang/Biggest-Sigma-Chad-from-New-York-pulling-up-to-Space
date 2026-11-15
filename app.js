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
    rm: (/* @__PURE__ */ new Date()).getMonth()
  };

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
    const total = stats.reduce((a, z) => a + z.sum, 0), order = stats.map((z, m) => ({ m, sum: z.sum })).sort((a, b) => b.sum - a.sum), ranked = years.slice().sort((a, b) => b.h - a.h);
    return { ser, stats, years, total, mean: total / years.length, order, ranked };
  }
  function verdict(R, focus = S.focus) {
    const [fy, fm] = focus, f = R.ser.find((r) => r.y === fy && r.m === fm);
    if (!f) return null;
    const same = R.ser.filter((r) => r.m === fm).map((r) => r.h), n = same.length, rank = same.filter((v) => v > f.h).length + 1, pct = same.filter((v) => v < f.h).length / Math.max(1, n - 1) * 100, med = R.stats[fm].med;
    let label = "Typical", cls = "";
    if (!(f.h === 0 && med === 0)) {
      if (pct >= 90) {
        label = "Unusually high";
        cls = "hi";
      } else if (pct >= 75) {
        label = "Above normal";
        cls = "hi";
      } else if (pct <= 10) {
        label = "Unusually low";
        cls = "lo";
      } else if (pct <= 25) {
        label = "Below normal";
        cls = "lo";
      }
    }
    return { f, fm, fy, label, cls, rank, n, med, mult: med > 0 ? times(f.h / med) + " a normal " + MON[fm] : fmt(f.h) + (fmt(f.h) === "1" ? " hotspot" : " hotspots") };
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
    const s = D.states[st], [a, b] = riskYears(), ny = b - a + 1, nc = s.counties.length, M = new Float64Array(nc * ny), rows = s.county_rows;
    for (let p = 0; p < rows.length; p += 5) {
      const i = rows[p + 1];
      if (i % 12 !== m) continue;
      const y = Y0 + Math.floor(i / 12);
      if (y < a || y > b) continue;
      M[rows[p] * ny + (y - a)] += harm(st, i, rows[p + 2], rows[p + 3], rows[p + 4]).h;
    }
    return s.counties.map((c, ci) => {
      const v = Array.from(M.subarray(ci * ny, (ci + 1) * ny)).sort((x, y) => x - y), k = v.filter((x) => x > 0).length;
      return { ci, name: c.name, k, n: ny, p: k / ny, med: (v[Math.floor((ny - 1) / 2)] + v[Math.ceil((ny - 1) / 2)]) / 2 };
    }).sort((x, y) => y.med - x.med || y.p - x.p);
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
    const rk = riskFor(R, S.rm);
    $("c4q").textContent = `Chance of fire in ${MON[S.rm]}`;
    $("c4").textContent = rk.n ? Math.round(rk.p * 100) + "%" : "n/a";
    $("openCmp").textContent = "Compare with " + NAME[STS.find((k) => k !== S.st)];
  }
  function renderTimeline(R) {
    const ys = R.years, n = ys.length, W = 600, bw = W / n, mx = Math.max(1, ...ys.map((y) => y.h)), cur = S.show.t === "year" && S.layer === "count" ? S.show.y : null;
    let g = "";
    ys.forEach((y, i) => {
      const h = Math.max(2, 32 * Math.sqrt(y.h / mx)), on = y.y === cur;
      g += `<rect x="${i * bw + 1.5}" y="${38 - h}" width="${bw - 3}" height="${h}" rx="2" fill="${on ? "#ff8a3d" : cur == null ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.28)"}"/>`;
      if (on || i % 4 === 0 && (cur == null || Math.abs(y.y - cur) > 2))
        g += `<text x="${(i + 0.5) * bw}" y="51" text-anchor="middle" ${on ? 'class="hl"' : ""}>${y.y}</text>`;
    });
    if (cur != null) {
      const x = (cur - S.yFrom + 0.5) * bw;
      g += `<line x1="${x}" x2="${x}" y1="4" y2="40" stroke="#fff" stroke-width="2"/><circle cx="${x}" cy="5" r="5" fill="#fff"/>`;
    }
    const tr = $("tlTrack");
    tr.innerHTML = `<svg viewBox="0 0 ${W} 54" aria-hidden="true">${g}</svg>`;
    tr.setAttribute("aria-valuemin", String(S.yFrom));
    tr.setAttribute("aria-valuemax", String(S.yTo));
    tr.setAttribute("aria-valuenow", String(cur == null ? S.yTo : cur));
    tr.setAttribute("aria-valuetext", cur == null ? "All years" : String(cur));
    const yr = cur != null ? ys[cur - S.yFrom] : null;
    $("tlLabel").innerHTML = yr ? `<b>${cur}</b>${fmt(yr.h)} hotspots${cur < 2012 ? " (converted from MODIS)" : ""}` : S.layer === "chance" ? "Drag along the years to see where each one burned" : S.show.t === "all" ? "Drag along the years to see where each one burned" : "Map shows: " + showLabel();
    $("showReset").hidden = S.layer === "chance" || S.show.t === "all";
  }

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
    $("a4n").textContent = rk.n ? `Fire was detected here in ${rk.k} of the ${rk.n} ${mo}s from ${rk.a} to ${rk.b}.` + (rk.k ? ` When it burns, typically ${fmt(rk.typical)} hotspots; the worst was ${fmt(rk.worst.h)} in ${rk.worst.y}. Most recent: ${rk.last}.` : "") + " History, not a forecast." : "";
    const wl = countyRisk(S.st, S.rm).slice(0, 8);
    $("watchTitle").textContent = `Where to watch in ${mo}: ${NAME[S.st]} counties`;
    $("watch").innerHTML = wl.map(
      (w, i) => `<button type="button" class="w" data-ci="${w.ci}"><span class="rk">${i + 1}</span><b>${w.name}</b><span class="pc">${Math.round(w.p * 100)}%</span><small>Fire in ${w.k} of ${w.n} ${mo}s \xB7 typically ${fmt(w.med)} hotspots</small></button>`
    ).join("");
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
    $("shClose").focus();
  }
  function closeSheet(silent) {
    if (!S.sheet) return;
    S.sheet = null;
    $("sheetWrap").hidden = true;
    hideTip();
    if (!silent && location.hash === "#compare") location.hash = "";
  }

  // src/render.ts
  function render() {
    document.querySelectorAll("#modeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
    document.querySelectorAll("#layerSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === S.layer)));
    $("rmMap").hidden = S.layer !== "chance";
    $("rmMap").value = String(S.rm);
    if (S.st) {
      selFocus();
      const R = analyseFor(S.st, S.sel);
      renderCard(R);
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
  function fitView(b) {
    const pad = 70, s = Math.min((V.W - inset() - 2 * pad) / (b.x1 - b.x0), (V.H - 216) / (b.y1 - b.y0));
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
    if (S.layer === "chance") {
      const [a, b] = riskYears(), n = b - a + 1;
      V.chN = n;
      max = 1;
      for (let k = 0; k < hx.n; k++) {
        let c = 0;
        for (let y = a; y <= b; y++) if (hx.H[k * NM + (y - Y0) * 12 + S.rm] > 0) c++;
        v[k] = c / n;
      }
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
  function legend() {
    const ch = S.layer === "chance", f = V.fineOn, sh = S.show, [a, b] = riskYears(), lut2 = LUT(), mx = f ? hexState(S.st).f.max : V.max;
    $("legTitle").textContent = f ? ch ? "How often each 2 km hexagon has burned since 2012" : "Hotspots per 2 km hexagon since 2012" : ch ? `Chance of fire in ${MONL[S.rm]}: share of years ${a} to ${b} with a hotspot` : sh.t === "cmonth" ? `Average hotspots per hexagon in ${MONL[sh.m]}` : `Hotspots per hexagon, ${sh.t === "year" ? sh.y : sh.t === "ym" ? MON[sh.m] + " " + sh.y : S.yFrom + " to " + S.yTo}`;
    let g = "";
    [0, 0.25, 0.5, 0.75, 1].forEach((t, i) => {
      const r = 5.5 + 7.5 * t, x = 24 + i * 49, pts = [];
      for (let q = 0; q < 6; q++) {
        const an = Math.PI / 180 * (30 + 60 * q);
        pts.push((x + r * Math.cos(an)).toFixed(1) + "," + (15 - r * Math.sin(an)).toFixed(1));
      }
      g += `<polygon points="${pts.join(" ")}" fill="${colT(lut2, t)}"/><text x="${x}" y="42" text-anchor="middle">${ch ? i ? Math.round(t * 100) + "%" : "rare" : short(Math.max(1, Math.round(Math.expm1(t * Math.log1p(mx)))))}</text>`;
    });
    $("legSw").innerHTML = `<svg viewBox="0 0 244 46" role="img" aria-label="Larger, stronger-coloured hexagons mean more fire">${g}</svg>`;
    $("legCap").textContent = (S.pal === "fire" ? "Bigger and redder" : "Bigger and brighter") + (ch ? " means fire more often." : " means more fire.") + (V.early ? " 2 km detail starts in 2012." : "");
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
    const zr = V.s / V.fit, K = Math.min(hx.towns.length, Math.round(80 * Math.pow(zr, 1.6))), pad = Math.max(5, 15 - 2.5 * zr), cap = Math.round(12 + 5 * zr), boxes = [];
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    for (let i = 0; i < K && boxes.length < cap; i++) {
      const t = hx.towns[i], x = sx(t.X), y = sy(t.Y);
      if (x < 4 || y < 12 || x > V.W - 30 || y > V.H - 12) continue;
      const big = t.pop >= 1e5, w = (big ? 7.6 : 6.6) * t.n.length, hit = (b2) => boxes.some((o) => b2[0] < o[2] && b2[2] > o[0] && b2[1] < o[3] && b2[3] > o[1]);
      let b = [x - 6 - pad, y - 9 - pad, x + 9 + w + pad, y + 9 + pad], left = false;
      if (hit(b)) {
        b = [x - 9 - w - pad, y - 9 - pad, x + 6 + pad, y + 9 + pad];
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
    const R = hx.R * V.s, rr = R * (R > 5 ? 0.93 : 1), early = !ch && (sh.t === "year" || sh.t === "ym") && sh.y < 2012, fineT = early ? 0 : Math.max(0, Math.min(1, (R - 20) / 16)), zf = Math.log2(360 * hx.K * V.s / 256);
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
    if (fineT < 1) {
      const sc = V.selC, base = (1 - fineT) * (tiles ? 0.62 : 1);
      for (let k = 0; k < hx.n; k++) {
        const x = sx(hx.X[k]), y = sy(hx.Y[k]);
        if (x < -rr || y < -rr || x > V.W + rr || y > V.H + rr) continue;
        const v = V.vals[k];
        let a = 1;
        if (sc && !mask[k]) {
          const d = Math.max(0, Math.hypot(hx.X[k] - sc.x, hx.Y[k] - sc.y) - sc.r);
          a = Math.max(0.08, 0.4 * Math.exp(-d / (hx.R * 8)));
        }
        c.globalAlpha = a * base * (tiles ? 0.45 : 1);
        c.fillStyle = "#141a27";
        hexPath(x, y, ox, oy, 1);
        c.fill();
        if (v > 0) {
          const t = ch ? v : Math.log1p(v) / lmax;
          c.globalAlpha = a * base;
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
  }
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
      const k = hexAt(p[0], p[1]), j = V.fineOn ? fineAt(p[0], p[1]) : -1, county = k >= 0 ? D.states[S.st].counties[hx.c[k]].name + " County" : "";
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
            `${county ? county + "\n" : ""}${fmt(f.c[j])} hotspots in this 2 km hexagon since 2012
Burned in ${pop(f.ym[j])} of 14 years, last in ${2012 + 31 - Math.clz32(f.ym[j])}
Months with fire: ${MON.filter((_, m) => f.mm[j] >> m & 1).join(", ")}
Click to zoom in`
          );
        else if (k >= 0) showTip(e, `${county}
No hotspots detected here since 2012`);
        else hideTip();
      } else if (k >= 0)
        showTip(
          e,
          (S.layer === "chance" ? `${county}
Fire detected here in ${Math.round(V.vals[k] * V.chN)} of ${V.chN} ${MONL[S.rm]}s (${Math.round(V.vals[k] * 100)}%)` : `${county}
${fmt(V.vals[k])} hotspots in this hexagon
${showLabel()}`) + "\nClick to zoom in"
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
    const total = Number(res.headers.get("content-length")) || null;
    if (!res.body) return res.text();
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress()?.(got, total);
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
    { c: [150, 30, 20], a: 0.16 },
    { c: [220, 50, 26], a: 0.32 },
    { c: [255, 112, 32], a: 0.46 },
    { c: [255, 190, 64], a: 0.58 },
    { c: [255, 240, 170], a: 0.7 }
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
  var quantile = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  function buildFireLayer(index2, width = 2048) {
    const total = new Map(index2.map((e) => [e.country, e.total])), raw = [];
    for (const c of WORLD) {
      const tot = total.get(c.k), area = areaKm2(c);
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
      const b = x.c.b;
      if (X(b[2]) - X(b[0]) < 3 && Y(b[1]) - Y(b[3]) < 3) {
        g.beginPath();
        g.arc(X(x.c.c[0]), Y(x.c.c[1]), 2, 0, 2 * Math.PI);
        g.fill();
      }
    }
    return { canvas: cv, stats, lo: Math.pow(10, l0), hi: Math.pow(10, l1) };
  }

  // src/country.ts
  var CV = { k: null, d: null, R: null, yFrom: 2001, yTo: 2025, focus: [2025, 0], mode: "count" };
  var SENSOR_FROM = { T: 2e3, V: 2012, N20: 2018 };
  var SENSORS = [
    { s: "T", name: "Terra", c: "#6fa8ff" },
    { s: "A", name: "Aqua", c: "#a9c7f5" },
    { s: "V", name: "Suomi NPP", c: "#ff8a3d" },
    { s: "N20", name: "NOAA-20", c: "#bcc5d3", dash: "5 4" }
  ];
  var esc = (t) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  var pc = (x) => x == null ? "n/a" : Math.round(x * 100) + "%";
  var nHot = (n) => `${fmt(n)} hotspot${fmt(n) === "1" ? "" : "s"}`;
  var epochs = (d) => ({
    vi0: (d.viirs_from[0] - d.y0) * 12 + d.viirs_from[1] - 1,
    aq0: (d.aqua_from[0] - d.y0) * 12 + d.aqua_from[1] - 1,
    bins: d.bins
  });
  function openCountry(k) {
    if (CV.k === k && CV.d) return;
    CV.k = k;
    CV.d = CV.R = null;
    const el = $("country");
    el.hidden = false;
    el.scrollTop = 0;
    $("cName").textContent = nameOf(k);
    $("cCrumb").textContent = "Country";
    requestAnimationFrame(() => el.classList.add("in"));
    load();
  }
  function closeCountry() {
    if (CV.k === null) return;
    CV.k = null;
    hideTip();
    const el = $("country");
    el.classList.remove("in");
    el.hidden = true;
  }
  function countryMissing(slug) {
    CV.k = "";
    CV.d = CV.R = null;
    const el = $("country");
    el.hidden = false;
    el.classList.add("in");
    $("cName").textContent = "Not found";
    $("cCrumb").textContent = "Country";
    $("cBody").hidden = $("cCtl").hidden = true;
    $("cStatus").hidden = false;
    $("cBar").parentElement.hidden = $("cRetry").hidden = true;
    $("cMsg").textContent = `There is no country at "#c/${slug}". Go back to the globe, or search for a country there.`;
  }
  function load() {
    const k = CV.k, name = nameOf(k);
    $("cBody").hidden = $("cCtl").hidden = true;
    $("cStatus").hidden = false;
    $("cRetry").hidden = true;
    $("cBar").parentElement.hidden = false;
    $("cBar").style.width = "0";
    $("cMsg").textContent = `Loading ${name} from Hugging Face\u2026`;
    loadSummary(k, (got, total) => {
      if (CV.k !== k) return;
      const mb = (n) => (n / 1e6).toFixed(n < 1e5 ? 2 : 1) + " MB";
      if (total && got <= total) {
        $("cBar").style.width = got / total * 100 + "%";
        $("cMsg").textContent = `Loading ${name} from Hugging Face\u2026 ${mb(got)} of ${mb(total)}`;
      } else $("cMsg").textContent = `Loading ${name} from Hugging Face\u2026 ${mb(got)}`;
    }).then((d) => {
      if (CV.k !== k) return;
      CV.d = d;
      start(d);
    }).catch((e) => {
      if (CV.k !== k) return;
      $("cBar").parentElement.hidden = true;
      $("cMsg").textContent = `Could not load ${name} from Hugging Face. ${e instanceof Error ? e.message : String(e)}.`;
      $("cRetry").hidden = false;
    });
  }
  function start(d) {
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
    }), name = d.name;
    CV.R = R;
    $("cCrumb").textContent = `Country \xB7 ${CV.yFrom}\u2013${CV.yTo}`;
    $("cLead").textContent = (R.total === 0 ? `No vegetation fire hotspots were counted in ${name} in these years.` : leadText(R)) + (CV.yFrom < d.viirs_from[0] && d.val.monthly_wape != null && d.val.monthly_wape > 1 ? ` Years before ${d.viirs_from[0]} are rough here: tested on years VIIRS saw, converted months were off by ${pc(d.val.monthly_wape)} on average.` : "");
    answers(R);
    drawMap();
    const N20 = d.monthly.N20, pickFocus = (y, m) => {
      CV.focus = [y, m];
      renderCountry();
    };
    calendarInto($("cCal"), R, {
      mode: CV.mode,
      focus: true,
      focusYM: CV.focus,
      vi0: ep.vi0,
      more: (r) => `Raw: Terra ${fmt(r.T)}, Aqua ${fmt(r.A)}, Suomi NPP ${fmt(r.V)}, NOAA-20 ${fmt(N20[r.i])} (not used)`,
      click: (r) => pickFocus(r.y, r.m)
    });
    document.querySelectorAll("#cModeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === CV.mode)));
    $("cCalNote").textContent = CV.mode === "count" ? "Every month of every year, newest at the top. Brighter means more hotspots. Tap a month to test whether it was unusual." : "Red months ran above what is normal for that month, blue months below. Tap a month to test it.";
    paintRamp("cCalRamp", CV.mode === "count" ? seq : (t) => div(t * 2 - 1));
    $("cCalLo").textContent = CV.mode === "count" ? "fewer" : "\u215B\xD7 normal";
    $("cCalHi").textContent = CV.mode === "count" ? "more (log scale)" : "8\xD7 normal";
    const ys = R.years, xs = ys.map((y) => y.y), top = [];
    ys.map((y, i) => [y.h, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).forEach((a) => {
      if (a[0] > 0 && !top.some((i) => Math.abs(i - a[1]) < 2)) top.push(a[1]);
    });
    bars(
      $("cYears"),
      xs,
      ys.map((y) => y.h),
      {
        aria: "Hotspots per year",
        step: Math.ceil(xs.length / 9),
        sel: xs.indexOf(CV.focus[0]),
        avg: R.mean,
        top,
        hatch: (i) => xs[i] < 2012,
        lo: ys.map((y) => y.lo),
        hi: ys.map((y) => y.hi),
        whisk: (i) => xs[i] < 2012,
        tip: (i) => `${xs[i]}: ${nHot(ys[i].h)}
${R.mean > 0 ? (ys[i].h >= R.mean ? "+" : "") + Math.round((ys[i].h / R.mean - 1) * 100) + "% against the average year" : ""}` + (xs[i] < 2012 ? `
Converted from MODIS, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "\nSeen by VIIRS"),
        click: (i) => pickFocus(xs[i], CV.focus[1])
      }
    );
    bars(
      $("cMonths"),
      MON,
      R.stats.map((z) => z.med),
      {
        aria: "Typical hotspots by calendar month",
        sel: CV.focus[1],
        lo: R.stats.map((z) => z.q1),
        hi: R.stats.map((z) => z.q3),
        whisk: () => true,
        tip: (m) => `${MONL[m]}
Typical: ${nHot(R.stats[m].med)}
Half of years fall between ${fmt(R.stats[m].q1)} and ${fmt(R.stats[m].q3)}`,
        click: (m) => pickFocus(CV.focus[0], m)
      }
    );
    const bandN = xs.filter((y) => y <= 2012).length;
    lines(
      $("cSeam"),
      xs,
      [
        { v: ys.map((y) => y.naive), c: "#6fa8ff" },
        { v: ys.map((y) => y.h), c: "#ff8a3d" }
      ],
      {
        W: 660,
        vline: xs.indexOf(2012),
        band: { lo: ys.map((y) => y.lo), hi: ys.map((y) => y.hi), n: bandN, c: "rgba(255,138,61,.22)" },
        aria: "Raw joined counts against the harmonized record",
        tip: (i) => `${xs[i]}
Harmonized: ${fmt(ys[i].h)}` + (xs[i] <= 2012 ? `, likely ${fmt(ys[i].lo)} to ${fmt(ys[i].hi)}` : "") + `
Raw counts: ${fmt(ys[i].naive)}`
      }
    );
    const avg = (a, b, k) => {
      const r = ys.filter((y) => y.y >= a && y.y <= b);
      return r.length === b - a + 1 ? r.reduce((z, y) => z + y[k], 0) / r.length : null;
    };
    const n0 = avg(2007, 2011, "naive"), n1 = avg(2012, 2016, "naive"), h0 = avg(2007, 2011, "h"), h1 = avg(2012, 2016, "h");
    $("cSeamNote").textContent = n0 == null || h0 == null || n1 == null || h1 == null ? "The blue line jumps in 2012 only because the sensor changed. Choose years from 2007 to 2016 or wider to measure the step." : n0 === 0 || h0 === 0 ? "MODIS counted no hotspots here in 2007\u20132011, so the step at 2012 cannot be measured." : `Raw counts make 2012\u20132016 look ${(n1 / n0).toFixed(1)}\xD7 busier than 2007\u20132011. In the harmonized record the step is ${(h1 / h0).toFixed(1)}\xD7.`;
    sensors(d, R);
    method(d);
  }
  function answers(R) {
    if (R.total === 0) {
      $("ca1").textContent = $("ca2").textContent = "None";
      $("ca1n").textContent = $("ca2n").textContent = "";
    } else {
      const top = R.order.slice(0, 3).filter((o) => o.sum > 0), worst = R.ranked.slice(0, 3).filter((y) => y.h > 0), quiet = R.order.filter((o) => o.sum === 0), share = Math.round(top.reduce((a, o) => a + o.sum, 0) / R.total * 100);
      $("ca1").textContent = top.map((o) => MON[o.m]).join(", ");
      $("ca1n").textContent = (top.length === 1 ? `Every hotspot fell in ${MONL[top[0].m]}.` : `${top.length === 2 ? "These two months" : "These three months"} hold ${share}% of all hotspots.`) + (quiet.length > 1 ? ` ${quiet.length} months had none in these years.` : ` ${MONL[R.order[11].m]} is the quietest${quiet.length ? ", with none" : ""}.`);
      $("ca2").textContent = worst.map((y) => y.y).join(", ");
      $("ca2n").textContent = worst.map((y) => `${y.y}: ${fmt(y.h)}${y.y < 2012 ? " (converted)" : ""}`).join(" \xB7 ") + `. An average year has ${fmt(R.mean)}.`;
    }
    const v = verdict(R, CV.focus), vi0 = epochs(CV.d).vi0;
    $("cfM").value = String(CV.focus[1]);
    $("cfY").value = String(CV.focus[0]);
    if (!v) {
      $("ca3").textContent = "Outside the chosen years";
      $("ca3n").textContent = "";
    } else if (R.ser.every((r) => r.m !== v.fm || r.h === 0)) {
      $("ca3").textContent = "No hotspots";
      $("ca3n").textContent = `No hotspots in ${MONL[v.fm]} in any of these years, so there is nothing to compare.`;
    } else {
      $("ca3").innerHTML = `<span class="pill ${v.cls}">${v.label}</span>${v.mult}`;
      $("ca3n").textContent = `${nHot(v.f.h)} against a normal ${fmt(v.med)}. Rank ${v.rank} of ${v.n} years.` + (v.f.i < vi0 ? ` Converted from MODIS, likely between ${fmt(v.f.lo)} and ${fmt(v.f.hi)}.` : " Seen directly by VIIRS.");
    }
  }
  function sensors(d, R) {
    const from = { ...SENSOR_FROM, A: d.aqua_from[0] }, xs = R.years.map((y) => y.y), per = SENSORS.map((z) => ({
      ...z,
      v: xs.map((y) => {
        if (y < from[z.s]) return NaN;
        const i = (y - d.y0) * 12;
        return d.monthly[z.s].slice(i, i + 12).reduce((a, b) => a + b, 0);
      })
    }));
    $("cRawKey").innerHTML = per.map(
      (z) => `<span><i style="background:${z.dash ? `repeating-linear-gradient(90deg,${z.c} 0 5px,transparent 5px 9px)` : z.c};height:3px"></i>${z.name}${z.s === "N20" ? " (not used in the harmonized record)" : ""}</span>`
    ).join("");
    lines($("cRaw"), xs, per, {
      W: 560,
      h: 250,
      labels: true,
      every: 9,
      aria: "Raw detections per year from each satellite",
      tip: (i) => `${xs[i]}
` + per.map((z) => `${z.name}: ${Number.isFinite(z.v[i]) ? fmt(z.v[i]) : "not flying"}${z.s === "N20" ? " (not used)" : ""}`).join("\n")
    });
  }
  function method(d) {
    const val = d.val;
    $("cTiles").innerHTML = `<div class="tile"><b>${val.raw_factor == null ? "n/a" : val.raw_factor.toFixed(1) + "\xD7"}</b><span>more hotspots from VIIRS than MODIS for the same fires in ${esc(d.name)}, 2012\u20132025</span></div><div class="tile"><b>${pc(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div><div class="tile"><b>${pc(val.annual_max_err)}</b><span>error in the worst tested year</span></div><div class="tile"><b>${pc(val.monthly_wape)}</b><span>typical error of a converted month, weighted by size</span></div>`;
    $("cRateNote").textContent = d.rate_note;
    $("cFilter").textContent = d.filter;
    $("cCell").textContent = `${d.cell}\xB0`;
    const row = (label, a) => `<tr><td>${label}</td>${a.map((r) => `<td>${r.toFixed(1)}</td>`).join("")}</tr>`;
    $("cRates").innerHTML = `<tr><th>Rate</th>${MON.map((m) => `<th>${m}</th>`).join("")}</tr>` + row("Terra+Aqua", d.r_ta) + row("  90% low", d.r_ta_lo) + row("  90% high", d.r_ta_hi) + row("Terra only", d.r_t);
    $("cLoyo").innerHTML = `<tr><th>Held-out year</th><th>Seen by VIIRS</th><th>Predicted from MODIS</th><th>Raw MODIS</th><th>Error</th></tr>` + val.loyo.map(
      (r) => `<tr><td>${Number(r.y)}</td><td>${fmt(r.obs)}</td><td>${fmt(r.pred)}</td><td>${fmt(r.modis)}</td><td>${r.obs > 0 ? (r.pred >= r.obs ? "+" : "") + Math.round((r.pred / r.obs - 1) * 100) + "%" : "n/a"}</td></tr>`
    ).join("");
    const path = summaryPath(d.country), url = fileUrl(path);
    $("cSrc").innerHTML = `Data: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(path)}</a> from the Hugging Face dataset <a href="${HF_PAGE}" target="_blank" rel="noopener">${HF_DATASET}</a>, built from ${d.source.files} FIRMS files (latest FIRMS update ${esc(d.source.firms_updated.slice(0, 10))}). We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">https://earthdata.nasa.gov/firms</a>), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (<a href="https://earthdata.nasa.gov/lance" target="_blank" rel="noopener">https://earthdata.nasa.gov/lance</a>) and NASA's Earth Science Data and Information System (ESDIS). Outlines: Natural Earth.`;
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
  var MF = null;
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
  function shiftRing(r, lon0) {
    const off = near(r[0], lon0) - r[0];
    return off ? r.map((v, i) => i % 2 ? v : v + off) : r;
  }
  function drawMap() {
    const d = CV.d, cv = $("cMap"), W = cv.parentElement.clientWidth;
    if (!d || !W) return;
    const shape = shapeOf(d.country), lon0 = shape ? shape.c[0] : (d.bbox[0] + d.bbox[2]) / 2, own = shape ? shape.r.map((r) => shiftRing(r, lon0)) : [], cell = d.cell, nc = d.cells.length / 2, { la: cla, lo: clo } = cellIndexes(d), tot = new Float64Array(nc), modis = new Float64Array(nc), viirs = new Float64Array(nc), cellAt = /* @__PURE__ */ new Map();
    for (let p = 0; p < d.cell_rows.length; p += 5) {
      const y = d.y0 + d.cell_rows[p + 1];
      if (y < CV.yFrom || y > CV.yTo) continue;
      const c2 = d.cell_rows[p];
      tot[c2] += d.cell_rows[p + 2];
      modis[c2] += d.cell_rows[p + 3];
      viirs[c2] += d.cell_rows[p + 4];
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (lon, lat) => {
      if (lon < x0) x0 = lon;
      if (lon > x1) x1 = lon;
      if (lat < y0) y0 = lat;
      if (lat > y1) y1 = lat;
    };
    for (const r of own) for (let i = 0; i < r.length; i += 2) grow(r[i], r[i + 1]);
    const cellLon = new Float64Array(nc);
    for (let c2 = 0; c2 < nc; c2++) {
      const la = cla[c2] * cell, lo = clo[c2] * cell;
      cellAt.set(cla[c2] + "," + clo[c2], c2);
      cellLon[c2] = near(lo + cell / 2, lon0) - cell / 2;
      grow(cellLon[c2], la);
      grow(cellLon[c2] + cell, la + cell);
    }
    if (!isFinite(x0)) {
      grow(near(d.bbox[0], lon0), d.bbox[1]);
      grow(near(d.bbox[2], lon0), d.bbox[3]);
    }
    const span = Math.max(0.5, x1 - x0), spanY = Math.max(0.5, y1 - y0), k = Math.max(0.2, Math.cos((y0 + y1) / 2 * Math.PI / 180)), pad = 14, H = Math.round(Math.max(240, Math.min(560, innerHeight * 0.7, W * spanY / (span * k)))), s = Math.min((W - 2 * pad) / (span * k), (H - 2 * pad) / spanY), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.height = H + "px";
    cv.width = W * dpr;
    cv.height = H * dpr;
    const base = document.createElement("canvas");
    base.width = cv.width;
    base.height = cv.height;
    const c = base.getContext("2d"), X = (lon) => W / 2 + (lon - cx) * k * s, Y = (lat) => H / 2 - (lat - cy) * s, ring = (r) => {
      c.moveTo(X(r[0]), Y(r[1]));
      for (let i = 2; i < r.length; i += 2) c.lineTo(X(r[i]), Y(r[i + 1]));
      c.closePath();
    }, border = (k2, r, orig) => {
      for (let i = 0; i + 3 < r.length; i += 2) {
        if (cutEdge(k2, orig[i], orig[i + 1], orig[i + 2], orig[i + 3])) continue;
        c.moveTo(X(r[i]), Y(r[i + 1]));
        c.lineTo(X(r[i + 2]), Y(r[i + 3]));
      }
    };
    c.scale(dpr, dpr);
    c.fillStyle = "#05080f";
    c.fillRect(0, 0, W, H);
    const vw = W / (2 * k * s), vh = H / (2 * s);
    const near3 = [];
    for (const o of WORLD) {
      if (o.k === d.country) continue;
      const b = o.b;
      if (b[1] > cy + vh || b[3] < cy - vh) continue;
      for (const r of o.r) {
        const rr = shiftRing(r, lon0);
        let a = Infinity, z = -Infinity;
        for (let i = 0; i < rr.length; i += 2) {
          if (rr[i] < a) a = rr[i];
          if (rr[i] > z) z = rr[i];
        }
        if (z >= cx - vw && a <= cx + vw) near3.push([o.k, rr, r]);
      }
    }
    c.beginPath();
    near3.forEach((n) => ring(n[1]));
    c.fillStyle = "#0f1522";
    c.fill();
    c.beginPath();
    near3.forEach((n) => border(...n));
    c.strokeStyle = "rgba(255,255,255,.12)";
    c.lineWidth = 1;
    c.stroke();
    c.beginPath();
    own.forEach(ring);
    c.fillStyle = "#1b2334";
    c.fill();
    let mx = 0;
    for (let j = 0; j < nc; j++) if (tot[j] > mx) mx = tot[j];
    const lmax = Math.log1p(mx), lut2 = LUT(), side = Math.max(1.5, cell * s);
    for (let j = 0; j < nc; j++) {
      if (tot[j] <= 0) continue;
      c.fillStyle = lut2[Math.round(63 * (0.06 + 0.94 * Math.log1p(tot[j]) / lmax))];
      c.fillRect(X(cellLon[j]), Y(cla[j] * cell + cell), Math.max(side, cell * k * s) + 0.5, side + 0.5);
    }
    c.beginPath();
    own.forEach((r, i) => border(d.country, r, shape.r[i]));
    c.strokeStyle = "rgba(241,244,249,.65)";
    c.lineWidth = 1.2;
    c.stroke();
    MF = { W, H, cx, cy, lon0, k, s, base, cellAt, la: cla, lo: clo, tot, modis, viirs, hover: -1 };
    blit();
    paintRamp("cMapRamp", seq);
    $("cMapHi").textContent = mx > 0 ? `${short(mx)} per square (log scale)` : "";
    $("cMapNote").textContent = nc ? `Each square is ${cell}\xB0 across, about ${Math.round(cell * 111)} km north to south. Colour shows the hotspots counted in it over ${CV.yFrom}\u2013${CV.yTo}, in VIIRS terms, on a log scale. Hover or tap a square for its numbers.` : `No hotspots were counted anywhere in ${d.name}, so the map has no squares.`;
  }
  function blit() {
    const f = MF, d = CV.d;
    if (!f || !d) return;
    const cv = $("cMap"), c = cv.getContext("2d"), dpr = cv.width / f.W;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(f.base, 0, 0);
    if (f.hover < 0) return;
    const cell = d.cell, la = f.la[f.hover] * cell, lo = near(f.lo[f.hover] * cell + cell / 2, f.lon0) - cell / 2, x = f.W / 2 + (lo - f.cx) * f.k * f.s, y = f.H / 2 - (la + cell - f.cy) * f.s, side = Math.max(1.5, cell * f.s);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = "#fff";
    c.lineWidth = 2;
    c.strokeRect(x - 1, y - 1, Math.max(side, cell * f.k * f.s) + 2, side + 2);
  }
  function mapHover(e) {
    const f = MF, d = CV.d;
    if (!f || !d) return;
    const r = $("cMap").getBoundingClientRect(), lonU = f.cx + (e.clientX - r.left - f.W / 2) / (f.k * f.s), lat = f.cy - (e.clientY - r.top - f.H / 2) / f.s, lon = near(lonU, 0), key = Math.floor(lat / d.cell) + "," + Math.floor(lon / d.cell), j = f.cellAt.get(key) ?? -1, hit = j >= 0 && f.tot[j] + f.modis[j] + f.viirs[j] > 0 ? j : -1;
    if (hit !== f.hover) {
      f.hover = hit;
      blit();
    }
    if (hit >= 0) {
      const la = f.la[hit] * d.cell, lo = f.lo[hit] * d.cell, deg = (v, p, n) => `${Math.abs(v).toFixed(2)}\xB0${v < 0 ? n : p}`;
      showTip(
        e,
        `${deg(la, "N", "S")} to ${deg(la + d.cell, "N", "S")}, ${deg(lo, "E", "W")} to ${deg(lo + d.cell, "E", "W")}
${CV.yFrom}\u2013${CV.yTo}: ${nHot(f.tot[hit])} in VIIRS terms
Raw: ${fmt(f.modis[hit])} MODIS (Terra+Aqua), ${fmt(f.viirs[hit])} Suomi NPP`
      );
      return;
    }
    const o = countryAt(lon, lat);
    if (o && o.k !== d.country) showTip(e, o.n);
    else hideTip();
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
    const cv = $("cMap");
    cv.onpointermove = cv.onpointerdown = mapHover;
    cv.onpointerleave = () => {
      if (MF) MF.hover = -1;
      blit();
      hideTip();
    };
    let rt;
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (CV.d && !$("country").hidden) drawMap();
      }, 120);
    });
  }

  // src/views.ts
  function openState(st, fresh) {
    closeCountry();
    stopPlay();
    closeSheet(true);
    S.st = st;
    S.sel = { type: "state" };
    S.show = { t: "all" };
    S.layer = "count";
    V.mask = null;
    V.fineOn = false;
    S.focus = PRESET[st].focus.slice();
    setDraw(false);
    $("hero").hidden = true;
    G.stop && G.stop();
    $("app").hidden = false;
    scrollTo(0, 0);
    $("swap").textContent = "Switch to " + NAME[STS.find((k) => k !== st)];
    $("pal").value = S.pal;
    $("preset").textContent = PRESET[st].name;
    $("lat").value = $("lon").value = "";
    $("townList").innerHTML = hexState(st).towns.map((t) => `<option value="${t.n}">`).join("");
    mapSize();
    const f = fitView(hexState(st));
    V.fit = f.s;
    Object.assign(V, f, { s: f.s * (fresh ? 0.55 : 1) });
    render();
    requestAnimationFrame(() => {
      $("app").classList.add("in");
      if (fresh) flyTo(f, 1100);
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
      k = await loadIndex().then((list) => list.find((c) => slugOf(c.country) === slug)?.country).catch(() => void 0);
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
    if (G.pending === location.hash && G.ok && !$("hero").hidden) {
      G.pending = null;
      G.flyTo({ ry: G.st[st].ry, rx: G.st[st].rx, z: 1.62 }, () => openState(st, true));
    } else {
      G.pending = null;
      openState(st, !$("hero").hidden);
    }
  }

  // src/globe.ts
  var aimAt = (lon, lat, span = 0) => ({
    ry: -((lon + 360) % 360 - 360 + 90) * Math.PI / 180,
    rx: lat * Math.PI / 180,
    z: 1.62 + Math.min(0.9, span / 90)
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
    let fireStats = /* @__PURE__ */ new Map(), fireT0 = 0;
    loadIndex().then((idx) => {
      const L = buildFireLayer(idx);
      if (!L.stats.size) return;
      const ft = new T.CanvasTexture(L.canvas);
      ft.minFilter = T.LinearFilter;
      fireM.map = ft;
      fireM.needsUpdate = true;
      fireMesh.visible = true;
      fireStats = L.stats;
      fireT0 = performance.now();
      showKey(L.lo, L.hi);
      if (hov) tagC.textContent = tagText(hov);
    }).catch(() => {
      $("heroKey").hidden = true;
    });
    const tops = [], RT = 1.05;
    G.st = {};
    for (const st of STS) {
      const topM = new T.MeshBasicMaterial({ color: 16747069, side: T.DoubleSide }), wallM = new T.MeshBasicMaterial({ color: 9387282, side: T.DoubleSide });
      let sum = new T.Vector3(), cnt = 0;
      for (const r of D.globe.plate[st]) {
        const pts = [];
        for (let i = 0; i < r.length - 2; i += 2) pts.push(new T.Vector2(r[i], r[i + 1]));
        const g = new T.ShapeGeometry(new T.Shape(pts)), pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const p = v3(pos.getX(i), pos.getY(i), RT);
          pos.setXYZ(i, p.x, p.y, p.z);
        }
        pos.needsUpdate = true;
        g.computeBoundingSphere();
        const top = new T.Mesh(g, topM);
        top.userData.st = st;
        grp.add(top);
        tops.push(top);
        const w = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length], a0 = v3(a.x, a.y, 1), b0 = v3(b.x, b.y, 1), a1 = v3(a.x, a.y, RT), b1 = v3(b.x, b.y, RT);
          w.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
          sum.add(a1);
          cnt++;
        }
        const wg = new T.BufferGeometry();
        wg.setAttribute("position", new T.Float32BufferAttribute(w, 3));
        grp.add(new T.Mesh(wg, wallM));
      }
      const cen = sum.divideScalar(cnt).normalize(), lat = 90 - Math.acos(cen.y) * 180 / Math.PI, lon = Math.atan2(cen.z, -cen.x) * 180 / Math.PI - 180;
      G.st[st] = {
        topM,
        cen: cen.clone().multiplyScalar(RT + 0.02),
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
      return f ? `${c.n} \xB7 ${short(f.perYear)} fires a year` : c.n;
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
    const base = { ry: 8 * Math.PI / 180, rx: 34 * Math.PI / 180 }, user = { ry: 0, rx: 0 };
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
      if (!G.run) {
        G.run = true;
        last = 0;
        requestAnimationFrame(frame);
      }
    };
    G.stop = () => {
      G.run = false;
    };
    const tmp = new T.Vector3(), col = new T.Color();
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
        grp.rotation.y = base.ry + user.ry + (reduced ? 0 : Math.sin(t * 0.2) * 0.13);
        grp.rotation.x = base.rx + user.rx;
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
        const s = G.st[k], p = 0.5 + 0.5 * Math.sin(t * 2.2 + (k === "CA" ? 1.5 : 0));
        col.setRGB(1, 0.45 + 0.2 * p + (s.hover ? 0.3 : 0), 0.15 + 0.1 * p + (s.hover ? 0.35 : 0));
        s.topM.color.copy(col);
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
        tagC.style.left = (tmp.x * 0.5 + 0.5) * cv.clientWidth + "px";
        tagC.style.top = (-tmp.y * 0.5 + 0.5) * cv.clientHeight + "px";
      }
      ren.setRenderTarget(rt);
      ren.render(scene, cam);
      ren.setRenderTarget(null);
      ren.render(post, pcam);
      requestAnimationFrame(frame);
    }
    addEventListener("resize", size);
    $("heroKey").hidden = false;
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
    $("heroLo").textContent = fmt(lo);
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
    const list = [...STS.map((st) => ({ name: NAME[st], st })), ...WORLD.map((c) => ({ name: c.n, k: c.k }))];
    const fill = () => {
      $("countryList").innerHTML = list.map((f) => f.name).sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("");
    };
    fill();
    let asked = false;
    $("heroFind").onfocus = () => {
      if (asked) return;
      asked = true;
      loadIndex().then((idx) => {
        const have = new Set(WORLD.map((c) => c.k)), extra = idx.filter((c) => !have.has(c.country));
        if (!extra.length) return;
        list.push(...extra.map((c) => ({ name: c.name, k: c.country })));
        fill();
      }).catch(() => asked = false);
    };
    const find = (q) => {
      const f = fold(q);
      if (!f) return null;
      const alias = ALIAS[f];
      return list.find((c) => fold(c.name) === f || "k" in c && fold(c.k) === f) || alias && list.find((c) => "k" in c && c.k === alias) || list.find((c) => fold(c.name).startsWith(f)) || /* a word inside the name, such as "guinea" in "Papua New Guinea"; not single letters or pairs */
      f.length >= 3 && list.find((c) => (" " + fold(c.name)).includes(" " + f)) || null;
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
      const v = fold($("heroFind").value), hit = list.find((c) => fold(c.name) === v);
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
        if (S.layer === "chance") S.show = { t: "all" };
        render();
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
      const d = e.key === "ArrowRight" ? 1 : -1, cur = S.show.t === "year" ? S.show.y : d > 0 ? S.yFrom - 1 : S.yTo + 1;
      setYear(Math.max(S.yFrom, Math.min(S.yTo, cur + d)));
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
    mapEvents();
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
