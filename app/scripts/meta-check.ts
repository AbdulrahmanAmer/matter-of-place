// B10 step 0: reads `settings.meta` and the Meta token of the one project (ruling H35) and asks the real Graph API
// whether the app, the token, the ids and the permissions are right. `bun run scripts/meta-check.ts [--target dev]`
// prints one line per check and exits 1 when one failed. While `settings.meta` has no ids it prints `meta not_configured`
// and exits 0. It writes nothing and prints no token. L1 runs it again after the launch switch with the real Page's values.
import { parseArgs } from "node:util";
import { z } from "zod";
import { hmacSha256, toHex } from "../src/server/lib/crypto.ts";
import { META_REQUIRED_SCOPES } from "../src/server/jobs/system/meta-token-refresh.ts";
import { devDb } from "./lib/dev-db.ts";
import { guardEnv } from "./lib/guard-env.mjs";
import { assertDevTarget, readSecret, requireSecret, runScript } from "./lib/social-script.ts";

const metaRows = z.array(
  z.object({
    value: z.object({
      page_id: z.string().optional(),
      ig_user_id: z.string().optional(),
      graph_version: z.string().optional(),
    }),
  }),
);
const debugToken = z.object({
  data: z.object({
    app_id: z.string(),
    is_valid: z.boolean(),
    expires_at: z.number().optional(),
    scopes: z.array(z.string()).optional(),
  }),
});
const page = z.object({
  id: z.string(),
  instagram_business_account: z.object({ id: z.string() }).optional(),
});
const permissions = z.object({
  data: z.array(z.object({ permission: z.string(), status: z.string() })),
});

async function graph<T>(
  path: string,
  query: Record<string, string>,
  answer: z.ZodType<T>,
): Promise<T> {
  // The address carries the token and the app secret, and a runtime's network error can quote it: say nothing of it.
  const response = await fetch(
    `https://graph.facebook.com/${path}?${new URLSearchParams(query).toString()}`,
    { signal: AbortSignal.timeout(20_000) },
  ).catch(() => {
    throw new Error(`graph ${path} did not answer`);
  });
  if (!response.ok) throw new Error(`graph ${path} answered ${String(response.status)}`);
  return answer.parse(await response.json());
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { target: { type: "string" } }, strict: true });
  guardEnv();
  assertDevTarget(values.target);
  const db = devDb();
  const meta = (await db.select("settings", "key=eq.meta&select=value", metaRows))[0]?.value;
  if (meta?.page_id === undefined || meta.ig_user_id === undefined) {
    console.log("meta not_configured");
    return 0;
  }
  const version = meta.graph_version;
  if (version === undefined) {
    console.log("graph_version missing");
    return 1;
  }
  const appId = requireSecret("META_APP_ID");
  const appSecret = requireSecret("META_APP_SECRET");
  const token =
    (await db.rpc("get_vault_secret", { p_name: "meta_page_token" }, z.string().nullable())) ??
    readSecret("META_PAGE_TOKEN");
  if (token === undefined) {
    console.log("token missing");
    return 1;
  }
  const proof = { appsecret_proof: toHex(await hmacSha256(appSecret, token)) };
  const results: boolean[] = [];
  const report = (ok: boolean, line: string): void => {
    console.log(line);
    results.push(ok);
  };

  const inspected = (
    await graph(
      `${version}/debug_token`,
      { input_token: token, access_token: `${appId}|${appSecret}` },
      debugToken,
    )
  ).data;
  report(inspected.app_id === appId, inspected.app_id === appId ? "app_id ok" : "app_id mismatch");
  report(inspected.is_valid, inspected.is_valid ? "token ok" : "token invalid");
  console.log(
    inspected.expires_at === undefined || inspected.expires_at === 0
      ? "expires never"
      : `expires ${new Date(inspected.expires_at * 1000).toISOString()}`,
  );

  const found = await graph(
    `${version}/${meta.page_id}`,
    { fields: "instagram_business_account", access_token: token, ...proof },
    page,
  );
  report(found.id === meta.page_id, found.id === meta.page_id ? "page_id ok" : "page_id mismatch");
  const linked = found.instagram_business_account?.id === meta.ig_user_id;
  report(linked, linked ? "ig_user_id ok" : "ig_user_id mismatch");

  const granted = new Set(
    (await graph(`${version}/me/permissions`, { access_token: token, ...proof }, permissions)).data
      .filter((entry) => entry.status === "granted")
      .map((entry) => entry.permission),
  );
  for (const scope of META_REQUIRED_SCOPES) {
    report(granted.has(scope), `permission ${scope} ${granted.has(scope) ? "granted" : "missing"}`);
  }
  // STUB(B10 step 2): the call that returns development or live is named in step 2 and replaces this line
  console.log("app_mode unknown");
  return results.every(Boolean) ? 0 : 1;
}

if (import.meta.main) await runScript(main);
