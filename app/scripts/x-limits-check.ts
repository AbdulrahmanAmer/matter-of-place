// B10 step 3a: measures what the X free tier allows, once, from the test handle. `bun run scripts/x-limits-check.ts
// --i-mean-it [--target dev]` uploads one test image, posts once, reads that post back and reads the handle's recent
// posts, and prints the rate-limit headers of each answer. `--record <monthly post reads>` stores `read_allowance` and
// `metrics_days` in `settings.x` instead and posts nothing. The calls are ASSUMED until this script has run
// (docs/runbooks/social.md); it is never an enable check (invariant 11, INT-08).
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { devDb } from "./lib/dev-db.ts";
import { guardEnv } from "./lib/guard-env.mjs";
import { assertDevTarget, requireSecret, runScript } from "./lib/social-script.ts";

const API = "https://api.x.com/2";
const LIMIT_HEADER = /limit|remaining|reset|usage|cap/i;
const mediaAnswer = z.object({ data: z.object({ id: z.string() }) });
const postAnswer = z.object({ data: z.object({ id: z.string() }) });
const meAnswer = z.object({ data: z.object({ id: z.string() }) });
const vaultToken = z.object({ access_token: z.string() });

interface Call {
  method?: string;
  body?: FormData | string;
  json?: boolean;
}

async function measure(
  label: string,
  url: string,
  token: string,
  call: Call = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: call.method ?? "GET",
    ...(call.body === undefined ? {} : { body: call.body }),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(call.json === true ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`${label} ${String(response.status)}`);
  for (const [name, value] of response.headers) {
    if (name.startsWith("x-") && LIMIT_HEADER.test(name)) console.log(`  ${name}: ${value}`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} was refused: ${JSON.stringify(body)}`);
  return body;
}

async function record(allowance: number): Promise<number> {
  const db = devDb();
  const release = await holdDevLock();
  try {
    await db.rpc(
      "put_channel_ids",
      {
        p_key: "x",
        p_value: { read_allowance: allowance, metrics_days: allowance === 0 ? [] : [7, 28] },
        p_actor: null,
        p_actor_kind: null,
        p_request_id: "x-limits-check",
      },
      z.unknown(),
    );
  } finally {
    await release();
  }
  console.log(`recorded read_allowance ${String(allowance)}`);
  return 0;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      "i-mean-it": { type: "boolean" },
      record: { type: "string" },
    },
    strict: true,
  });
  guardEnv();
  assertDevTarget(values.target);
  if (values.record !== undefined)
    return record(z.coerce.number().int().min(0).parse(values.record));
  if (values["i-mean-it"] !== true) {
    console.log("refused: --i-mean-it required");
    return 1;
  }
  const held = await devDb().rpc(
    "get_vault_secret",
    { p_name: "x_oauth_token" },
    z.string().nullable(),
  );
  const token =
    held === null
      ? requireSecret("X_ACCESS_TOKEN")
      : vaultToken.parse(JSON.parse(held)).access_token;
  const userId = meAnswer.parse(await measure("users/me", `${API}/users/me`, token)).data.id;

  const form = new FormData();
  form.set(
    "media",
    new Blob([readFileSync(new URL("../tests/fixtures/tiny.jpg", import.meta.url))]),
  );
  form.set("media_category", "tweet_image");
  const media = mediaAnswer.parse(
    await measure("media upload", `${API}/media/upload`, token, { method: "POST", body: form }),
  );
  const created = postAnswer.parse(
    await measure("post", `${API}/tweets`, token, {
      method: "POST",
      json: true,
      body: JSON.stringify({
        text: `Test post ${new Date().toISOString()}`,
        media: { media_ids: [media.data.id] },
      }),
    }),
  );
  await measure("tweet lookup", `${API}/tweets/${created.data.id}`, token);
  await measure("user posts", `${API}/users/${userId}/tweets`, token);
  console.log(`posted ${created.data.id}; delete it from the test handle by hand`);
  return 0;
}

if (import.meta.main) await runScript(main);
