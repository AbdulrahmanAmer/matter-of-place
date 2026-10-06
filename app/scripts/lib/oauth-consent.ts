// What `x-authorize.ts` and `linkedin-authorize.ts` share: the one-shot listener on the redirect address, the code
// exchange, and the storing of the token set. Tokens go to Vault through `store_channel_token` and to the git-ignored
// `.env`, and are never printed.
import { parseArgs } from "node:util";
import { z } from "zod";
import { holdDevLock } from "../../tests/fixtures/dev-lock.ts";
import { sha256Hex, toBase64Url } from "../../src/server/lib/crypto.ts";
import { devDb, type DevDb } from "./dev-db.ts";
import { guardEnv } from "./guard-env.mjs";
import { assertDevTarget, readSecret, setEnvValue } from "./social-script.ts";

export const REDIRECT_URI = "http://127.0.0.1:8765/callback";
const TIMEOUT_MS = 5 * 60_000;

type ConsentChannel = "x" | "linkedin";

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});
const tokenFailure = z.object({ error: z.string().optional() });
const vaultToken = z.object({ refresh_token: z.string() });

export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The S256 code challenge of a PKCE verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await sha256Hex(verifier);
  return toBase64Url(Uint8Array.from(digest.match(/../g) ?? [], (pair) => parseInt(pair, 16)));
}

/** Prints the consent address, waits for the redirect on 127.0.0.1:8765 and returns its `code`. */
export function waitForCode(consent: URL, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 8765,
      fetch(request) {
        const query = new URL(request.url);
        if (query.pathname !== "/callback") return new Response("Not found", { status: 404 });
        const code = query.searchParams.get("code");
        const refused = query.searchParams.get("error");
        if (query.searchParams.get("state") !== state || (code === null && refused === null)) {
          return new Response("This address is not the redirect of the consent.", { status: 400 });
        }
        clearTimeout(timer);
        void server.stop();
        if (code === null) reject(new Error(`consent refused: ${refused ?? "no reason given"}`));
        else resolve(code);
        return new Response("Connected. You can close this tab.");
      },
    });
    const timer = setTimeout(() => {
      void server.stop();
      reject(new Error("consent timed out after 5 minutes"));
    }, TIMEOUT_MS);
    console.log(
      `Open this address in a browser signed in as the account to connect:\n${consent.href}`,
    );
  });
}

interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/** Trades the code at the token endpoint; `headers` carries the client's Basic credentials when the platform wants them. */
export async function exchangeCode(
  endpoint: string,
  form: URLSearchParams,
  headers: Record<string, string> = {},
): Promise<TokenSet> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = tokenFailure.safeParse(body).data?.error ?? response.statusText;
    throw new Error(`token endpoint answered ${String(response.status)}: ${reason}`);
  }
  const { access_token, refresh_token, expires_in } = tokenResponse.parse(body);
  return {
    access_token,
    refresh_token,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
  };
}

/** The sha256 of the refresh token Vault holds now, else of the `.env` seed (`store_channel_token` compares it). */
async function usedRefreshHash(db: DevDb, channel: ConsentChannel): Promise<string> {
  const held = await db.rpc(
    "get_vault_secret",
    { p_name: `${channel}_oauth_token` },
    z.string().nullable(),
  );
  const seed = readSecret(`${channel === "x" ? "X" : "LINKEDIN"}_REFRESH_TOKEN`) ?? "";
  return sha256Hex(held === null ? seed : vaultToken.parse(JSON.parse(held)).refresh_token);
}

/**
 * Stores the token set in Vault (and `ids` through `put_channel_ids`, with a null actor) under the `mop-dev` writer
 * lock, then adds the access and refresh tokens to `.env` for the operator's `bunx supabase secrets set`. Prints `stored`.
 */
export async function saveConsent(
  channel: ConsentChannel,
  set: TokenSet,
  ids?: Record<string, string>,
): Promise<void> {
  const db = devDb();
  const release = await holdDevLock();
  try {
    const result = await db.rpc(
      "store_channel_token",
      {
        p_channel: channel,
        p_used_refresh_sha256: await usedRefreshHash(db, channel),
        p_token_set: set,
      },
      z.enum(["stored", "stale", "busy"]),
    );
    if (result !== "stored") throw new Error(`token not stored: ${result}`);
    if (ids !== undefined) {
      await db.rpc(
        "put_channel_ids",
        {
          p_key: channel,
          p_value: ids,
          p_actor: null,
          p_actor_kind: null,
          p_request_id: `${channel}-authorize`,
        },
        z.unknown(),
      );
    }
  } finally {
    await release();
  }
  const prefix = channel === "x" ? "X" : "LINKEDIN";
  setEnvValue(`${prefix}_ACCESS_TOKEN`, set.access_token);
  setEnvValue(`${prefix}_REFRESH_TOKEN`, set.refresh_token);
  console.log("stored");
}

/** The command line the two authorize scripts share: `--target dev`, `--check`, then `consent` for the consent itself. */
export async function authorize(
  channel: ConsentChannel,
  consent: () => Promise<void>,
): Promise<number> {
  const { values } = parseArgs({
    options: { target: { type: "string" }, check: { type: "boolean" } },
    strict: true,
  });
  guardEnv();
  assertDevTarget(values.target);
  if (values.check === true) {
    // STUB(B10 step 5a): `checkChannelToken` from oauth-tokens.ts makes the read-only call and `record_channel_check` stores it
    console.log(`${channel} check is built with oauth-tokens.ts (step 5a)`);
    return 1;
  }
  await consent();
  return 0;
}
