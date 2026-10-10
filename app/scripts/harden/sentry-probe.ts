// `bun run scripts/harden/sentry-probe.ts --env dev|prod [--base <url>]` (H1-34): a Sentry test error arrives. It POSTs
// `<base>/api/hooks/sentry-test` with the test token, reads `error.requestId` from the 500 body and polls Sentry every
// 10 seconds for up to 120 seconds for an issue tagged `request_id:<id>` (the tag of `src/server/lib/sentry.ts`). Then it
// reads the project's client keys: the Worker's and the job runner's must each carry a rate limit (INT-12). `--env dev`
// takes the token from `PREVIEW_SENTRY_TEST_TOKEN` (shell or the local `.env`), `--env prod` takes `SENTRY_TEST_TOKEN`
// from the shell and defaults the base to https://matterofplace.com (L1 step 6). A missing token prints `BLOCKED <name>`
// and exits 0. It writes nothing to the database. Prints `sentry ok <requestId>`, or the failing check and exit 1.
import { parseArgs } from "node:util";
import { z } from "zod";
import { localEnv } from "./local-env.ts";
import { sentryGet, sentryToken } from "./sentry-api.ts";

const PROD_BASE = "https://matterofplace.com";
const POLL_MS = 10_000;
const WAIT_MS = 120_000;
const TIMEOUT_MS = 30_000;
const CLIENT_KEYS = 2;

const failure = z.object({ error: z.object({ requestId: z.string().min(8) }) });
const issues = z.array(z.object({ id: z.string() }));
const keys = z.array(z.object({ rateLimit: z.object({ count: z.number() }).nullable() }));

async function fire(base: string, token: string): Promise<string> {
  const response = await fetch(`${base}/api/hooks/sentry-test`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = failure.safeParse(await response.json());
  if (response.status !== 500 || !body.success) {
    throw new Error(
      `sentry probe: ${base} answered ${String(response.status)}, not a 500 with error.requestId`,
    );
  }
  return body.data.error.requestId;
}

async function waitForIssue(auth: string, requestId: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const found = await sentryGet(auth, `issues/?query=request_id:${requestId}`, issues);
    if (found.length > 0) return;
    if (Date.now() + POLL_MS > deadline) {
      throw new Error(
        `sentry probe: no issue tagged request_id:${requestId} within ${String(WAIT_MS / 1000)} seconds`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { env: { type: "string" }, base: { type: "string" } },
    strict: true,
  });
  const prod = values.env === "prod";
  const base = (values.base ?? (prod ? PROD_BASE : undefined))?.replace(/\/+$/, "");
  if ((values.env !== "dev" && !prod) || base === undefined || !URL.canParse(base)) {
    console.error("usage: bun run scripts/harden/sentry-probe.ts --env dev|prod [--base <url>]");
    return 64;
  }
  const tokenName = prod ? "SENTRY_TEST_TOKEN" : "PREVIEW_SENTRY_TEST_TOKEN";
  const token = prod ? process.env[tokenName] : localEnv(tokenName);
  if (token === undefined || token === "") {
    console.log(`BLOCKED ${tokenName}`);
    return 0;
  }
  const auth = sentryToken();
  if (auth === undefined) {
    console.log("BLOCKED SENTRY_AUTH_TOKEN");
    return 0;
  }
  const requestId = await fire(base, token);
  await waitForIssue(auth, requestId);
  const limited = (await sentryGet(auth, "keys/", keys)).filter((key) => key.rateLimit !== null);
  if (limited.length < CLIENT_KEYS) {
    throw new Error(
      `sentry probe: ${String(limited.length)} client keys carry a rate limit, not ${String(CLIENT_KEYS)}`,
    );
  }
  console.log(`sentry ok ${requestId}`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
