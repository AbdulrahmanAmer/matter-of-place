// `node scripts/preview-no-cron.mjs <wrangler.json> <out.json>` (B8b step 5): copies the built Worker config with
// `triggers` set to `{ "crons": [] }` and prints the new `triggers`. The preview job of `deploy.yml` deploys
// `pr-<n>` from that copy, so only `matter-of-place` and `matter-of-place-dev` carry the keep-warm cron.
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

const [source, target, ...extra] = process.argv.slice(2);
if (source === undefined || target === undefined || extra.length > 0) {
  throw new Error("usage: node scripts/preview-no-cron.mjs <wrangler.json> <out.json>");
}

const config = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(source, "utf8")));
config["triggers"] = { crons: [] };
// Written beside the source, so the relative paths inside the config still resolve.
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
console.log(JSON.stringify(config["triggers"]));
