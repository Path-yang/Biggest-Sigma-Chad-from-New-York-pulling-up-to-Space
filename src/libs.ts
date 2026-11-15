/* =====================================================================
   LIBRARIES FOR THE COUNTRY PAGE, fetched the first time a country opens so the globe loads nothing extra.
   Versions are pinned; MapLibre 5 is the last line with a UMD build.
   ===================================================================== */
const MAPLIBRE = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js";
const MAPLIBRE_CSS = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css";
const D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
/* Plot's UMD build reads the d3 global, so it must come after d3 */
const PLOT = "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/dist/plot.umd.min.js";
const FONTS = "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400&display=swap";

function script(src: string): Promise<void> {
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
function style(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

let mapP: Promise<void> | null = null,
  plotP: Promise<void> | null = null;
/** MapLibre GL and its stylesheet; a failed load is forgotten so the next country tries again */
export function loadMapLib(): Promise<void> {
  if (window.maplibregl) return Promise.resolve();
  if (!mapP) {
    style(MAPLIBRE_CSS);
    mapP = script(MAPLIBRE);
    mapP.catch(() => (mapP = null));
  }
  return mapP;
}
/** d3, then Observable Plot */
export function loadPlotLib(): Promise<void> {
  if (window.Plot && window.d3) return Promise.resolve();
  if (!plotP) {
    plotP = (window.d3 ? Promise.resolve() : script(D3)).then(() => (window.Plot ? undefined : script(PLOT)));
    plotP.catch(() => (plotP = null));
  }
  return plotP;
}
/** the page's serif; the sans (Instrument Sans) is already loaded by the globe. The page reads fine in the fallbacks until they arrive */
export const loadFonts = () => style(FONTS);
