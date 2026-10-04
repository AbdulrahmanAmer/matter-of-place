import { z } from "zod";

// Proves the edge layer against a running `bunx wrangler dev` (E16, F25 j): the Cache API works there and
// does nothing on workers.dev or in `vite dev`. The first request of each key must be a miss, so start the
// Worker with a fresh `--persist-to` folder. `--media-key <key>` also checks the media route (H33 (4)); the key must
// pass the route's own rule, which starts with a letter or a digit.
// usage: node scripts/cache-proof.mjs <baseUrl> [--media-key <key>]

const USAGE = "usage: node scripts/cache-proof.mjs <baseUrl> [--media-key <key>]";
const TIMEOUT_MS = 20_000;
const POLICY_HEADERS = ["content-security-policy", "content-security-policy-report-only", "link"];
const MEDIA_CONTROL = "public, max-age=31536000, immutable";
const slugs = z.array(z.object({ slug: z.string() }));

/** @typedef {{ status: number, headers: Headers, text: string }} Answer */

/**
 * @param {URL} base
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Answer>}
 */
async function call(base, path, init = {}) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

/** @param {Answer} answer */
const label = (answer) => answer.headers.get("x-mop-cache") ?? "none";

/**
 * @param {string[]} failures
 * @param {string} name
 * @param {boolean} passed
 * @param {string} observed
 */
function check(failures, name, passed, observed) {
  process.stdout.write(`${passed ? "ok  " : "FAIL"} ${name}: ${observed}\n`);
  if (!passed) failures.push(name);
}

/**
 * @param {string[]} failures
 * @param {string} name
 * @param {Answer} answer
 * @param {number} status
 * @param {string} cache
 */
function expectAnswer(failures, name, answer, status, cache) {
  check(
    failures,
    name,
    answer.status === status && label(answer) === cache,
    `${String(answer.status)} ${label(answer)}`,
  );
}

/**
 * The first database read of a cold Worker can pass the 2 second limit and answer 503 (no last good copy exists yet).
 * A path no check below uses warms the connection, so the first request of each key is the miss the proof expects.
 * @param {URL} base
 */
async function warmUp(base) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const answer = await call(base, "/api/public/stories/warm-up");
    process.stdout.write(`warm-up ${String(attempt)}: ${String(answer.status)}\n`);
    if (answer.status !== 503) return;
  }
}

/**
 * @param {URL} base
 * @param {string[]} failures
 */
async function proveJson(base, failures) {
  const path = "/api/public/properties";
  const first = await call(base, path);
  const second = await call(base, path);
  const version = first.headers.get("x-catalog-version");
  expectAnswer(failures, `GET ${path}`, first, 200, "miss");
  expectAnswer(failures, `GET ${path} again`, second, 200, "hit");
  check(
    failures,
    "x-catalog-version is the same on both",
    version !== null && second.headers.get("x-catalog-version") === version,
    `${String(version)} then ${String(second.headers.get("x-catalog-version"))}`,
  );
  for (const query of ["x=1", "x=2"]) {
    expectAnswer(
      failures,
      `GET ${path}?${query}`,
      await call(base, `${path}?${query}`),
      200,
      "hit",
    );
  }
  const etag = first.headers.get("etag");
  const revalidated = await call(base, path, { headers: { "if-none-match": etag ?? "" } });
  check(
    failures,
    "If-None-Match with the returned ETag",
    etag !== null && revalidated.status === 304,
    `${String(revalidated.status)} (etag ${String(etag)})`,
  );
  const missing = `${path}/nope`;
  expectAnswer(failures, `GET ${missing}`, await call(base, missing), 404, "miss");
  expectAnswer(failures, `GET ${missing} again`, await call(base, missing), 404, "hit");
  // An empty batch is refused before the service call (min 1), so no row is written.
  const post = await call(base, "/api/public/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]",
  });
  check(
    failures,
    "POST /api/public/events",
    label(post) === "bypass" && !post.headers.has("x-catalog-version"),
    `${String(post.status)} ${label(post)}, x-catalog-version ${String(post.headers.get("x-catalog-version"))}`,
  );
  return first;
}

/**
 * @param {URL} base
 * @param {string[]} failures
 * @param {Answer} catalog the answer of `/api/public/properties`
 */
async function proveHtml(base, failures, catalog) {
  const first = await call(base, "/");
  const second = await call(base, "/");
  expectAnswer(failures, "GET /", first, 200, "miss");
  expectAnswer(failures, "GET / again", second, 200, "hit");
  for (const name of POLICY_HEADERS) {
    const miss = first.headers.get(name);
    check(
      failures,
      `${name} equal on miss and hit`,
      miss === second.headers.get(name),
      miss === null ? "absent on both" : "present on both",
    );
  }
  // The server render ignores `q`, so the page stored under the `/properties` key is the full list.
  expectAnswer(
    failures,
    "GET /properties?q=zzz",
    await call(base, "/properties?q=zzz"),
    200,
    "miss",
  );
  const list = await call(base, "/properties");
  expectAnswer(failures, "GET /properties after ?q=zzz", list, 200, "hit");
  const cards = slugs.safeParse(JSON.parse(catalog.text));
  if (!cards.success) {
    check(
      failures,
      "the stored /properties page links every slug",
      false,
      "no catalog list to compare",
    );
    return;
  }
  const found = cards.data.map((card) => card.slug);
  const absent = found.filter((slug) => !list.text.includes(`/property/${slug}`));
  check(
    failures,
    "the stored /properties page links every slug",
    found.length > 0 && absent.length === 0,
    `${String(found.length - absent.length)} of ${String(found.length)}${absent.length > 0 ? `, missing ${absent.join(" ")}` : ""}`,
  );
}

/**
 * @param {URL} base
 * @param {string[]} failures
 * @param {string} key
 */
async function proveMedia(base, failures, key) {
  const path = `/media/${key}`;
  const first = await call(base, path);
  const second = await call(base, path);
  const control = first.headers.get("cache-control");
  check(
    failures,
    `GET ${path}`,
    first.status === 200 && label(first) === "miss" && control === MEDIA_CONTROL,
    `${String(first.status)} ${label(first)}, cache-control ${String(control)}`,
  );
  check(
    failures,
    `GET ${path} again`,
    second.status === 200 && label(second) === "hit" && second.text.length === first.text.length,
    `${String(second.status)} ${label(second)}, ${String(second.text.length)} of ${String(first.text.length)} characters`,
  );
  const missing = await call(base, "/media/proof/missing.jpg");
  check(
    failures,
    "GET /media/proof/missing.jpg",
    missing.status === 404 && missing.headers.get("cache-control") === "no-store",
    `${String(missing.status)}, cache-control ${String(missing.headers.get("cache-control"))}`,
  );
}

const args = process.argv.slice(2);
const mediaFlag = args.indexOf("--media-key");
const mediaKey = mediaFlag === -1 ? undefined : args[mediaFlag + 1];
const positional =
  mediaFlag === -1
    ? args
    : args.filter((_arg, index) => index < mediaFlag || index > mediaFlag + 1);
const [baseUrl, ...extra] = positional;
if (
  baseUrl === undefined ||
  extra.length > 0 ||
  !URL.canParse(baseUrl) ||
  (mediaFlag !== -1 && mediaKey === undefined)
) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(2);
}

const base = new URL(baseUrl);
/** @type {string[]} */
const failures = [];
await warmUp(base);
const catalog = await proveJson(base, failures);
await proveHtml(base, failures, catalog);
if (mediaKey !== undefined) await proveMedia(base, failures, mediaKey);
process.stdout.write(
  failures.length === 0
    ? `cache-proof: OK ${base.origin}\n`
    : `cache-proof: FAILED ${String(failures.length)}: ${failures.join("; ")}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
