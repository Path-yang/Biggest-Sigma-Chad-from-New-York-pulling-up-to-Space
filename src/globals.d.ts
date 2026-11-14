import type * as Three from "three";
import type { BurnData } from "./types";

declare global {
  /** three.js r128, loaded from a script tag in index.html. Absent if that request fails. */
  const THREE: typeof Three;
  interface Window {
    /** set by data.js */
    BURN_DATA: BurnData;
    THREE?: typeof Three;
    /** present only when the page runs inside a Claude artifact preview */
    claude?: {
      use(capability: string): Promise<{ save(file: { filename: string; data: string }): Promise<unknown> } | null | undefined>;
    };
  }
}

export {};
