// Preloaded by scripts/lhci-pages.mjs (`NODE_OPTIONS=--import=<this file>`) into every node process lhci starts (ruling
// H76). In the Lighthouse CLI only, it copies stderr, which holds Lighthouse's status log, to the file named by
// LHCI_PAGES_TEE: lhci keeps that stderr in memory and prints it only when a run fails, so a run stopped at its bound
// would leave no trace of the step it hung in. Lighthouse's own output is passed on unchanged.
import { appendFileSync } from "node:fs";

const file = process.env["LHCI_PAGES_TEE"] ?? "";
const lighthouse = /lighthouse[\\/]cli[\\/]index\.js$/.test(process.argv[1] ?? "");

if (file !== "" && lighthouse) {
  const stderr = process.stderr;
  const write = stderr.write.bind(stderr);
  /**
   * @param {string | Uint8Array} chunk
   * @param {...unknown} rest the encoding and callback, passed on as given
   * @returns {boolean}
   */
  const tee = (chunk, ...rest) => {
    try {
      appendFileSync(file, chunk);
    } catch {
      // The copy is for reading a hang afterwards; a failed copy must never fail the run.
    }
    return Reflect.apply(write, stderr, [chunk, ...rest]) !== false;
  };
  Object.defineProperty(stderr, "write", { value: tee, writable: true, configurable: true });
}
