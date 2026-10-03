// `bun run fonts`: copies the five Latin WOFF2 files the site and the render templates use from the
// `@fontsource-variable/*` devDependencies into `public/fonts` and writes `public/fonts/LICENSES.md` from the
// packages' own licence texts. Nothing is fetched from Google. Run by hand when a package version changes and commit
// the output in the same commit; no workflow runs it. Exits 1 when a file exceeds the per-file budget.
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(APP, "public", "fonts");
const BUDGET_BYTES = 50 * 1024;

const FAMILIES = [
  {
    name: "Jost",
    pkg: "jost",
    files: ["jost-latin-wght-normal.woff2"],
  },
  {
    name: "Cormorant Garamond",
    pkg: "cormorant-garamond",
    files: [
      "cormorant-garamond-latin-wght-normal.woff2",
      "cormorant-garamond-latin-wght-italic.woff2",
    ],
  },
  { name: "Urbanist", pkg: "urbanist", files: ["urbanist-latin-wght-normal.woff2"] },
  { name: "Epilogue", pkg: "epilogue", files: ["epilogue-latin-wght-normal.woff2"] },
];

/**
 * @param {string} dir package folder
 * @returns {string} the `version` of its package.json
 */
function packageVersion(dir) {
  /** @type {unknown} */
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (
    typeof meta === "object" &&
    meta !== null &&
    "version" in meta &&
    typeof meta.version === "string"
  ) {
    return meta.version;
  }
  throw new Error(`no version in ${dir}/package.json`);
}

mkdirSync(OUT, { recursive: true });

const oversize = [];
const sections = [];
for (const family of FAMILIES) {
  const dir = join(APP, "node_modules", "@fontsource-variable", family.pkg);
  for (const file of family.files) {
    copyFileSync(join(dir, "files", file), join(OUT, file));
    const bytes = statSync(join(OUT, file)).size;
    if (bytes > BUDGET_BYTES) {
      oversize.push(`${file} is ${String(bytes)} bytes, over ${String(BUDGET_BYTES)}`);
    }
    process.stdout.write(`${file} ${String(bytes)}\n`);
  }
  const licence = readFileSync(join(dir, "LICENSE"), "utf8").trim();
  sections.push(
    [
      `## ${family.name}`,
      "",
      `Package \`@fontsource-variable/${family.pkg}\` ${packageVersion(dir)}. Files: ${family.files.join(", ")}.`,
      "",
      licence,
    ].join("\n"),
  );
}

const header = [
  "# Font licences",
  "",
  "The files in this folder are the Latin subsets of the `@fontsource-variable/*` packages, copied unchanged by",
  "`scripts/fonts.mjs`. Each family is licensed under the SIL Open Font License 1.1; the notice of each package follows.",
].join("\n");
writeFileSync(join(OUT, "LICENSES.md"), `${header}\n\n${sections.join("\n\n")}\n`);

if (oversize.length > 0) {
  process.stderr.write(`${oversize.join("\n")}\n`);
  process.exit(1);
}
