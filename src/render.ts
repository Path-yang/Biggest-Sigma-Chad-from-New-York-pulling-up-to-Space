import { S } from "./state";
import { $ } from "./util";
import { analyseFor, placeName } from "./model";
import { mapDraw, mapValues, selFocus } from "./map";
import { renderCard, renderTimeline } from "./card";
import { renderArea, renderCompare } from "./sheet";

/** redraw everything on screen from the current state */
export function render() {
  document
    .querySelectorAll<HTMLButtonElement>("#modeSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
  document
    .querySelectorAll<HTMLButtonElement>("#layerSeg button")
    .forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layer === S.layer)));
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
