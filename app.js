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
  function harm(st, i, T, A, V2) {
    const s = D.states[st], m = i % 12;
    if (i >= VI0) return { h: V2, lo: V2, hi: V2, src: "VIIRS observed" };
    const terraOnly = i < AQ0, h = terraOnly ? T * s.r_t[m] : (T + A) * s.r_ta[m], src = terraOnly ? "MODIS Terra, converted" : "MODIS Terra+Aqua, converted";
    if (h === 0) return { h: 0, lo: 0, hi: s.zero_hi, src };
    let b = 0;
    while (b < D.meta.bins.length && h > D.meta.bins[b]) b++;
    return { h, lo: h * s.pi[b][0], hi: h * s.pi[b][1], src };
  }
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
    const ser = [];
    for (let i = (S.yFrom - Y0) * 12; i < (S.yTo - Y0 + 1) * 12; i++)
      ser.push(
        Object.assign({ i, y: Y0 + Math.floor(i / 12), m: i % 12, T: T[i], A: A[i], V: V2[i] }, harm(st, i, T[i], A[i], V2[i]))
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
    for (let y = S.yFrom; y <= S.yTo; y++) {
      const rr = ser.filter((r) => r.y === y), sum = (k) => rr.reduce((a, r) => a + r[k], 0);
      years.push({ y, h: sum("h"), lo: sum("lo"), hi: sum("hi"), naive: rr.reduce((a, r) => a + (r.i >= VI0 ? r.V : r.T + r.A), 0) });
    }
    const total = stats.reduce((a, z) => a + z.sum, 0), order = stats.map((z, m) => ({ m, sum: z.sum })).sort((a, b) => b.sum - a.sum), ranked = years.slice().sort((a, b) => b.h - a.h);
    return { st, ser, stats, years, total, mean: total / years.length, order, ranked };
  }
  function verdict(R) {
    const [fy, fm] = S.focus, f = R.ser.find((r) => r.y === fy && r.m === fm);
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
    return { f, fm, fy, label, cls, rank, n, med, mult: med > 0 ? times(f.h / med) + " a normal " + MON[fm] : fmt(f.h) + " hotspots" };
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
    let n = 0, near = 1e9, c = null, rad = null;
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
        if (d < near) near = d;
      } else if (sel.type === "state" || sel.type === "county" && sn.c[i] === sel.ci || sel.type === "box" && lon >= sel.w && lon <= sel.e && lat >= sel.s && lat <= sel.n)
        n++;
    }
    return { n, near: c ? near : null, rad };
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
  var HATCH = `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#ff8a3d" opacity=".22"/><rect width="2.2" height="5" fill="#ff8a3d"/></pattern></defs>`;
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
    let s = HATCH + grid(W, m, ph, ymax, short, 2);
    vals.forEach((v, i) => {
      const x = m.l + bw * i + 1.5, w = Math.max(1, bw - 3), y = Y(v), cx = x + w / 2;
      s += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(0.5, m.t + ph - y)}" rx="3" fill="${o.fill ? o.fill(i) : "#ff8a3d"}" ${o.sel === i ? 'stroke="#fff" stroke-width="2"' : ""}/>`;
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
    const ymax = niceMax(Math.max(1e-9, ...sers.flatMap((z) => z.v))), X = (i) => m.l + (n === 1 ? pw / 2 : pw * i / (n - 1)), Y = (v) => m.t + ph * (1 - Math.min(1, v / ymax));
    let s = grid(W, m, ph, ymax, fy, 2);
    xs.forEach((x, i) => {
      if (i % Math.ceil(n / (o.every || 7)) === 0) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${x}</text>`;
    });
    if (o.vline >= 0)
      s += `<line x1="${X(o.vline)}" x2="${X(o.vline)}" y1="${m.t}" y2="${m.t + ph}" stroke="#8d98ab" stroke-dasharray="3 3"/><text class="hl" x="${X(o.vline) + 5}" y="${m.t + 10}">VIIRS starts</text>`;
    if (o.base != null)
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.base)}" y2="${Y(o.base)}" stroke="#f1f4f9" stroke-dasharray="4 3"/>`;
    sers.forEach((z) => {
      s += `<path d="M${z.v.map((v, i) => `${X(i)},${Y(v)}`).join("L")}" fill="none" stroke="${z.c}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    if (o.labels) {
      const ends = sers.map((z) => ({ z, y: Y(z.v[n - 1]) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
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
    const lmax = Math.log1p(Math.max(1, ...R.ser.map((r) => r.h))), cmp = !!o.compact;
    el.style.gridTemplateColumns = cmp ? "34px repeat(12,minmax(0,1fr))" : "44px repeat(12,minmax(0,1fr)) 70px";
    let h = `<div></div>` + MON.map((m) => `<div class="h">${cmp ? m[0] : m}</div>`).join("") + (cmp ? "" : `<div class="h" style="text-align:right">Year total</div>`);
    for (let y = S.yTo; y >= S.yFrom; y--) {
      if (y === 2011 && S.yTo >= 2012)
        h += `<div class="split">${cmp ? "converted from MODIS below" : "seen by VIIRS above \xB7 converted from MODIS below"}</div>`;
      h += `<div class="y">${y}</div>`;
      for (let m = 0; m < 12; m++) {
        const r = R.ser[(y - S.yFrom) * 12 + m], c = o.mode === "anom" ? div(Math.log2(r.ratio) / 3) : r.h === 0 ? [22, 28, 40] : seq(0.06 + 0.94 * Math.log1p(r.h) / lmax);
        h += `<button type="button" ${cmp ? 'tabindex="-1"' : ""} class="c${o.focus && S.focus[0] === y && S.focus[1] === m ? " focus" : ""}" data-i="${r.i}" style="background:${rgb(c)};color:${inkOn(c)}" aria-label="${MON[m]} ${y}: ${fmt(r.h)} hotspots">${cmp || r.h === 0 ? "" : short(r.h)}</button>`;
      }
      if (!cmp) h += `<div class="t">${fmt(R.years[y - S.yFrom].h)}</div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll(".c").forEach((b) => {
      const r = R.ser[+b.dataset.i - (S.yFrom - Y0) * 12];
      b.onmousemove = (e) => showTip(
        e,
        `${MONL[r.m]} ${r.y}: ${fmt(r.h)} hotspots
Normal for ${MON[r.m]}: ${fmt(r.med)}
${r.src}` + (r.i < VI0 ? `, likely ${fmt(r.lo)} to ${fmt(r.hi)}` : "")
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
        fill: (i) => xs[i] < 2012 ? "url(#hatch)" : "#ff8a3d",
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
    const s = D.states[S.st], val = s.val, pc = (x) => Math.round(x * 100) + "%";
    $("tiles").innerHTML = `<div class="tile"><b>${val.raw_factor.toFixed(1)}\xD7</b><span>more hotspots from VIIRS than MODIS for the same fires in ${NAME[S.st]}</span></div><div class="tile"><b>${pc(val.annual_med_err)}</b><span>typical error of a converted year, tested on years we could check</span></div><div class="tile"><b>${pc(val.annual_max_err)}</b><span>error in the worst tested year</span></div>`;
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
  async function save(filename, data) {
    const msg = $("dlMsg");
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

  // src/views.ts
  function openState(st, fresh) {
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
      G.pending = st;
      location.hash = SLUG[st];
    }
  }
  function route() {
    const st = STS.find((k) => "#" + SLUG[k] === location.hash);
    if (!st) {
      closeSheet(true);
      openHero();
      if (location.hash === "#compare") openSheet("compare");
      return;
    }
    if (G.pending === st && G.ok && !$("hero").hidden) {
      G.pending = null;
      G.flyTo(st, () => openState(st, true));
    } else {
      G.pending = null;
      openState(st, !$("hero").hidden);
    }
  }

  // src/globe.ts
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
        ry: -((lon + 360) % 360 - 360 + 90) * Math.PI / 180,
        rx: lat * Math.PI / 180,
        hover: false
      };
    }
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
    const ray = new T.Raycaster(), ndc = new T.Vector2();
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
      const st = pick(e);
      for (const k in G.st) G.st[k].hover = k === st;
      cv.style.cursor = st ? "pointer" : "grab";
      document.querySelectorAll(".pick").forEach((b) => b.classList.toggle("hover", b.dataset.st === st));
    };
    cv.onpointerup = (e) => {
      const d = drag;
      drag = null;
      if (d && !d.moved) {
        const st = pick(e);
        if (st) go(st);
      }
    };
    G.hover = (st) => {
      for (const k in G.st) G.st[k].hover = k === st;
    };
    G.flyTo = (st, done) => {
      if (reduced) {
        done();
        return;
      }
      fly = {
        st,
        t0: performance.now(),
        from: { ry: grp.rotation.y, rx: grp.rotation.x, x: grp.position.x, y: grp.position.y, z: cam.position.z },
        done
      };
    };
    G.reset = () => {
      fly = null;
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
        const u = Math.min(1, (now - fly.t0) / 1500), e = ease(u), f = fly.from, s = G.st[fly.st];
        grp.rotation.y = f.ry + (s.ry - f.ry) * e;
        grp.rotation.x = f.rx + (s.rx - f.rx) * e;
        grp.position.x = f.x * (1 - e);
        grp.position.y = f.y * (1 - e);
        cam.position.z = f.z + (1.62 - f.z) * e;
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

  // src/main.ts
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
