// B15 step 7: sends one body marked `"test": true` to Omnikom's real endpoint, to check the connection before
// `OMNIKOM_WEBHOOK_URL` and `OMNIKOM_WEBHOOK_SECRET` are set on the project. From the app folder, in a shell prepared
// with `eval "$(node scripts/load-env.mjs --profile ops)"` over the root `.env.ops` (SEC-08):
// `bun run scripts/omnikom-send-test.ts --i-mean-it`. The two values are read from the environment, never printed.
import { parseArgs } from "node:util";
import { deliver } from "../src/server/omnikom/client.ts";
import { buildInquiryPayload } from "../src/server/omnikom/payload.ts";

const SAMPLE_INQUIRY = {
  id: "2aad04a4-3848-43fc-b90e-1db79b89f5ac",
  intent: "general",
  topic: null,
  name: "Ada Reyes",
  email: "ada@example.com",
  phone: null,
  location: null,
  message: "A test from Matter of Place.",
  details: {},
  source_path: "/contact",
  received_at: "2026-10-04T09:30:00.000+00:00",
  subject_kind: null,
  subject_slug: null,
  subject_title: null,
  attribution: {},
} as const;

function readEnv(): { url: string; secret: string } {
  const url = process.env["OMNIKOM_WEBHOOK_URL"];
  const secret = process.env["OMNIKOM_WEBHOOK_SECRET"];
  const missing = [
    ...(url ? [] : ["OMNIKOM_WEBHOOK_URL"]),
    ...(secret ? [] : ["OMNIKOM_WEBHOOK_SECRET"]),
  ];
  if (!url || !secret) {
    throw new Error(
      `omnikom-send-test: ${missing.join(" and ")} not set (eval "$(node scripts/load-env.mjs --profile ops)")`,
    );
  }
  if (!URL.canParse(url)) throw new Error("omnikom-send-test: OMNIKOM_WEBHOOK_URL is not a URL");
  return { url, secret };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { "i-mean-it": { type: "boolean" } },
  });
  if (values["i-mean-it"] !== true) {
    throw new Error(
      "omnikom-send-test: this sends a real request to Omnikom; pass --i-mean-it to confirm",
    );
  }
  const { url, secret } = readEnv();
  const payload = await buildInquiryPayload(SAMPLE_INQUIRY, null, { test: true });
  const outcome = await deliver(JSON.stringify(payload), {
    deliveryId: payload.id,
    url,
    secret,
    now: new Date(),
  });
  if (outcome.kind === "delivered") {
    console.log(outcome.status);
    return;
  }
  const status = outcome.status === undefined ? "no answer" : String(outcome.status);
  const detail = outcome.kind === "refused" ? ` ${outcome.detail}` : "";
  throw new Error(`omnikom-send-test: ${outcome.kind} (${status})${detail}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
