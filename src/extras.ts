/* =====================================================================
   THE STATE VIEW'S EXTRA DATA: response.js, forecast.js, outlook.js and
   pop.js (about 0.4 MB compressed) are needed only once New York or California
   opens, so they load then, not with the globe. Raise a file's ?v= here
   when it changes. Each file is optional: one that fails to load leaves
   its tools off, and the rest of the page works.
   ===================================================================== */
const FILES = ["response.js?v=1", "forecast.js?v=3", "outlook.js?v=1", "pop.js?v=1"];
let loading: Promise<void> | null = null;
let ready = false;
/** all four files have loaded or failed */
export const extrasReady = () => ready;
/** start loading the four files (once); resolves when each has loaded or failed */
export function loadExtras(): Promise<void> {
  if (!loading)
    loading = Promise.all(
      FILES.map(
        src =>
          new Promise<void>(done => {
            const el = document.createElement("script");
            el.src = src;
            el.async = true;
            el.addEventListener("load", () => done());
            el.addEventListener("error", () => done());
            document.head.appendChild(el);
          }),
      ),
    ).then(() => {
      ready = true;
    });
  return loading;
}
