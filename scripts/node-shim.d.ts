/* The few Node.js APIs scripts/world_outlook_today.ts uses, so it type-checks without @types/node. */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}
declare const process: { argv: string[]; exit(code: number): never };
