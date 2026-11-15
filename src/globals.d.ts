import type * as Three from "three";
import type { BurnData, World } from "./types";

declare global {
  /** three.js r128, loaded from a script tag in index.html. Absent if that request fails. */
  const THREE: typeof Three;
  interface Window {
    /** set by data.js */
    BURN_DATA: BurnData;
    /** set by world.js; absent if that file did not load */
    WORLD?: World;
    THREE?: typeof Three;
    /* the country page's libraries, loaded on demand by libs.ts (MapLibre GL 5.24.0, d3 7.9.0, Observable Plot
       0.6.17); typed loosely because their type packages are not installed */
    maplibregl?: any;
    Plot?: any;
    d3?: any;
    /** present only when the page runs inside a Claude artifact preview */
    claude?: {
      use(capability: string): Promise<{ save(file: { filename: string; data: string }): Promise<unknown> } | null | undefined>;
    };
  }
}

export {};
