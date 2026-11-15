/* HotSpotters copilot: the chat window, its result cards, and what it does to the map.
   Talks to the FireCopilot agent over a WebSocket (protocol described in src/index.js).
   Uses the page's own functions from app.js: S, map, setArea, setLayer, MONTHS. */
"use strict";

const Copilot = (() => {
  const TONES = ["#ff8a3d", "#5aa9e6", "#c9a3ff", "#7fd1ae"], WATCH = { high: "#ff5a3d", elevated: "#ffb347" };
  const HOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "hotspotters.compare" : location.host;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const num = n => Math.round(n).toLocaleString("en-US");
  const packs = new Map();
  const hasMap = () => typeof map !== "undefined" && map && typeof map.getSource === "function" && map.isStyleLoaded !== undefined;
  let ws = null, ready = null, session = null, busy = false, turn = null, root, log, input, sendBtn, opened = false, pending = null;

  /* ------------------------------------------------------------ connection */
  function sessionId(fresh) {
    try { if (!fresh) session = sessionStorage.getItem("cp-session"); } catch { /* private window */ }
    if (!session || fresh) { session = "c" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { sessionStorage.setItem("cp-session", session); } catch { /* fine */ } }
    return session;
  }
  function connect(fresh) {
    if (ws && ws.readyState <= 1 && !fresh) return ready;
    if (ws) { ws.onclose = null; ws.close(); }
    ready = new Promise((resolve, reject) => {
      ws = new WebSocket(`wss://${HOST}/agents/fire-copilot/${sessionId(fresh)}`);
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type === "hello") { restore(m.transcript || []); resolve(); } else onEvent(m); };
      ws.onerror = () => reject(new Error("offline"));
      ws.onclose = () => { if (busy) finish("The connection dropped. Please ask again."); ws = null; };
    });
    return ready;
  }

  /* -------------------------------------------------------------- the map */
  function ensureLayers() {
    if (map.getSource("cp")) return;
    map.addSource("cp", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "cp-fill", type: "fill", source: "cp", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } }, "sel-fill");
    map.addLayer({ id: "cp-line", type: "line", source: "cp", paint: { "line-color": ["get", "color"], "line-width": 2 } }, "sel-fill");
    map.on("click", "cp-fill", e => { const p = e.features[0].properties; if (p.name) toast(`${p.name}${p.note ? " · " + p.note : ""}`); });
  }
  const setShapes = feats => { if (hasMap()) { ensureLayers(); map.getSource("cp").setData({ type: "FeatureCollection", features: feats }); } };
  const clearMap = () => { if (hasMap() && map.getSource("cp")) setShapes([]); };
  function toast(text) {
    const t = document.getElementById("mapToast");
    t.innerHTML = `<span class="cp-pulse"></span>${esc(text)}`; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 4200);
  }
  const fit = (b, maxZoom = 8) => map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 70, left: 60, right: 60, bottom: opened && innerWidth > 900 && !root.classList.contains("wide") ? Math.min(root.offsetHeight + 30, map.getContainer().offsetHeight - 180) : 60 }, duration: 1100, maxZoom });
  async function loadPack(path) {
    if (!packs.has(path)) packs.set(path, fetch("data/" + path).then(r => r.ok ? r.json() : null));
    return packs.get(path);
  }
  async function outlineOf(p) {
    if (p.g) return p.g;
    const pk = p.pack && await loadPack(p.pack);
    if (!pk) return null;
    return pk.id === p.id ? pk.g : ((pk.children || []).find(c => c.id === p.id) || {}).g || null;
  }
  /** Make a place the selected area, so the side panel shows its calendar. */
  async function selectPlace(p, fly) {
    if (!p || p.keep) return;
    if (p.id === "world") { setArea(null); if (fly) map.flyTo({ center: [15, 12], zoom: 1.6 }); return; }
    const g = await outlineOf(p);
    if (!g || !p.series) { if (fly && p.b) fit(p.b); return; }
    await setArea({ kind: "region", id: p.id, name: p.name, label: p.label, level: p.level, w: p.b[0], s: p.b[1], e: p.b[2], n: p.b[3], g, series: p.series }, p.name, false);
    if (fly) fit(p.b);
  }
  async function act(a) {
    if (!hasMap()) return;
    clearMap();
    if (a.toast) toast(a.toast);
    if (a.type === "goto") {
      await selectPlace(a.place, true);
      if (a.year != null) setLayer(a.year, a.month == null ? -1 : a.month);
    } else if (a.type === "outline") {
      const feats = [], bounds = [180, 90, -180, -90];
      for (let i = 0; i < a.places.length; i++) {
        const p = a.places[i], g = await outlineOf(p);
        if (!g) continue;
        feats.push({ type: "Feature", geometry: g, properties: { color: TONES[i % 4], fill: 0.12, name: p.name } });
        bounds[0] = Math.min(bounds[0], p.b[0]); bounds[1] = Math.min(bounds[1], p.b[1]); bounds[2] = Math.max(bounds[2], p.b[2]); bounds[3] = Math.max(bounds[3], p.b[3]);
      }
      setShapes(feats);
      if (feats.length) fit(bounds, 7);
      if (a.year) setLayer(a.year, a.month == null ? -1 : a.month);
    } else if (a.type === "mark") {
      const feats = [];
      for (const p of a.places) { const g = await outlineOf(p); if (g) feats.push({ type: "Feature", geometry: g, properties: { color: "#ff8a3d", fill: 0.22, name: p.name } }); }
      setShapes(feats);
      const b = a.focus ? a.focus.b : a.places.reduce((u, p) => [Math.min(u[0], p.b[0]), Math.min(u[1], p.b[1]), Math.max(u[2], p.b[2]), Math.max(u[3], p.b[3])], [180, 90, -180, -90]);
      if (b && b[0] <= b[2]) fit(b, 8);
      if (a.year) setLayer(a.year, a.month == null ? -1 : a.month);
    } else if (a.type === "highlight") {
      const pk = await loadPack(a.pack), byId = new Map(((pk && pk.children) || []).map(c => [c.id, c]));
      setShapes(a.items.map(it => byId.get(it.id) && ({ type: "Feature", geometry: byId.get(it.id).g,
        properties: { color: WATCH[it.watch] || "#ffb347", fill: it.watch === "high" ? 0.42 : 0.2, name: it.name, note: `${it.watch} watch, about ${num(it.expected)} hotspots expected` } })).filter(Boolean));
      if (a.parent && a.parent.b) fit(a.parent.b, 7);
      if (a.year) setLayer(a.year, a.month);
    }
  }
  /** Open a place from a shared link (#place=USA.6.19). */
  async function openPlace(id) {
    open(); await connect().catch(() => {});
    ask(`Show me ${id}`, true);
  }

  /* ---------------------------------------------------------------- cards */
  function barsSvg(c) {
    const W = 340, H = 104, x0 = 4, x1 = W - 4, y0 = 8, y1 = H - 20, vals = c.values.map(v => v == null ? 0 : v), n = vals.length;
    const max = Math.max(1, ...vals, ...(c.ref || []), c.refLine || 0), bw = (x1 - x0) / n, hi = new Set(c.highlight || []);
    let g = "";
    vals.forEach((v, i) => {
      const h = Math.max(v > 0 ? 1.5 : 0, v / max * (y1 - y0)), x = x0 + i * bw + bw * 0.14;
      g += `<rect x="${x.toFixed(1)}" y="${(y1 - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${hi.has(i) ? "#ff8a3d" : "#4b5366"}" opacity="${c.values[i] == null ? 0 : 1}" data-tip="<b>${esc(c.labels[i])}: ${c.values[i] == null ? "no data" : num(v)}</b>${c.ref ? `<div class='m'>${esc(c.refLabel || "usual")}: ${num(c.ref[i])}</div>` : ""}"/>`;
      if (c.ref) { const y = y1 - c.ref[i] / max * (y1 - y0); g += `<line x1="${(x - 1).toFixed(1)}" x2="${(x + bw * 0.72 + 1).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e9ebf1" stroke-width="1.5"/>`; }
    });
    if (c.refLine != null) { const y = y1 - c.refLine / max * (y1 - y0); g += `<line x1="${x0}" x2="${x1}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e9ebf1" stroke-width="1" stroke-dasharray="4 3" opacity="0.8"/>`; }
    const lab = i => `<text x="${(x0 + (i + 0.5) * bw).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="${hi.has(i) ? "hi" : ""}">${esc(n === 12 ? c.labels[i][0] : c.labels[i])}</text>`;
    if (n === 12) for (let i = 0; i < n; i++) g += lab(i);
    else {                                                        // label the highlighted bars first, then the ends, skipping any that would collide
      const placed = [];
      for (const i of [...hi, 0, n - 1]) if (!placed.some(j => Math.abs(j - i) * bw < 30)) { placed.push(i); g += lab(i); }
    }
    const key = c.ref || c.refLine != null ? `<span class="cp-key"><i class="ln"></i>${esc(c.refLabel || "usual")}</span>` : "";
    return `<div class="cp-charthead"><span>${esc(c.title || "")}</span>${key}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title || "chart")}">${g}</svg>`;
  }
  function linesSvg(c) {
    const W = 340, H = 120, x0 = 6, x1 = W - 6, y0 = 8, y1 = H - 20, n = c.labels.length;
    const max = Math.max(1, ...c.series.flatMap(s => s.values.map(v => v || 0)));
    const X = i => x0 + (i + 0.5) * (x1 - x0) / n, Y = v => y1 - v / max * (y1 - y0);
    let g = `<line x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" stroke="#2a3040"/>`, legend = "";
    c.series.forEach(s => {
      const ref = s.tone === "ref", col = ref ? "#8791a6" : TONES[s.tone % 4];
      let seg = [], path = "";
      s.values.forEach((v, i) => { if (v == null) { if (seg.length > 1) path += `<polyline points="${seg.join(" ")}"/>`; seg = []; } else seg.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`); });
      if (seg.length > 1) path += `<polyline points="${seg.join(" ")}"/>`;
      g += `<g fill="none" stroke="${col}" stroke-width="${ref ? 1.5 : 2.2}"${ref ? ' stroke-dasharray="4 3"' : ""}>${path}</g>`;
      if (!ref) s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="transparent" data-tip="<b>${esc(s.name)}, ${esc(c.labels[i])}: ${num(v)}</b>"/>`; });
      legend += `<span class="cp-key"><i style="background:${col}"></i>${esc(s.name)}</span>`;
    });
    c.labels.forEach((l, i) => g += `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l[0])}</text>`);
    return `<div class="cp-charthead"><span>${esc(c.title || "")}</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title || "chart")}">${g}</svg><div class="cp-legend">${legend}</div>`;
  }
  function spark(vals) {
    const max = Math.max(1, ...vals), w = 5, gap = 2;
    return `<svg class="cp-spark" viewBox="0 0 ${vals.length * (w + gap)} 22" aria-hidden="true">${vals.map((v, i) => { const h = Math.max(v > 0 ? 1.5 : 0.6, v / max * 20); return `<rect x="${i * (w + gap)}" y="${22 - h}" width="${w}" height="${h}" rx="1" fill="${i >= vals.length - 3 ? "#ff8a3d" : "#5b6477"}"/>`; }).join("")}</svg>`;
  }
  function cardEl(c) {
    const card = el("article", `cp-card cp-${c.kind}`);
    let h = `<header><div><div class="cp-eyebrow">${esc(c.eyebrow)}</div><h4>${esc(c.title)}</h4></div>${c.badge ? `<span class="cp-badge ${c.badge.cls}">${esc(c.badge.text)}</span>` : ""}</header>`;
    if (c.big) h += `<div class="cp-big"><b>${esc(c.big.value)}</b><span>${esc(c.big.caption)}</span></div>`;
    if (c.chart) h += `<div class="cp-chart">${c.chart.type === "lines" ? linesSvg(c.chart) : barsSvg(c.chart)}</div>`;
    if (c.table) h += `<table class="cp-table"><thead><tr>${c.table.head.map((x, i) => `<th>${i && !c.table.plain ? `<i style="background:${TONES[(i - 1) % 4]}"></i>` : ""}${esc(x)}</th>`).join("")}</tr></thead><tbody>${c.table.rows.map((r, k) => `<tr>${r.map((x, i) => i ? `<td>${esc(x)}</td>` : `<th>${c.table.plain ? `<span class="n">${k + 1}</span>` : ""}${esc(x)}</th>`).join("")}</tr>`).join("")}</tbody></table>`;
    if (c.rank) h += `<div class="cp-ranktitle">${esc(c.rank.title)}</div><ol class="cp-rank">${c.rank.items.map((it, i) => `<li><button data-i="${i}" title="Show ${esc(it.name)} on the map"><span class="n">${i + 1}</span><span class="who"><b>${esc(it.name)}</b><small>${esc(it.sub || "")}</small></span>${it.spark ? spark(it.spark) : ""}<span class="val"><b>${esc(it.value)}</b><span class="cp-badge ${it.chip.cls}">${esc(it.chip.text)}</span></span></button></li>`).join("")}</ol>`;
    if (c.rows && c.rows.length) h += `<dl class="cp-rows">${c.rows.map(r => `<div><dt>${esc(r.k)}</dt><dd class="${r.cls || ""}">${esc(r.v)}</dd></div>`).join("")}</dl>`;
    if (c.foot) h += `<p class="cp-foot">${esc(c.foot)}</p>`;
    if (c.go) h += `<button class="cp-go">Show on map</button>`;
    card.innerHTML = h;
    if (c.go) card.querySelector(".cp-go").onclick = () => act({ type: "goto", ...c.go, toast: `${c.go.place.name}` });
    card.querySelectorAll(".cp-rank button").forEach(b => b.onclick = () => { const it = c.rank.items[+b.dataset.i]; if (it.b) { fit(it.b, 9); toast(it.name); } });
    return card;
  }
  function chips(list, cls) {
    const box = el("div", "cp-chips " + (cls || ""));
    list.forEach(q => { const b = el("button", "", esc(q)); b.onclick = () => ask(q); box.appendChild(b); });
    return box;
  }
  /** Small, safe subset of Markdown: bold, lists, paragraphs. */
  function prose(text) {
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split(/\n/), out = [];
    let list = null;
    for (const raw of lines) {
      const line = raw.trim(), m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) { if (!list) { list = []; out.push(list); } list.push(m[1]); continue; }
      list = null;
      if (line) out.push(line);
    }
    return out.map(x => Array.isArray(x) ? `<ul>${x.map(i => `<li>${i}</li>`).join("")}</ul>` : `<p>${x}</p>`).join("");
  }

  /* ------------------------------------------------------------- the chat */
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  function welcome() {
    const box = el("div", "cp-welcome");
    box.innerHTML = `<div class="cp-mark big"></div><h3>Ask about fire, anywhere</h3><p>I read 26 years of satellite fire detections and answer in plain language. I can move the map for you, compare places and years, and point out where to watch.</p>`;
    const here = S.bbox ? [`What was the worst year in this area?`, `How does this area look right now?`] : [];
    box.appendChild(chips([...here, "How was Los Angeles County in January 2025?", "Which counties in California should I watch in July 2027?", "Compare Jalandhar and West Bengal",
      "Was 2025 unusual for Colorado?", "How many people live in the watch counties of California in August?", "What is a hotspot, and where does the data come from?"]));
    return box;
  }
  function restore(items) {
    log.innerHTML = "";
    if (!items.length) { log.appendChild(welcome()); return; }
    for (const it of items) {
      if (it.role === "user") log.appendChild(el("div", "cp-msg user", `<p>${esc(it.text)}</p>`));
      else { const m = el("div", "cp-msg bot"); (it.cards || []).forEach(c => m.appendChild(cardEl(c))); m.appendChild(el("div", "cp-text", prose(it.text))); log.appendChild(m); if (it.choices && it === items[items.length - 1]) log.appendChild(chips(it.choices, "follow answer")); }
    }
    scroll();
  }
  function setBusy(b) { busy = b; sendBtn.disabled = b; root.classList.toggle("busy", b); }
  function context() {
    const b = S.bbox, c = map.getCenter(), mb = map.getBounds(), r = x => Math.round(x * 100) / 100;
    const sel = !b ? null : b.kind === "region" ? { kind: "region", id: b.id, name: b.name, label: b.label }
      : { kind: "custom", name: S.name, bbox: [r(b.w), r(b.s), r(b.e), r(b.n)], series: S.agg ? Array.from(S.agg.H, x => Math.round(x * 10) / 10) : null };
    return { selection: sel, layer: S.layer, view: { lat: r(c.lat), lon: r(c.lng), zoom: r(map.getZoom()),
      bbox: [r(Math.max(-180, mb.getWest())), r(Math.max(-85, mb.getSouth())), r(Math.min(180, mb.getEast())), r(Math.min(85, mb.getNorth()))] } };
  }
  function ask(text, quiet) {
    text = String(text || "").trim();
    if (!text) return Promise.resolve({ error: "No question." });
    if (busy) return Promise.resolve({ error: "Still answering the previous question." });
    const done = new Promise(res => { pending = res; });
    send(text, quiet);
    return done;
  }
  async function send(text, quiet) {
    const w = log.querySelector(".cp-welcome"); if (w) w.remove();
    log.querySelectorAll(".cp-chips.follow").forEach(x => x.remove());
    if (quiet === true && voice) { /* the spoken words are already shown */ } else if (!quiet) log.appendChild(el("div", "cp-msg user", `<p>${esc(text)}</p>`));
    const box = el("div", "cp-msg bot");
    turn = { box, status: el("div", "cp-status", `<span class="cp-dots"><i></i><i></i><i></i></span><span class="t">Connecting</span>`), cards: el("div", "cp-cards"), text: el("div", "cp-text"), raw: "", suggest: [] };
    box.append(turn.status, turn.cards, turn.text); log.appendChild(box); scroll();
    input.value = ""; input.style.height = ""; setBusy(true);
    try { await connect(); ws.send(JSON.stringify({ type: "chat", text, context: context() })); }
    catch { finish("I can't reach the copilot right now. Check your connection and try again."); }
  }
  function onEvent(m) {
    if (!turn) return;
    if (m.type === "status") turn.status.querySelector(".t").textContent = m.text;
    else if (m.type === "card") { turn.cards.appendChild(cardEl(m.card)); if (m.card.suggest) turn.suggest.push(...m.card.suggest); scroll(); }
    else if (m.type === "action") act(m.action).catch(console.error);
    else if (m.type === "delta") { turn.raw += m.text; turn.status.hidden = true; turn.text.innerHTML = prose(turn.raw); scroll(); }
    else if (m.type === "choices") turn.choices = m.options;
    else if (m.type === "retract") { turn.raw = ""; turn.text.innerHTML = ""; turn.status.hidden = false; }
    else if (m.type === "error") finish(m.message);
    else if (m.type === "done") finish();
  }
  function finish(error) {
    if (!turn) return;
    turn.status.remove();
    if (pending) { pending(error ? { error } : { text: turn.raw }); pending = null; }
    if (error) turn.box.appendChild(el("div", "cp-error", esc(error)));
    else if (turn.choices && turn.choices.length) log.appendChild(chips(turn.choices, "follow answer"));
    else if (turn.suggest.length) log.appendChild(chips(turn.suggest.slice(0, 3), "follow"));
    turn = null; setBusy(false); scroll();
    if (opened && innerWidth > 900) input.focus();
  }

  /* ------------------------------------------------- dragging the window */
  // Drag the header to move the chat window anywhere over the map; double-click the header to put it back.
  let pos = null;                                                // { left, top } in px within the map area, or null for the default spot
  try { pos = JSON.parse(sessionStorage.getItem("cp-pos")) || null; } catch { pos = null; }
  function applyPos() {
    const st = root.style;
    if (!pos || root.classList.contains("wide") || innerWidth <= 900) { st.left = st.top = st.bottom = st.transform = st.maxHeight = ""; root.classList.remove("moved"); return; }
    const box = root.parentElement.getBoundingClientRect(), w = root.offsetWidth;
    pos.left = Math.max(8, Math.min(box.width - w - 8, pos.left)); pos.top = Math.max(8, Math.min(box.height - 160, pos.top));
    st.left = pos.left + "px"; st.top = pos.top + "px"; st.bottom = "auto"; st.transform = "none";
    st.maxHeight = Math.max(240, box.height - pos.top - 16) + "px";
    root.classList.add("moved");
  }
  function initDrag() {
    const head = root.querySelector(".cp-head");
    let start = null;
    head.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button") || root.classList.contains("wide") || innerWidth <= 900) return;
      const r = root.getBoundingClientRect(), box = root.parentElement.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left - box.left, top: r.top - box.top };
      head.setPointerCapture(e.pointerId); root.classList.add("dragging"); e.preventDefault();
    });
    head.addEventListener("pointermove", e => {
      if (!start) return;
      pos = { left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y };
      applyPos();
    });
    const end = () => {
      if (!start) return;
      start = null; root.classList.remove("dragging");
      try { sessionStorage.setItem("cp-pos", JSON.stringify(pos)); } catch { /* fine */ }
    };
    head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
    head.addEventListener("dblclick", e => {
      if (e.target.closest("button")) return;
      pos = null; try { sessionStorage.removeItem("cp-pos"); } catch { /* fine */ }
      applyPos();
    });
    window.addEventListener("resize", applyPos);
  }

  /* ---------------------------------------------------------- big view */
  let backdrop;
  function setWide(on) {
    root.classList.toggle("wide", on); backdrop.hidden = !on; applyPos();
    const b = root.querySelector("#cpWide"); b.setAttribute("aria-pressed", on); b.title = on ? "Back to the side" : "Expand"; b.ariaLabel = on ? "Shrink the copilot" : "Expand the copilot";
    scroll();
  }

  /* ---------------------------------------------------------------- voice */
  // OpenAI Realtime over WebRTC. The voice model calls ask_hotspotters, which this page answers by
  // asking the DeepSeek copilot (so cards and map moves happen as for typed questions).
  let voice = null;
  const vstate = t => { const s = root.querySelector("#cpVState"); s.textContent = t; root.querySelector("#cpVoice").dataset.state = t.split(" ")[0].toLowerCase(); };
  async function voiceStart() {
    if (voice) return;
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return note("Voice needs a browser with microphone support.");
    const bar = root.querySelector("#cpVoice"), mic = root.querySelector("#cpMic");
    bar.hidden = false; mic.classList.add("on"); vstate("Connecting");
    const v = voice = { pc: new RTCPeerConnection(), audio: new Audio(), stream: null, dc: null };
    v.audio.autoplay = true;
    try {
      v.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (voice !== v) return v.stream.getTracks().forEach(t => t.stop());
      const res = await fetch("/api/voice/session", { method: "POST" }), tok = await res.json();
      if (!res.ok || !tok.key) throw new Error(tok.error || "Voice could not start.");
      v.pc.ontrack = e => { v.audio.srcObject = e.streams[0]; };
      v.stream.getTracks().forEach(t => v.pc.addTrack(t, v.stream));
      v.dc = v.pc.createDataChannel("oai-events");
      v.dc.onmessage = e => { try { onRealtime(JSON.parse(e.data), v); } catch (err) { console.error(err); } };
      v.dc.onopen = () => vstate("Listening");
      v.pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(v.pc.connectionState) && voice === v) { voiceStop(); note("The voice connection dropped."); } };
      const offer = await v.pc.createOffer();
      await v.pc.setLocalDescription(offer);
      const sdp = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", body: offer.sdp, headers: { authorization: `Bearer ${tok.key}`, "content-type": "application/sdp" } });
      if (!sdp.ok) throw new Error("The voice service did not answer.");
      await v.pc.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
    } catch (err) {
      voiceStop();
      note(err && err.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser to use voice." : (err && err.message) || "Voice could not start.");
    }
  }
  function voiceStop() {
    const v = voice; voice = null;
    root.querySelector("#cpVoice").hidden = true; root.querySelector("#cpMic").classList.remove("on");
    if (!v) return;
    try { v.dc && v.dc.close(); } catch { /* closed */ }
    try { v.pc.close(); } catch { /* closed */ }
    if (v.stream) v.stream.getTracks().forEach(t => t.stop());
    v.audio.srcObject = null;
  }
  function note(text) { log.appendChild(el("div", "cp-error", esc(text))); scroll(); }
  async function onRealtime(ev, v) {
    if (voice !== v) return;
    if (ev.type === "input_audio_buffer.speech_started") vstate("Listening");
    else if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.transcript && ev.transcript.trim()) {
      const w = log.querySelector(".cp-welcome"); if (w) w.remove();
      log.appendChild(el("div", "cp-msg user voice", `<p><span class="cp-said" aria-label="Said">Said</span>${esc(ev.transcript.trim())}</p>`)); scroll();
    } else if (ev.type === "output_audio_buffer.started") vstate("Speaking");
    else if (ev.type === "output_audio_buffer.stopped" || ev.type === "output_audio_buffer.cleared") vstate("Listening");
    else if (ev.type === "error") console.error("realtime", ev.error);
    else if (ev.type === "response.done") {
      for (const item of (ev.response && ev.response.output) || []) {
        if (item.type !== "function_call" || item.name !== "ask_hotspotters") continue;
        let q = ""; try { q = JSON.parse(item.arguments || "{}").question || ""; } catch { /* empty */ }
        vstate("Checking the record");
        const r = await ask(q, true);
        if (voice !== v) return;
        v.dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: item.call_id,
          output: JSON.stringify(r.error ? { error: r.error } : { answer: r.text, on_screen: "Result cards and the map now show the details." }) } }));
        v.dc.send(JSON.stringify({ type: "response.create" }));
      }
    }
  }

  /* --------------------------------------------------------------- window */
  function open() {
    if (!root) return;
    opened = true; root.classList.add("open"); applyPos(); if (!pos) root.classList.add("anim"); root.addEventListener("animationend", () => root.classList.remove("anim"), { once: true }); document.getElementById("cpLaunch").hidden = true; document.getElementById("mapwrap").classList.add("cp-open");
    connect().catch(() => {});
    if (innerWidth > 900) setTimeout(() => input.focus(), 150);
  }
  function close() { opened = false; root.classList.remove("open"); document.getElementById("cpLaunch").hidden = false; document.getElementById("mapwrap").classList.remove("cp-open"); }
  function init() {
    const wrap = document.getElementById("mapwrap");
    const launch = el("button", "", `<span class="cp-mark"></span><span class="cp-ltext">Ask Copilot about any place...</span><span class="cp-lmic" title="Talk to the copilot"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg></span>`);
    launch.id = "cpLaunch"; launch.title = "Ask questions about fire activity";
    launch.onclick = e => { open(); if (e.target.closest(".cp-lmic")) voiceStart(); };
    root = el("section", "", `
      <header class="cp-head">
        <div class="cp-mark"></div>
        <div class="cp-title"><b>Copilot</b><span>Ask about fire anywhere, any time since 2000</span></div>
        <button id="cpNew" class="ghost small" title="Start a new conversation">New chat</button>
        <button id="cpWide" class="xbtn" title="Expand" aria-label="Expand the copilot" aria-pressed="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path class="grow" d="M11.5 4H16v4.5M8.5 16H4v-4.5M16 4l-5 5M4 16l5-5"/><path class="shrink" d="M15.5 9H11V4.5M4.5 11H9v4.5M11 9l5-5M9 11l-5 5"/></svg></button>
        <button id="cpClose" class="xbtn" aria-label="Close the copilot"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg></button>
      </header>
      <div class="cp-log" id="cpLog" aria-live="polite"></div>
      <div class="cp-voicebar" id="cpVoice" hidden>
        <span class="cp-orb"><i></i></span>
        <span class="cp-vstate" id="cpVState">Connecting</span>
        <span class="cp-vhint">Speak naturally. Answers also appear here and on the map.</span>
        <button type="button" id="cpVEnd" class="ghost small">End voice</button>
      </div>
      <form class="cp-form" id="cpForm">
        <button type="button" id="cpMic" class="cp-mic" title="Talk to the copilot" aria-label="Start voice"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/></svg></button>
        <textarea id="cpInput" rows="1" placeholder="Ask about a place, a month, a year..." aria-label="Your question" maxlength="600"></textarea>
        <button id="cpSend" class="primary" aria-label="Send"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h12M11 5.5l4.5 4.5-4.5 4.5"/></svg></button>
      </form>`);
    root.id = "copilot"; root.setAttribute("aria-label", "Copilot");
    wrap.append(launch, root);
    log = root.querySelector("#cpLog"); input = root.querySelector("#cpInput"); sendBtn = root.querySelector("#cpSend");
    log.appendChild(welcome());
    root.querySelector("#cpClose").onclick = () => { setWide(false); voiceStop(); close(); };
    initDrag();
    root.querySelector("#cpWide").onclick = () => setWide(!root.classList.contains("wide"));
    root.querySelector("#cpMic").onclick = () => voice ? voiceStop() : voiceStart();
    root.querySelector("#cpVEnd").onclick = voiceStop;
    backdrop = el("div"); backdrop.id = "cpBackdrop"; backdrop.hidden = true; backdrop.onclick = () => setWide(false); document.body.appendChild(backdrop);
    window.addEventListener("keydown", e => { if (e.key === "Escape" && root.classList.contains("wide")) { e.stopImmediatePropagation(); setWide(false); } }, true);
    root.querySelector("#cpNew").onclick = () => { if (busy) return; clearMap(); log.innerHTML = ""; log.appendChild(welcome()); connect(true).catch(() => {}); };
    root.querySelector("#cpForm").onsubmit = e => { e.preventDefault(); ask(input.value); };
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); } e.stopPropagation(); });
    input.addEventListener("input", () => { input.style.height = ""; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
  }
  document.addEventListener("DOMContentLoaded", init);
  return { open, close, ask, clearMap, openPlace, voiceStart, voiceStop, setWide, get voice() { return voice; } };
})();
window.Copilot = Copilot;
