// B5 step 5: sets up the three Resend sending domains of ASSUMED E17 and E18, and changes nothing when they are
// verified. From the app folder: `bun run scripts/resend-domain.ts`. `RESEND_API_KEY` comes from the git-ignored
// root `.env`; `CLOUDFLARE_API_TOKEN` is read from the root `.env.ops` only when a record has to be written (SEC-08).
// Neither value is printed. The free plan holds three domains, so a domain outside `RESEND_DOMAINS` is never added.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";

export const RESEND_DOMAINS = [
  "matterofplace.com",
  "notify.matterofplace.com",
  "notes.matterofplace.com",
] as const;

const REGION = "us-east-1";
const ZONE = RESEND_DOMAINS[0];
const RESEND = "https://api.resend.com";
const CLOUDFLARE = "https://api.cloudflare.com/client/v4";
const USER_AGENT = "matter-of-place/1";
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;
const PAUSE_MS = 300;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface Io {
  fetch: Fetch;
  log: (line: string) => void;
}

const domainSummary = z
  .object({ id: z.string(), name: z.string(), status: z.string() })
  .passthrough();
const domainList = z.object({ data: z.array(domainSummary) }).passthrough();

const dnsRecord = z
  .object({
    record: z.string(),
    name: z.string(),
    type: z.string(),
    value: z.string(),
    status: z.string(),
    priority: z.number().optional(),
  })
  .passthrough();
const domainDetail = domainSummary.extend({ records: z.array(dnsRecord) });

export type DomainDetail = z.infer<typeof domainDetail>;
type DomainRecord = z.infer<typeof dnsRecord>;

const cloudflareList = z
  .object({ result: z.array(z.object({ id: z.string() }).passthrough()) })
  .passthrough();

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** One call. A dropped connection is retried (GOTCHAS P-054); an answer, even a refusal, is never retried. */
async function call(io: Io, url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await io.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
      await sleep(PAUSE_MS * attempt);
    }
  }
}

async function json(io: Io, url: string, init: RequestInit): Promise<unknown> {
  const response = await call(io, url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${new URL(url).pathname}: ${String(response.status)} ${text.slice(0, 200)}`,
    );
  }
  return text === "" ? null : JSON.parse(text);
}

const resendInit = (key: string, method: string, body?: unknown): RequestInit => ({
  method,
  headers: {
    Authorization: `Bearer ${key}`,
    "User-Agent": USER_AGENT,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export async function listDomains(io: Io, key: string): Promise<z.infer<typeof domainSummary>[]> {
  return domainList.parse(await json(io, `${RESEND}/domains`, resendInit(key, "GET"))).data;
}

export async function readDomain(io: Io, key: string, id: string): Promise<DomainDetail> {
  return domainDetail.parse(await json(io, `${RESEND}/domains/${id}`, resendInit(key, "GET")));
}

function readRootFile(file: string, name: string): string | undefined {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return undefined;
  const value = parseEnv(readFileSync(url, "utf8").replaceAll("\r", ""))[name];
  return value === "" ? undefined : value;
}

/** `RESEND_API_KEY` from the shell, else from the root `.env`; undefined when neither holds it. */
export function readResendKey(): string | undefined {
  const fromShell = process.env["RESEND_API_KEY"];
  return fromShell === undefined || fromShell === ""
    ? readRootFile(".env", "RESEND_API_KEY")
    : fromShell;
}

async function upsertRecord(
  io: Io,
  token: string,
  zoneId: string,
  record: DomainRecord,
): Promise<void> {
  if (record.name === "@" || record.name === ZONE) {
    throw new Error(`refusing to write ${record.type} at the apex of ${ZONE}: Zoho holds it`);
  }
  const name = `${record.name}.${ZONE}`;
  const init = (method: string): RequestInit => ({
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: record.type,
      name,
      content: record.value,
      ttl: 1,
      proxied: false,
      ...(record.priority === undefined ? {} : { priority: record.priority }),
    }),
  });
  const records = `${CLOUDFLARE}/zones/${zoneId}/dns_records`;
  const query = new URLSearchParams({ type: record.type, name });
  const found = cloudflareList.parse(
    await json(io, `${records}?${query.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ).result[0];
  await json(
    io,
    found === undefined ? records : `${records}/${found.id}`,
    init(found === undefined ? "POST" : "PUT"),
  );
  io.log(`record ${record.type} ${name} ok`);
}

async function zoneId(io: Io, token: string): Promise<string> {
  const query = new URLSearchParams({ name: ZONE });
  const found = cloudflareList.parse(
    await json(io, `${CLOUDFLARE}/zones?${query.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ).result[0];
  if (found === undefined) throw new Error(`no Cloudflare zone named ${ZONE}`);
  return found.id;
}

export interface SetupKeys {
  resend: string;
  /** Called only when a record has to be written. */
  cloudflare: () => string;
}

/** Brings each of `RESEND_DOMAINS` to verified. A domain that already is makes no call beyond the one list. */
export async function setupDomains(io: Io, keys: SetupKeys): Promise<void> {
  const listed = await listDomains(io, keys.resend);
  for (const name of RESEND_DOMAINS) {
    const known = listed.find((domain) => domain.name === name);
    if (known?.status === "verified") {
      io.log(`domain ${name} verified (no change)`);
      continue;
    }
    const detail =
      known === undefined
        ? domainDetail.parse(
            await json(
              io,
              `${RESEND}/domains`,
              resendInit(keys.resend, "POST", { name, region: REGION }),
            ),
          )
        : await readDomain(io, keys.resend, known.id);
    const token = keys.cloudflare();
    const zone = await zoneId(io, token);
    for (const record of detail.records) await upsertRecord(io, token, zone, record);
    await json(io, `${RESEND}/domains/${detail.id}/verify`, resendInit(keys.resend, "POST"));
    io.log(`domain ${name} verification requested`);
  }
}

function cloudflareToken(): string {
  const token = readRootFile(".env.ops", "CLOUDFLARE_API_TOKEN");
  if (token === undefined) throw new Error("BLOCKED: no CLOUDFLARE_API_TOKEN in .env.ops");
  return token;
}

if (import.meta.main) {
  const resend = readResendKey();
  if (resend === undefined) {
    console.error("BLOCKED: no RESEND_API_KEY");
    process.exitCode = 1;
  } else {
    await setupDomains({ fetch, log: console.log }, { resend, cloudflare: cloudflareToken });
  }
}
