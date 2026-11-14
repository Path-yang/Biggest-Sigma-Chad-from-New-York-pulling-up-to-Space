import { S } from "./state";
import { $, reduced } from "./util";
import { closeSheet } from "./sheet";
import { render } from "./render";

/* stepping the map through the years, one at a time */
let playT: number | null = null;
export function stopPlay() {
  if (playT) {
    clearInterval(playT);
    playT = null;
  }
  $("playMap").textContent = "▶";
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
  $("playMap").textContent = "■";
  tick();
  playT = setInterval(tick, reduced ? 1300 : 750);
}
export const togglePlay = () => (playT ? stopPlay() : startPlay());
