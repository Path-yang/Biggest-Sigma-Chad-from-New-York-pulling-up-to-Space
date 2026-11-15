import type * as Three from "three";
import type { StateCode, WorldCountry } from "./types";
import { D, STS } from "./data";
import { $, ease, fmt, reduced, short } from "./util";
import { loadIndex } from "./hf";
import { buildFireLayer, fireColour, type FireStat } from "./fireglobe";
import { go, goCountry } from "./views";
import { WORLD, countryAt, cutEdge, lonSpan } from "./world";

interface GlobeState {
  topM: Three.MeshBasicMaterial;
  cen: Three.Vector3;
  ry: number;
  rx: number;
  hover: boolean;
}
/** where a flight ends: the globe's rotation and the camera distance */
export interface Aim {
  ry: number;
  rx: number;
  z: number;
}
/** the handle the rest of the page holds on the globe; the methods exist once globeInit has finished */
interface Globe {
  ok: boolean;
  run: boolean;
  st?: Record<string, GlobeState>;
  hover?: (st: StateCode | null) => void;
  flyTo?: (to: Aim, done: () => void) => void;
  reset?: () => void;
  stop?: () => void;
  /** the address of a place the reader picked on the globe, so route() flies to it before opening it */
  pending?: string | null;
}
/** the rotation that brings lon, lat to the front; span (degrees) is how much of the globe should stay in view */
export const aimAt = (lon: number, lat: number, span = 0): Aim => ({
  ry: (-(((lon + 360) % 360) - 360 + 90) * Math.PI) / 180,
  rx: (lat * Math.PI) / 180,
  z: 1.62 + Math.min(0.9, span / 90),
});
interface Flight {
  to: Aim;
  t0: number;
  from: { ry: number; rx: number; x: number; y: number; z: number };
  done: () => void;
}
interface Spin {
  x: number;
  y: number;
  ry: number;
  rx: number;
  moved: boolean;
}

/* =====================================================================
   GLOBE (three.js), drawn as pixel art: the scene is rendered small, reduced to a short palette
   with ordered dithering, then scaled up with hard edges. The page still works without it.
   ===================================================================== */
export const G: Globe = { ok: false, run: false };
const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
export async function globeInit() {
  if (!window.THREE) throw new Error("three.js did not load");
  const imEarth = await loadImg(D.tex.earth);
  const T = THREE,
    cv = $("globe"),
    ren = new T.WebGLRenderer({ canvas: cv, antialias: false, alpha: false });
  ren.setPixelRatio(1);
  ren.setClearColor(0x000000, 1);
  const scene = new T.Scene(),
    cam = new T.PerspectiveCamera(30, 1, 0.1, 200),
    grp = new T.Group();
  scene.add(grp);
  const v3 = (lon: number, lat: number, r: number) => {
    const p = ((lon + 180) * Math.PI) / 180,
      t = ((90 - lat) * Math.PI) / 180;
    return new T.Vector3(-r * Math.cos(p) * Math.sin(t), r * Math.cos(t), r * Math.sin(p) * Math.sin(t));
  };
  const tex = new T.Texture(imEarth);
  tex.needsUpdate = true;
  grp.add(new T.Mesh(new T.SphereGeometry(1, 96, 64), new T.MeshLambertMaterial({ map: tex })));
  scene.add(new T.AmbientLight(0xffffff, 0.5));
  const sun = new T.DirectionalLight(0xffffff, 1.05);
  sun.position.set(-3, 2.1, 3.6);
  scene.add(sun);
  const halo = new T.Mesh(
    new T.SphereGeometry(1.07, 64, 48),
    new T.ShaderMaterial({
      side: T.BackSide,
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      vertexShader:
        "varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:
        "varying vec3 n;void main(){float f=pow(max(0.0,0.66-dot(n,vec3(0.0,0.0,1.0))),5.0);gl_FragColor=vec4(vec3(0.25,0.5,1.0)*f*2.4,1.0);}",
    }),
  );
  scene.add(halo);
  /* stars: single pixels, a few brighter, drifting slowly */
  const NS = 2600,
    sp = new Float32Array(NS * 3),
    sc3 = new Float32Array(NS * 3),
    ss = new Float32Array(NS),
    sph = new Float32Array(NS),
    d3 = new T.Vector3();
  const PAL = [
    [0.7, 0.78, 1],
    [1, 1, 1],
    [1, 0.95, 0.85],
    [1, 0.8, 0.6],
  ];
  for (let i = 0; i < NS; i++) {
    const a = Math.random() * 6.2832,
      z = 2 * Math.random() - 1,
      q = Math.sqrt(1 - z * z);
    d3.set(q * Math.cos(a), q * Math.sin(a), z);
    sp.set([d3.x * 90, d3.y * 90, d3.z * 90], i * 3);
    const mag = Math.pow(Math.random(), 5),
      lum = 0.35 + 0.65 * mag;
    sc3.set(
      PAL[Math.floor(Math.random() * 4)].map(c => c * lum),
      i * 3,
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
    vertexShader:
      "attribute vec3 col;attribute float size;attribute float ph;uniform float t;varying vec3 c;void main(){c=col*(1.0+0.3*sin(t*(0.6+ph*1.4)+ph*40.0));gl_PointSize=size;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: "varying vec3 c;void main(){gl_FragColor=vec4(c,1.0);}",
  });
  const stars = new T.Points(sg, starMat);
  stars.rotation.set(0.4, 0, 0.2);
  scene.add(stars);
  /* every country tinted by how much it burns, painted once index.json arrives from Hugging Face; fades in */
  const fireM = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    fireMesh = new T.Mesh(new T.SphereGeometry(1.001, 128, 64), fireM);
  fireMesh.visible = false;
  grp.add(fireMesh);
  let fireStats = new Map<string, FireStat>(),
    fireT0 = 0,
    fireLoading = false;
  /** a stalled request must not leave the key on "Loading" for ever; the fetch itself carries on and a retry reuses it */
  const giveUp = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Hugging Face took too long")), ms));
  /** paints the tint once; after a failure the key offers Retry, and coming back to the globe tries again */
  function loadFire() {
    if (fireStats.size || fireLoading) return;
    fireLoading = true;
    $("heroWait").textContent = "Loading every country from Hugging Face…";
    $("heroRetry").hidden = true;
    $("heroKey").hidden = false;
    Promise.race([loadIndex(), giveUp(15000)])
      .then(idx => {
        const L = buildFireLayer(idx);
        if (!L.stats.size) throw new Error("The country index has no fire totals");
        const ft = new T.CanvasTexture(L.canvas);
        ft.minFilter = T.LinearFilter;
        fireM.map = ft;
        fireM.needsUpdate = true;
        fireMesh.visible = true;
        fireStats = L.stats;
        fireT0 = performance.now();
        showKey(L.lo, L.hi);
        if (hov) tagC.textContent = tagText(hov);
      })
      .catch(() => {
        $("heroWait").textContent = "Could not load the fire map from Hugging Face.";
        $("heroRetry").hidden = false;
      })
      .finally(() => (fireLoading = false));
  }
  $("heroRetry").onclick = loadFire;
  loadFire();
  /* the two states with their own pages: flat shapes on the surface that are only drawn while hovered, so the
     globe is coloured by fire everywhere, these two included; hidden shapes still catch the pointer */
  const tops: Three.Mesh[] = [],
    RT = 1.003;
  G.st = {};
  for (const st of STS) {
    const topM = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false });
    topM.visible = false;
    let sum = new T.Vector3(),
      cnt = 0;
    for (const r of D.globe.plate[st]) {
      const pts: Three.Vector2[] = [];
      for (let i = 0; i < r.length - 2; i += 2) pts.push(new T.Vector2(r[i], r[i + 1]));
      const g = new T.ShapeGeometry(new T.Shape(pts)),
        pos = g.attributes.position;
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
      for (const p of pts) {
        sum.add(v3(p.x, p.y, RT));
        cnt++;
      }
    }
    const cen = sum.divideScalar(cnt).normalize(),
      lat = 90 - (Math.acos(cen.y) * 180) / Math.PI,
      lon = (Math.atan2(cen.z, -cen.x) * 180) / Math.PI - 180;
    G.st[st] = {
      topM,
      cen: cen.clone().multiplyScalar(RT + 0.02),
      ry: aimAt(lon, lat).ry,
      rx: aimAt(lon, lat).rx,
      hover: false,
    };
  }
  /* country borders: thin lines just above the surface; long edges are split so they follow the curve */
  const bpos: number[] = [],
    spans = new Map<string, [number, number]>(),
    RB = 1.002;
  for (const c of WORLD) {
    const first = bpos.length / 3;
    for (const r of c.r)
      for (let i = 0; i + 3 < r.length; i += 2) {
        const a0 = r[i],
          b0 = r[i + 1],
          a1 = r[i + 2],
          b1 = r[i + 3];
        if (cutEdge(c.k, a0, b0, a1, b1)) continue;
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(a1 - a0), Math.abs(b1 - b0)) / 1.5));
        for (let j = 0; j < n; j++) {
          const p = v3(a0 + ((a1 - a0) * j) / n, b0 + ((b1 - b0) * j) / n, RB),
            q = v3(a0 + ((a1 - a0) * (j + 1)) / n, b0 + ((b1 - b0) * (j + 1)) / n, RB);
          bpos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
      }
    spans.set(c.k, [first, bpos.length / 3 - first]);
  }
  const bAttr = new T.Float32BufferAttribute(bpos, 3),
    bGeo = new T.BufferGeometry(),
    hlGeo = new T.BufferGeometry();
  bGeo.setAttribute("position", bAttr);
  hlGeo.setAttribute("position", bAttr);
  hlGeo.computeBoundingSphere();
  grp.add(new T.LineSegments(bGeo, new T.LineBasicMaterial({ color: 0x9fb2d0, transparent: true, opacity: 0.5, depthWrite: false })));
  const hlLine = new T.LineSegments(hlGeo, new T.LineBasicMaterial({ color: 0xff8a3d, depthWrite: false }));
  hlLine.visible = false;
  grp.add(hlLine);
  const tagC = $("tagC");
  let hov: WorldCountry | null = null;
  const setHov = (c: WorldCountry | null) => {
    if (c === hov) return;
    hov = c;
    const sp = c && spans.get(c.k);
    hlLine.visible = !!sp && sp[1] > 0;
    if (sp) hlGeo.setDrawRange(sp[0], sp[1]);
    tagC.textContent = c ? tagText(c) : "";
    if (!c) tagC.hidden = true;
  };
  function tagText(c: WorldCountry) {
    const f = fireStats.get(c.k);
    return f ? `${c.n}\n${short(f.perYear)} hotspots a year` : c.n;
  }
  tagC.onclick = () => {
    if (hov) goCountry(hov.k);
  };
  /* the pixel pass */
  const rt = new T.WebGLRenderTarget(4, 4, { minFilter: T.NearestFilter, magFilter: T.NearestFilter }),
    post = new T.Scene(),
    pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pmat = new T.ShaderMaterial({
    uniforms: { tex: { value: rt.texture }, res: { value: new T.Vector2(4, 4) } },
    depthTest: false,
    vertexShader: "varying vec2 u;void main(){u=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
    fragmentShader:
      "uniform sampler2D tex;uniform vec2 res;varying vec2 u;float B2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}void main(){vec3 c=texture2D(tex,u).rgb;float g=dot(c,vec3(0.3,0.59,0.11));c=clamp(mix(vec3(g),c,1.55)*1.18,0.0,1.0);vec2 p=floor(u*res);float d=B2(0.5*p)*0.25+B2(p);c=floor(c*8.0+d*0.7)/8.0;gl_FragColor=vec4(c,1.0);}",
  });
  post.add(new T.Mesh(new T.PlaneGeometry(2, 2), pmat));
  const base = { ry: (8 * Math.PI) / 180, rx: (34 * Math.PI) / 180 },
    user = { ry: 0, rx: 0 };
  let fly: Flight | null = null,
    drag: Spin | null = null,
    off = { x: 0, y: 0 },
    camZ = 4.6,
    last = 0;
  const ray = new T.Raycaster(),
    ndc = new T.Vector2(),
    ball = new T.Sphere(new T.Vector3(), 1),
    hitP = new T.Vector3();
  function size() {
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (!w || !h) return;
    const px = 2,
      lw = Math.ceil(w / px),
      lh = Math.ceil(h / px);
    ren.setSize(lw, lh, false);
    rt.setSize(lw, lh);
    pmat.uniforms.res.value.set(lw, lh);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const wide = w / h > 1.05;
    off = { x: 0, y: wide ? 0.06 : 0.25 };
    camZ = wide ? 4.6 : (4.6 / Math.max(0.45, w / h)) * 1.02;
  }
  const pick = (e: MouseEvent): StateCode | null => {
    const r = cv.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const h = ray.intersectObjects(tops);
    return h.length ? h[0].object.userData.st : null;
  };
  /* small places: many territories are under a pixel on the globe, so each country smaller than SMALL_PX on screen
     can also be picked by its label point, from up to NEAR_PX away over the sea or NEAR_LAND_PX over another country */
  const SMALL_PX = 12,
    NEAR_PX = 12,
    NEAR_LAND_PX = 6,
    sizeDeg = WORLD.map(c => Math.max(lonSpan(c) * Math.cos((c.c[1] * Math.PI) / 180), c.b[3] - c.b[1])),
    lp = new T.Vector3(),
    edge = new T.Vector3();
  const nearestSmall = (e: MouseEvent, maxPx: number): WorldCountry | null => {
    const r = cv.getBoundingClientRect(),
      px = e.clientX - r.left,
      py = e.clientY - r.top;
    /* screen pixels per degree at the middle of the globe */
    lp.copy(grp.position).project(cam);
    edge.set(0, 1, 0).add(grp.position).project(cam);
    const perDeg = ((Math.abs(edge.y - lp.y) * 0.5 * r.height) * Math.PI) / 180;
    let best: WorldCountry | null = null,
      bd = maxPx;
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
  /** the country under the pointer: the ray from pick() meets the unit sphere, turned back into lon, lat; a small
      place whose label point is close enough wins */
  const pickCountry = (e: MouseEvent): WorldCountry | null => {
    ball.center.copy(grp.position);
    if (!ray.ray.intersectSphere(ball, hitP)) return null;
    grp.worldToLocal(hitP);
    const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, hitP.y))) * 180) / Math.PI,
      lon = (((Math.atan2(hitP.z, -hitP.x) * 180) / Math.PI + 360) % 360) - 180,
      under = countryAt(lon, lat);
    return nearestSmall(e, under ? NEAR_LAND_PX : NEAR_PX) || under;
  };
  cv.onpointerdown = e => {
    if (fly) return;
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, ry: user.ry, rx: user.rx, moved: false };
  };
  cv.onpointermove = e => {
    if (drag) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      user.ry = drag.ry + dx * 0.005;
      user.rx = Math.max(-0.9, Math.min(0.9, drag.rx + dy * 0.005));
      return;
    }
    if (fly) return;
    const st = pick(e),
      c = st ? null : pickCountry(e);
    setHov(c);
    for (const k in G.st!) G.st![k].hover = k === st;
    cv.style.cursor = st || c ? "pointer" : "grab";
    document.querySelectorAll<HTMLButtonElement>(".pick").forEach(b => b.classList.toggle("hover", b.dataset.st === st));
  };
  cv.onpointerup = e => {
    const d = drag;
    drag = null;
    if (d && !d.moved) {
      const st = pick(e),
        c = st ? null : pickCountry(e);
      if (st) go(st);
      else if (c) goCountry(c.k);
    }
  };
  cv.onpointerleave = e => {
    if (e.relatedTarget !== tagC) setHov(null);
  };
  G.hover = st => {
    for (const k in G.st!) G.st![k].hover = k === st;
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
      to: { ...to, ry: ry0 + ((((to.ry - ry0) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI },
      t0: performance.now(),
      from: { ry: grp.rotation.y, rx: grp.rotation.x, x: grp.position.x, y: grp.position.y, z: cam.position.z },
      done,
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
  function frame(now: number) {
    if (!G.run) return;
    const t = now / 1000,
      dt = last ? Math.min(0.1, t - last) : 0;
    last = t;
    if (fly) {
      const u = Math.min(1, (now - fly.t0) / 1500),
        e = ease(u),
        f = fly.from,
        s = fly.to;
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
      stars.rotation.x += dt * 0.003;
      starMat.uniforms.t.value = t;
    }
    for (const k in G.st!) {
      const s = G.st![k];
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
      /* kept inside the screen, so a long name near the globe's edge is not cut off on a phone */
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
/** the legend under the globe: the colour scale and the densities at its two ends */
function showKey(lo: number, hi: number) {
  const cv = $("heroRamp"),
    g = cv.getContext("2d")!;
  for (let x = 0; x < cv.width; x++) {
    const f = fireColour(x / (cv.width - 1));
    g.fillStyle = `rgb(${f.c[0]},${f.c[1]},${f.c[2]})`;
    g.fillRect(x, 0, 1, cv.height);
  }
  $("heroLo").textContent = "≤" + fmt(lo);
  $("heroHi").textContent = fmt(hi) + "+";
  $("heroKey").classList.add("ready");
}
