// `node scripts/cf-purge-token.mjs [--check]` (B8b step 4a, F19): mints the narrow Cloudflare token `mop-cache-purge`
// (Cache Purge on the one zone) with the admin token `mop-admin` and writes CF_PURGE_TOKEN and CF_ZONE_ID into the
// repository's `.env`, never to the screen. An existing `mop-cache-purge` is rolled to a new value, not duplicated.
// `--check` asks Cloudflare whether the stored CF_PURGE_TOKEN is active and prints `active` or the refusal.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

const ENV_FILE = fileURLToPath(new URL("../../.env", import.meta.url));
const API = "https://api.cloudflare.com/client/v4";
const TOKEN_NAME = "mop-cache-purge";
const ZONE_NAME = "matterofplace.com";

const envelope = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ message: z.string() })),
  result: z.unknown(),
});

/**
 * One call to Cloudflare's API; the answer's `result`, or an Error naming the refusal (never a token).
 * @param {string} token
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<unknown>}
 */
async function call(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const answer = envelope.parse(await response.json());
  if (!answer.success) {
    const reasons = answer.errors.map((error) => error.message).join("; ");
    throw new Error(`${path}: ${String(response.status)} ${reasons}`);
  }
  return answer.result;
}

/** @returns {Record<string, string | undefined>} */
const readEnv = () => parseEnv(readFileSync(ENV_FILE, "utf8"));

/**
 * Sets each name in `.env`: its line is replaced in place, or appended when absent.
 * @param {Record<string, string>} values
 */
function writeEnv(values) {
  const text = readFileSync(ENV_FILE, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  for (const [name, value] of Object.entries(values)) {
    const at = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (at === -1) lines.push(`${name}=${value}`);
    else lines[at] = `${name}=${value}`;
  }
  writeFileSync(ENV_FILE, lines.join(eol) + eol);
}

/**
 * @param {string} name
 * @returns {string}
 */
function required(name) {
  const value = readEnv()[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set in .env`);
  return value;
}

const status = z.object({ status: z.string() });

/**
 * The state of the token Cloudflare finds behind `token`: `active`, or what it says otherwise.
 * @param {string} token
 * @returns {Promise<string>}
 */
async function verify(token) {
  const result = status.parse(
    await call(token, `/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}/tokens/verify`),
  );
  return result.status;
}

const named = z.array(z.object({ id: z.string(), name: z.string() }));

async function mint() {
  const admin = required("CLOUDFLARE_API_TOKEN");
  const account = `/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}`;
  const zones = named.parse(await call(admin, `/zones?name=${ZONE_NAME}`));
  const zone = zones[0]?.id;
  if (zone === undefined) throw new Error(`no zone named ${ZONE_NAME} on this account`);

  const stored = readEnv()["CF_PURGE_TOKEN"];
  if (stored !== undefined && stored !== "" && readEnv()["CF_ZONE_ID"] === zone) {
    if ((await verify(stored).catch(() => "refused")) === "active") {
      process.stdout.write(`${TOKEN_NAME} is already in .env and active\n`);
      return;
    }
  }

  const existing = named.parse(await call(admin, `${account}/tokens?per_page=50`));
  const found = existing.find((token) => token.name === TOKEN_NAME);
  /** @type {unknown} */
  let value;
  if (found === undefined) {
    const groups = named.parse(await call(admin, `${account}/tokens/permission_groups`));
    const group = groups.find((candidate) => candidate.name === "Cache Purge");
    if (group === undefined) throw new Error("no permission group named Cache Purge");
    const created = await call(admin, `${account}/tokens`, {
      method: "POST",
      body: {
        name: TOKEN_NAME,
        policies: [
          {
            effect: "allow",
            resources: { [`com.cloudflare.api.account.zone.${zone}`]: "*" },
            permission_groups: [{ id: group.id }],
          },
        ],
      },
    });
    value = z.object({ value: z.string() }).parse(created).value;
  } else {
    value = await call(admin, `${account}/tokens/${found.id}/value`, { method: "PUT", body: {} });
  }
  writeEnv({ CF_PURGE_TOKEN: z.string().parse(value), CF_ZONE_ID: zone });
  process.stdout.write(`${TOKEN_NAME} written to .env as CF_PURGE_TOKEN and CF_ZONE_ID\n`);
}

async function check() {
  process.stdout.write(`${await verify(required("CF_PURGE_TOKEN"))}\n`);
}

try {
  if (process.argv[2] === "--check") await check();
  else await mint();
} catch (error) {
  process.stderr.write(`cf-purge-token: ${error instanceof Error ? error.message : "failed"}\n`);
  process.exitCode = 1;
}
