// B5 step 9 (GQ-04, invariant 13): every template, drawn with its sample variables, linted and looked at.
//   bun run email:shots
// For each entry of `definitions` it renders the email, runs `lintEmail` and writes out/email-<key>.html; the first
// finding stops the run with exit 1. Then Node (not Bun: see lib/email-shots-page.mjs) opens every file in headless
// Chromium at 600 px and 375 px, requires no sideways scroll, saves out/email-<key>.png and prints
// `ok <key> 600x<height>`. It opens no database and needs no key. The PNG is for a person to read; it is never
// compared pixel by pixel.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sampleVariables } from "../src/domain/email.ts";
import { renderTemplate } from "../src/server/email/render.ts";
import { definitionRow, definitions } from "../src/templates/email/index.ts";
import { lintEmail } from "./lib/email-lint.ts";

const site = {
  siteUrl: "https://matterofplace.com",
  entity: null,
  address: null,
  contact: { email: null },
};

mkdirSync("out", { recursive: true });
const keys: string[] = [];
for (const { definition } of definitions) {
  const { html, text } = await renderTemplate(
    definitionRow(definition),
    sampleVariables(definition.key),
    site,
  );
  const findings = lintEmail(html, text, definition.key);
  if (findings.length > 0) {
    for (const { rule, message } of findings)
      console.error(`${definition.key}: ${rule} ${message}`);
    process.exit(1);
  }
  writeFileSync(`out/email-${definition.key}.html`, html);
  keys.push(definition.key);
}

const page = fileURLToPath(new URL("./lib/email-shots-page.mjs", import.meta.url));
const run = spawnSync("node", [page, ...keys], { stdio: "inherit" });
process.exit(run.status ?? 1);
