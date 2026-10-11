// Domain hygiene (L1, GS-10): the registration outlives the next renewal, the transfer lock is on, the zone is
// delegated to Cloudflare, and with the flags DNSSEC and the HSTS preload are in place. One line per check, `ok` or
// `red`; exit 1 on any red line. RDAP replaces `whois`, which this laptop does not have.
// usage: node scripts/launch/registrar-check.mjs <domain> [--dnssec] [--preload] [--rdap-file <path>]
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";

const USAGE =
  "usage: node scripts/launch/registrar-check.mjs <domain> [--dnssec] [--preload] [--rdap-file <path>]";
const TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;
const MIN_EXPIRY_DAYS = 300;
const MIN_HSTS_SECONDS = 31_536_000;
const TRANSFER_LOCK = "client transfer prohibited";
const CLOUDFLARE_NS = /\.ns\.cloudflare\.com\.$/;

const rdapSchema = z.object({
  status: z.array(z.string()).default([]),
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).default([]),
});
const dohSchema = z.object({
  AD: z.boolean(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).default([]),
});
const preloadSchema = z.object({ errors: z.array(z.object({ code: z.string() })) });

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
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<unknown>}
 */
async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  return response.json();
}

/**
 * @param {string} domain
 * @param {string} type
 */
async function doh(domain, type) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`;
  return dohSchema.parse(await getJson(url, { accept: "application/dns-json" }));
}

/** @param {z.infer<typeof rdapSchema>} rdap */
function checkRdap(rdap) {
  const expiration = rdap.events.find((event) => event.eventAction === "expiration");
  if (expiration === undefined) {
    line("expiry", false, "the RDAP record has no expiration event");
  } else {
    const days = Math.floor((Date.parse(expiration.eventDate) - Date.now()) / DAY_MS);
    line(
      "expiry",
      days >= MIN_EXPIRY_DAYS,
      `${expiration.eventDate}, ${String(days)} days away (at least ${String(MIN_EXPIRY_DAYS)})`,
    );
  }
  line(
    "transfer lock",
    rdap.status.includes(TRANSFER_LOCK),
    rdap.status.includes(TRANSFER_LOCK) ? TRANSFER_LOCK : `status is ${rdap.status.join(", ")}`,
  );
}

/** @param {string} domain */
async function checkNameservers(domain) {
  const servers = (await doh(domain, "NS")).Answer.filter((answer) => answer.type === 2).map(
    (answer) => answer.data,
  );
  line(
    "nameservers",
    servers.length === 2 && servers.every((server) => CLOUDFLARE_NS.test(server)),
    servers.length === 0 ? "no NS answer" : servers.join(" "),
  );
}

/** @param {string} domain */
async function checkDnssec(domain) {
  const ds = await doh(domain, "DS");
  line(
    "DS record",
    ds.Answer.length > 0 && ds.AD,
    `${String(ds.Answer.length)} DS answers, AD ${String(ds.AD)}`,
  );
  const a = await doh(domain, "A");
  line("validated A answer", a.AD, `AD ${String(a.AD)}`);
}

/** @param {string} domain */
async function checkPreload(domain) {
  const response = await fetch(`https://${domain}/`, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const header = response.headers.get("strict-transport-security") ?? "";
  const maxAge = Number(/max-age=(\d+)/i.exec(header)?.[1] ?? "0");
  const tokens = header.split(";").map((token) => token.trim().toLowerCase());
  line(
    "HSTS",
    maxAge >= MIN_HSTS_SECONDS &&
      tokens.includes("includesubdomains") &&
      tokens.includes("preload"),
    header === "" ? "no strict-transport-security header" : header,
  );
  const report = preloadSchema.parse(
    await getJson(
      `https://hstspreload.org/api/v2/preloadable?domain=${encodeURIComponent(domain)}`,
    ),
  );
  line(
    "hstspreload.org",
    report.errors.length === 0,
    report.errors.length === 0 ? "no errors" : report.errors.map((error) => error.code).join(", "),
  );
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      dnssec: { type: "boolean", default: false },
      preload: { type: "boolean", default: false },
      "rdap-file": { type: "string" },
    },
    allowPositionals: true,
  });
  const [domain, ...extra] = positionals;
  if (domain === undefined || extra.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 64;
  }
  const file = values["rdap-file"];
  const rdap = rdapSchema.parse(
    file === undefined
      ? await getJson(`https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(domain)}`)
      : JSON.parse(readFileSync(file, "utf8")),
  );
  checkRdap(rdap);
  await checkNameservers(domain);
  if (values.dnssec) await checkDnssec(domain);
  if (values.preload) await checkPreload(domain);
  process.stdout.write(
    red.length === 0 ? "registrar-check: ok\n" : `registrar-check: red ${red.join("; ")}\n`,
  );
  return red.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
