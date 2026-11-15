import type { CalendarMode, Layer, Palette, SheetTab, StateCode } from "./types";
import { MON, MONL, NAME, PRESET, SLUG, STS, Y0, Y1 } from "./data";
import { S } from "./state";
import { $ } from "./util";
import { hexState } from "./model";
import { V, centerOn, fitView, mapDraw, mapEvents, mapSize, selBounds, setDraw, tileProbe, zoomSel } from "./map";
import { closeSheet, openSheet } from "./sheet";
import { stopPlay, togglePlay } from "./play";
import { csvCal, csvHot } from "./downloads";
import { render } from "./render";
import { G, globeInit } from "./globe";
import { go, route } from "./views";

function init() {
  const yo: string[] = [];
  for (let y = Y0; y <= Y1; y++) yo.push(`<option>${y}</option>`);
  $("yFrom").innerHTML = $("yTo").innerHTML = $("fY").innerHTML = yo.join("");
  $("yFrom").value = String(Y0);
  $("yTo").value = String(Y1);
  $("fM").innerHTML = MON.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("yFrom").onchange = $("yTo").onchange = e => {
    let a = +$("yFrom").value,
      b = +$("yTo").value;
    if (a > b) {
      if ((e.target as HTMLElement).id === "yFrom") b = a;
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
  $("pal").onchange = e => {
    S.pal = (e.target as HTMLSelectElement).value as Palette;
    render();
  };
  $("rmMap").innerHTML = $("rmSheet").innerHTML = MONL.map((m, i) => `<option value="${i}">${m}</option>`).join("");
  $("rmMap").onchange = $("rmSheet").onchange = e => {
    S.rm = +(e.target as HTMLSelectElement).value;
    render();
  };
  document.querySelectorAll<HTMLButtonElement>("#layerSeg button").forEach(
    b =>
      (b.onclick = () => {
        stopPlay();
        S.layer = b.dataset.layer as Layer;
        if (S.layer === "chance") S.show = { t: "all" };
        render();
      }),
  );
  $("town").onchange = e => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    if (!q) return;
    const ts = hexState(S.st!).towns,
      t = ts.find(t => t.n.toLowerCase() === q) || ts.find(t => t.n.toLowerCase().startsWith(q));
    if (!t) {
      $("hint").textContent = `No town or city called "${(e.target as HTMLInputElement).value}" in ${NAME[S.st!]}.`;
      return;
    }
    (e.target as HTMLInputElement).value = "";
    S.sel = { type: "circle", lat: t.lat, lon: t.lon, rad: 15, label: t.n };
    render();
    centerOn(t.lon, t.lat, 2400);
  };
  tileProbe();
  $("drawBtn").onclick = () => setDraw(!S.draw);
  $("stnChk").onchange = e => {
    S.stn = (e.target as HTMLInputElement).checked;
    mapDraw();
  };
  const tr = $("tlTrack");
  let tlDrag = false;
  const yearAt = (e: MouseEvent) => {
    const r = tr.getBoundingClientRect(),
      n = S.yTo - S.yFrom + 1;
    return S.yFrom + Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const setYear = (y: number) => {
    stopPlay();
    if (S.layer === "count" && S.show.t === "year" && S.show.y === y) return;
    S.layer = "count";
    S.show = { t: "year", y };
    render();
  };
  tr.onpointerdown = e => {
    tr.setPointerCapture(e.pointerId);
    tlDrag = true;
    setYear(yearAt(e));
  };
  tr.onpointermove = e => {
    if (tlDrag) setYear(yearAt(e));
  };
  tr.onpointerup = tr.onpointercancel = () => {
    tlDrag = false;
  };
  tr.onkeydown = e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowRight" ? 1 : -1,
      cur = S.show.t === "year" ? S.show.y : d > 0 ? S.yFrom - 1 : S.yTo + 1;
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
    location.hash = SLUG[STS.find(k => k !== S.st)!];
  };
  $("openData").onclick = () => openSheet("area");
  $("openCmp").onclick = () => openSheet("compare");
  $("heroCmp").onclick = () => {
    location.hash = "compare";
  };
  $("shClose").onclick = $("scrim").onclick = () => closeSheet();
  $("seeMap").onclick = () => closeSheet();
  addEventListener("keydown", e => {
    if (e.key === "Escape" && S.sheet) closeSheet();
  });
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach(b => (b.onclick = () => openSheet(b.dataset.tab as SheetTab)));
  const usePt = (lat: number, lon: number, rad: number) => {
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
    const p = PRESET[S.st!];
    $("lat").value = String(p.lat);
    $("lon").value = String(p.lon);
    $("rad").value = String(p.rad);
    S.focus = p.focus.slice();
    S.show = { t: "ym", y: p.focus[0], m: p.focus[1] };
    usePt(p.lat, p.lon, p.rad);
  };
  document.querySelectorAll<HTMLButtonElement>("#modeSeg button").forEach(
    b =>
      (b.onclick = () => {
        S.mode = b.dataset.mode as CalendarMode;
        render();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>(".pick,.tag").forEach(b => {
    b.onclick = () => go(b.dataset.st as StateCode);
    b.onmouseenter = () => G.hover && G.hover(b.dataset.st as StateCode);
    b.onmouseleave = () => G.hover && G.hover(null);
  });
  $("dlCal").onclick = csvCal;
  $("dlHot").onclick = csvHot;
  mapEvents();
  let rt: number | undefined;
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
