import { $ } from "./util";

/* ---------- tooltip ---------- */
const tip = $("tip");
export function showTip(e: MouseEvent, text: string) {
  tip.textContent = text;
  tip.style.display = "block";
  const w = tip.offsetWidth,
    h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 12)) + "px";
  tip.style.top = Math.max(8, e.clientY - h - 10) + "px";
}
export const hideTip = () => (tip.style.display = "none");
