// The edge-layer proof (L1 step 4h, architecture 13 rules 2 to 6 and 12): reads only response headers and bodies from
// outside, prints one line per check, `ok`, `red` or `skip`, and exits 1 on any red line. The Cache API stores nothing
// in `vite dev`; `--local` is for `bunx wrangler dev` on http://127.0.0.1 (E16), where the HSTS and HTTPS-redirect
// lines are skipped. `--fixture` runs the same checks over a recorded answer set; a check whose answers the set does
// not hold prints `skip`.
// usage: node scripts/launch/verify-cache.mjs <baseUrl> [--local] [--ratio <n>] | --fixture <file> [--ratio <n>]
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parse } from "parse5";
import { z } from "zod";

const USAGE =
  "usage: node scripts/launch/verify-cache.mjs <baseUrl> [--local] [--ratio <n>] | --fixture <file> [--ratio <n>]";
const TIMEOUT_MS = 20_000;
const MIN_RATIO = 0.95;
const PAGES = ["/", "/properties", "/markets", "/california", "/stories", "/about"];
const CATALOG = ["/api/public/properties", "/api/public/markets"];
const DOCUMENTS = ["/sitemap.xml", "/robots.txt", "/llms.txt"];
/** @type {[method: string, path: string][]} */
const NEVER_CACHED = [
  ["GET", "/admin"],
  ["GET", "/api/admin/x"],
  ["GET", "/api/hooks/x"],
  // An empty body is refused by the schema or Turnstile before any database call (B3, B3b).
  ["POST", "/api/public/subscribers"],
];
const PAGE_CONTROL = "public, max-age=0, must-revalidate";
const DOCUMENT_CONTROL = "public, max-age=3600";
const POLICY_HEADERS = ["content-security-policy", "content-security-policy-report-only"];
// The script types a browser runs; a data block (`application/ld+json`) needs no hash.
const EXECUTABLE_TYPES = ["", "module", "text/javascript", "application/javascript"];

const answerSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string()),
  body: z.string().default(""),
});
const fixtureSchema = z.object({
  source: z.string(),
  recorded_at: z.string(),
  answers: z.record(z.array(answerSchema)),
});

/** @typedef {z.infer<typeof answerSchema>} Answer */
/** @typedef {Record<string, Answer[]>} Recorded */

/** @type {string[]} */
const red = [];

/**
 * @param {string} name
 * @param {boolean} passed
 * @param {string} observed
 */
function line(name, passed, observed) {
  process.stdout.write(`${passed ? "ok " : "red"}  ${name}: ${observed}\n`);
  if (!passed) red.push(name);
}

/**
 * @param {string} name
 * @param {string} why
 */
const skip = (name, why) => {
  process.stdout.write(`skip ${name}: skipped (${why})\n`);
};

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Answer>}
 */
async function call(url, init = {}) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}

/** @param {Answer | undefined} answer */
const label = (answer) => answer?.headers["x-mop-cache"] ?? "none";

/**
 * Every `/assets/` file the stored home page links, by `src` or `href`.
 * @param {string} html
 * @returns {string[]}
 */
const assetLinks = (html) => [
  ...new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1] ?? ""),
  ),
];

/**
 * @param {URL} base
 * @param {number} ratio requests of the ratio pass, 0 for none
 * @param {boolean} local
 * @returns {Promise<Recorded>}
 */
async function record(base, ratio, local) {
  const at = (/** @type {string} */ path) => new URL(path, base).href;
  /** @type {Recorded} */
  const answers = {};
  const twice = async (/** @type {string} */ key, /** @type {string} */ url, init = {}) => {
    answers[key] = [await call(url, init), await call(url, init)];
  };
  for (const path of PAGES) await twice(`page ${path}`, at(path));
  answers["again /"] = [await call(at("/"))];
  answers["query /"] = [await call(at(`/?cachebust=${randomUUID()}`))];
  answers["cookie /"] = [await call(at("/"), { headers: { cookie: "mop_probe=1" } })];
  for (const path of CATALOG) await twice(`json ${path}`, at(path));
  for (const path of DOCUMENTS) await twice(`doc ${path}`, at(path));
  await twice("missing", at(`/__mop-missing-${randomUUID()}`));
  for (const [method, path] of NEVER_CACHED) {
    await twice(`never ${method} ${path}`, at(path), { method });
  }
  for (const path of assetLinks(answers["page /"]?.[1]?.body ?? "")) {
    answers[`asset ${path}`] = [await call(at(path))];
  }
  if (!local) answers["http"] = [await call(`http://${base.host}/`)];
  if (ratio > 0) {
    const urls = [...PAGES, ...CATALOG].map(at);
    for (const url of urls) await call(url);
    /** @type {Answer[]} */
    const pass = [];
    for (let index = 0; index < ratio; index += 1) {
      pass.push(await call(urls[index % urls.length] ?? at("/")));
    }
    answers["ratio"] = pass;
  }
  return answers;
}

/**
 * The text of each executable inline script, as the parser reads it (the hash covers that text, not the bytes).
 * @param {string} html
 * @returns {string[]}
 */
function inlineScripts(html) {
  /** @type {string[]} */
  const found = [];
  /** @param {import("parse5").DefaultTreeAdapterMap["node"]} node */
  const visit = (node) => {
    if ("tagName" in node && node.tagName === "script") {
      const type = node.attrs.find((attr) => attr.name === "type")?.value.toLowerCase() ?? "";
      if (!node.attrs.some((attr) => attr.name === "src") && EXECUTABLE_TYPES.includes(type)) {
        found.push(node.childNodes.map((child) => ("value" in child ? child.value : "")).join(""));
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  return found;
}

/**
 * The one policy header an answer carries, or a reason it does not have exactly one.
 * @param {Answer} answer
 * @returns {{ name: string, value: string } | string}
 */
function policyOf(answer) {
  const present = POLICY_HEADERS.filter((name) => answer.headers[name] !== undefined);
  const [name] = present;
  if (present.length !== 1 || name === undefined) {
    return present.length === 0 ? "no Content-Security-Policy header" : "both policy headers";
  }
  return { name, value: answer.headers[name] ?? "" };
}

/**
 * The policy faults of one page: exactly one header on both answers, byte-identical, covering every inline script.
 * @param {Answer} first
 * @param {Answer} second
 * @returns {string[]}
 */
function policyFaults(first, second) {
  const built = policyOf(first);
  const stored = policyOf(second);
  if (typeof stored === "string") return [`${label(second)} answer: ${stored}`];
  if (typeof built === "string") return [`${label(first)} answer: ${built}`];
  /** @type {string[]} */
  const faults = [];
  if (built.name !== stored.name || built.value !== stored.value) {
    faults.push(`${label(first)} and ${label(second)} policies differ`);
  }
  for (const code of inlineScripts(second.body)) {
    const hash = `'sha256-${createHash("sha256").update(code).digest("base64")}'`;
    if (!stored.value.includes(hash)) faults.push(`inline script ${hash} not in the policy`);
  }
  return faults;
}

/**
 * A line over every recorded key of `keys`, each judged alone; skipped when none of them is recorded.
 * @param {Recorded} answers
 * @param {string} name
 * @param {string[]} keys
 * @param {(key: string, set: Answer[]) => string | undefined} fault the fault of one key, undefined when it is fine
 * @param {string} okText
 */
function verifyEach(answers, name, keys, fault, okText) {
  const present = keys.filter((key) => answers[key] !== undefined);
  if (present.length === 0) {
    skip(name, "not in fixture");
    return;
  }
  const faults = present.flatMap((key) => fault(key, answers[key] ?? []) ?? []);
  line(name, faults.length === 0, faults.length === 0 ? okText : faults.join("; "));
}

/**
 * A line that needs every key of `keys`; skipped when one of them is not recorded.
 * @param {Recorded} answers
 * @param {string} name
 * @param {string[]} keys
 * @param {(sets: Answer[][]) => string | undefined} fault the fault, undefined when the line is ok
 * @param {string} okText
 */
function verifyAll(answers, name, keys, fault, okText) {
  const sets = keys.map((key) => answers[key]);
  if (sets.some((set) => set === undefined)) {
    skip(name, "not in fixture");
    return;
  }
  const found = fault(sets.map((set) => set ?? []));
  line(name, found === undefined, found ?? okText);
}

/** @param {Answer | undefined} answer */
const controlOf = (answer) => String(answer?.headers["cache-control"]);

/**
 * @param {Recorded} answers
 * @param {{ local: boolean, ratio: number }} options
 */
function checkAll(answers, { local, ratio }) {
  const pages = PAGES.map((path) => `page ${path}`);
  const catalog = CATALOG.map((path) => `json ${path}`);
  // B13 stores robots.txt only for the indexable host; a local Worker answers the closed rules uncached, on purpose.
  const documents = DOCUMENTS.filter((path) => !(local && path === "/robots.txt")).map(
    (path) => `doc ${path}`,
  );
  const never = NEVER_CACHED.map(([method, path]) => `never ${method} ${path}`);
  const assets = Object.keys(answers).filter((key) => key.startsWith("asset "));
  /** @type {(key: string, set: Answer[]) => string | undefined} */
  const secondIsHit = (key, [, second]) =>
    label(second) === "hit" ? undefined : `${key} second answer ${label(second)}`;

  verifyEach(answers, "pages hit", pages, secondIsHit, "the second answer of each page is a hit");
  verifyEach(answers, "catalog hit", catalog, secondIsHit, "the second answer of each is a hit");
  verifyEach(
    answers,
    "catalog version",
    [...pages, ...catalog],
    (key, [first, second]) => {
      const version = first?.headers["x-catalog-version"];
      return version !== undefined && second?.headers["x-catalog-version"] === version
        ? undefined
        : `${key} ${String(version)} then ${String(second?.headers["x-catalog-version"])}`;
    },
    "equal on both answers",
  );
  verifyEach(
    answers,
    "page cache-control",
    pages,
    (key, set) =>
      set.every((answer) => answer.headers["cache-control"] === PAGE_CONTROL)
        ? undefined
        : `${key} ${set.map(controlOf).join(" then ")}`,
    PAGE_CONTROL,
  );
  verifyEach(
    answers,
    "query and cookie keep the key",
    ["query /", "cookie /"],
    (key, [answer]) => (label(answer) === "hit" ? undefined : `${key} ${label(answer)}`),
    "both hit",
  );
  verifyEach(
    answers,
    "no cookie",
    [...pages, ...catalog, ...documents],
    (key, set) =>
      set.some((answer) => answer.headers["set-cookie"] !== undefined)
        ? `${key} carries Set-Cookie`
        : undefined,
    "no Set-Cookie on a public answer",
  );
  verifyAll(
    answers,
    "request id per hit",
    ["page /", "again /"],
    ([home = [], again = []]) => {
      const first = home[1]?.headers["x-request-id"];
      const second = again[0]?.headers["x-request-id"];
      return first !== undefined && second !== undefined && first !== second
        ? undefined
        : `x-request-id ${String(first)} then ${String(second)}`;
    },
    "differs between two hits",
  );
  if (local) skip("HSTS on hits", "local http");
  else {
    verifyAll(
      answers,
      "HSTS on hits",
      ["page /", "again /"],
      ([home = [], again = []]) =>
        [home[1], again[0]].every(
          (answer) => answer?.headers["strict-transport-security"] !== undefined,
        )
          ? undefined
          : "strict-transport-security missing on a hit",
      "present on both",
    );
  }
  verifyEach(
    answers,
    "documents cached one hour",
    documents,
    (key, [first, second]) =>
      label(second) === "hit" && first?.headers["cache-control"] === DOCUMENT_CONTROL
        ? undefined
        : `${key} ${label(second)}, cache-control ${controlOf(first)}`,
    DOCUMENT_CONTROL,
  );
  if (local) skip("robots.txt cached one hour", "local host is not indexable, B13");
  verifyAll(
    answers,
    "missing page cached 60 s",
    ["missing"],
    ([missing = []]) => {
      const [first, second] = missing;
      return first?.status === 404 &&
        first.headers["cache-control"]?.includes("s-maxage=60") === true &&
        label(second) === "hit"
        ? undefined
        : `${String(first?.status)} cache-control ${controlOf(first)}, then ${label(second)}`;
    },
    "404, s-maxage=60, then hit",
  );
  verifyEach(
    answers,
    "policy",
    pages,
    (key, [first, second]) => {
      const faults =
        first === undefined || second === undefined
          ? ["needs two answers"]
          : policyFaults(first, second);
      return faults.length === 0 ? undefined : `${key} ${faults.join(", ")}`;
    },
    "one header per page, identical on both answers, every inline script hashed",
  );
  verifyEach(
    answers,
    "never cached",
    never,
    (key, set) =>
      set.every(
        (answer) => answer.headers["cache-control"] === "no-store" && label(answer) !== "hit",
      )
        ? undefined
        : `${key} ${set.map((answer) => `${controlOf(answer)} ${label(answer)}`).join(" then ")}`,
    "no-store, never hit",
  );
  if (answers["page /"] === undefined) skip("assets immutable", "not in fixture");
  else if (assets.length === 0)
    line("assets immutable", false, "the stored / links no /assets/ file");
  else {
    verifyEach(
      answers,
      "assets immutable",
      assets,
      (key, [answer]) =>
        answer?.status === 200 && answer.headers["cache-control"]?.includes("immutable") === true
          ? undefined
          : `${key} ${String(answer?.status)} ${controlOf(answer)}`,
      `${String(assets.length)} files, 200 and immutable`,
    );
  }
  if (local) skip("HTTPS redirect", "local http");
  else {
    verifyAll(
      answers,
      "HTTPS redirect",
      ["http"],
      ([http = []]) => {
        const [answer] = http;
        return answer !== undefined &&
          [301, 308].includes(answer.status) &&
          answer.headers["location"]?.startsWith("https://") === true
          ? undefined
          : `${String(answer?.status)} location ${String(answer?.headers["location"])}`;
      },
      "http answers a redirect to https",
    );
  }
  if (ratio > 0) {
    verifyAll(
      answers,
      "hit ratio",
      ["ratio"],
      ([pass = []]) => {
        const hits = pass.filter((answer) => label(answer) === "hit").length;
        return pass.length > 0 && hits / pass.length >= MIN_RATIO
          ? undefined
          : `${String(hits)} of ${String(pass.length)} hit, under ${String(MIN_RATIO * 100)} percent`;
      },
      `${String(MIN_RATIO * 100)} percent or better`,
    );
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      local: { type: "boolean", default: false },
      ratio: { type: "string" },
      fixture: { type: "string" },
    },
    allowPositionals: true,
  });
  const ratio = values.ratio === undefined ? 0 : Number(values.ratio);
  const [baseUrl, ...extra] = positionals;
  const fixture = values.fixture;
  const usable =
    Number.isInteger(ratio) &&
    ratio >= 0 &&
    extra.length === 0 &&
    (fixture === undefined
      ? baseUrl !== undefined && URL.canParse(baseUrl)
      : baseUrl === undefined);
  if (!usable) {
    process.stderr.write(`${USAGE}\n`);
    return 64;
  }
  const answers =
    fixture === undefined
      ? await record(new URL(baseUrl ?? ""), ratio, values.local)
      : fixtureSchema.parse(JSON.parse(readFileSync(fixture, "utf8"))).answers;
  checkAll(answers, { local: values.local, ratio });
  process.stdout.write(
    red.length === 0 ? "verify-cache: ok\n" : `verify-cache: red ${red.join("; ")}\n`,
  );
  return red.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
