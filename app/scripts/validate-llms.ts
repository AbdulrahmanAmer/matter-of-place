// Fetches `llms.txt` and `llms-full.txt` from a server and checks the form a model relies on (B13 step 13): a level-one
// heading first, a blockquote summary, sections, absolute `https` links only, the size cap, the truncation line last,
// and the zero-property sentence exactly when no property is listed. Prints `ok <file>` or `fail <file> line <n>:
// <reason>` and exits 1 when a file fails.
// usage: bun run scripts/validate-llms.ts <baseUrl>
// The two values below are those of src/server/seo/llms.ts, repeated because importing that file loads the server
// environment, which a CI step does not have; tests/unit/validate-llms.test.ts fails when they differ.

const MAX_BYTES = 500 * 1024;
const NO_PROPERTIES_SENTENCE = "No properties are published yet.";

const TIMEOUT_MS = 15_000;
const FILES = ["llms.txt", "llms-full.txt"] as const;
const LINK = /\[(?:[^\]\\]|\\.)*\]\(([^)]*)\)/g;
const TRUNCATED =
  /^List truncated: \d+ more (?:entry|entries)\. Every page is listed at https:\/\/\S+\.$/;

const linksOf = (line: string): string[] => [...line.matchAll(LINK)].map((match) => match[1] ?? "");

function isAbsoluteHttps(target: string): boolean {
  try {
    return new URL(target).protocol === "https:";
  } catch {
    return false;
  }
}

const isPropertyLink = (target: string): boolean => {
  try {
    return new URL(target).pathname.startsWith("/property/");
  } catch {
    return false;
  }
};

/**
 * The failures of one document, each `line <n>: <reason>` with the line quoted; an empty list means the document is
 * well formed.
 */
export function validateLlms(text: string): string[] {
  const lines = text.split("\n");
  const problems: string[] = [];
  const fail = (index: number, reason: string): void => {
    const quoted = (lines[index] ?? "").slice(0, 80);
    problems.push(`line ${String(index + 1)}: ${reason}${quoted === "" ? "" : `: ${quoted}`}`);
  };

  if (!/^# \S/.test(lines[0] ?? "")) fail(0, "the first line is not a level-one heading");
  const summary = lines.findIndex((line, index) => index > 0 && line !== "");
  if (!(lines[summary] ?? "").startsWith("> ")) fail(Math.max(summary, 1), "no blockquote summary");
  if (!lines.some((line) => line.startsWith("## "))) fail(0, "no section");

  let inEntry = false;
  lines.forEach((line, index) => {
    if (line.startsWith("## ")) inEntry = false;
    for (const target of linksOf(line)) {
      if (!isAbsoluteHttps(target))
        fail(index, `link is not an absolute https address (${target})`);
    }
    const heading = line.startsWith("### ");
    // The paragraphs under a "###" heading are editorial text and may start with a dash; only a list line needs a link.
    if ((heading || (!inEntry && line.startsWith("- "))) && linksOf(line).length === 0) {
      fail(index, "an entry without a link");
    }
    if (heading) inEntry = true;
  });

  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    fail(lines.length - 1, `the document is over ${String(MAX_BYTES)} bytes`);
  }
  const body = lines.filter((line) => line !== "");
  const lastIndex = lines.lastIndexOf(body.at(-1) ?? "");
  const truncatedAt = lines.findIndex((line) => line.startsWith("List truncated"));
  if (
    truncatedAt >= 0 &&
    (!TRUNCATED.test(lines[truncatedAt] ?? "") || truncatedAt !== lastIndex)
  ) {
    fail(truncatedAt, "the truncation line is malformed or not the last line");
  }
  if (!text.endsWith("\n")) fail(lines.length - 1, "no final line break");

  const start = lines.indexOf("## Properties");
  if (start < 0) {
    if (truncatedAt < 0) fail(0, "no Properties section and no truncation line");
  } else {
    const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
    const section = lines.slice(start + 1, next < 0 ? undefined : next);
    const listed = section.some((line) => linksOf(line).some(isPropertyLink));
    const sentence = section.includes(NO_PROPERTIES_SENTENCE);
    if (listed && sentence) fail(start, "the zero-property sentence beside a listed property");
    if (!listed && !sentence) fail(start, "no property and no zero-property sentence");
  }
  return problems;
}

async function main(args: string[]): Promise<void> {
  const [base] = args;
  if (base === undefined || args.length !== 1) {
    throw new Error("usage: bun run scripts/validate-llms.ts <baseUrl>");
  }
  let failed = false;
  for (const file of FILES) {
    const response = await fetch(`${base.replace(/\/$/, "")}/${file}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const problems =
      response.status === 200
        ? validateLlms(await response.text())
        : [`line 0: ${file} answered ${String(response.status)}`];
    if (problems.length === 0) console.log(`ok ${file}`);
    for (const problem of problems) console.log(`fail ${file} ${problem}`);
    failed ||= problems.length > 0;
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`fail ${error instanceof Error ? error.message : "failed"}`);
    process.exit(1);
  });
}
