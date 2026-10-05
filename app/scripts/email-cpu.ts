// `bun run scripts/email-cpu.ts` (B5 step 3): renders every definition 50 times through `renderTemplate` with its sample
// variables and prints the p95 per key and overall, in milliseconds. A Worker request has 10 ms of CPU on the free
// plan (P-009), and `previewTemplate` renders inside one, so an overall p95 above 8 ms exits 1: the signal to make
// `previewTemplate` return the resolved blocks and let the browser draw them. It is an in-process wall-clock timing on
// the laptop, a proxy for Worker CPU. It runs React in its development build, which is slower than the production build
// the Worker bundles, so the figure errs on the high side.
import { sampleVariables } from "../src/domain/email.ts";
import { definitionRow, definitions } from "../src/templates/email/index.ts";
import { renderTemplate } from "../src/server/email/render.ts";

const RUNS = 50;
const LIMIT_MS = 8;
const site = {
  siteUrl: "https://matterofplace.com",
  entity: null,
  address: null,
  contact: { email: null },
};

const p95 = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
};

async function timeOnce(index: number): Promise<number> {
  const file = definitions[index];
  if (file === undefined) throw new Error(`no definition at ${String(index)}`);
  const started = performance.now();
  await renderTemplate(definitionRow(file.definition), sampleVariables(file.definition.key), site);
  return performance.now() - started;
}

// One untimed render first, so the first key is not charged for the module's first run.
await timeOnce(0);
const all: number[] = [];
for (const [index, file] of definitions.entries()) {
  const samples: number[] = [];
  for (let run = 0; run < RUNS; run += 1) samples.push(await timeOnce(index));
  all.push(...samples);
  console.log(`p95 ${p95(samples).toFixed(2)} ${file.definition.key}`);
}
const overall = p95(all);
console.log(`p95 ${overall.toFixed(2)} overall`);
process.exitCode = overall > LIMIT_MS ? 1 : 0;
