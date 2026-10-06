import "../../fixtures/worker-env";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { stepSchema } from "../../../src/domain/automation";
import { planEvent } from "../../../src/server/automation/plan";
import { resolveVariables } from "../../../src/server/email/variables";
import { getStep } from "../../../src/server/jobs/steps/index";
import { sendEmail } from "../../../src/server/jobs/steps/send-email";
import { sha256Hex, toBase64Url } from "../../../src/server/lib/crypto";
import { env } from "../../../src/server/lib/env";
import { emitEvent } from "../../../src/server/lib/events";
import { enqueueJob } from "../../../src/server/lib/jobs";
import { openToken, sealToken } from "../../../src/server/subscribers/confirm-email";
import { requestConfirmation } from "../../../src/server/subscribers/confirmation";
import { subscribe } from "../../../src/server/subscribers/service";
import {
  emailEnv,
  emailWorld,
  EVENT_ID,
  fakeFetch,
  failure,
  stepCtx,
} from "../../fixtures/email-send";
import { fakeDb } from "../../fixtures/fake-db";

// Double opt-in (B5 step 7, invariant 7, G12, G20): the Worker seals the confirm token, `upsert_subscriber` writes it
// into `subscriber.created`, the seeded recipe plans one `send_email` job, and the runner opens it into the link.
// Nothing but the planner makes that job, so `emitEvent` and `enqueueJob` are counted and answer without a database.

vi.mock(import("../../../src/server/lib/jobs"), async (importOriginal) => ({
  ...(await importOriginal()),
  enqueueJob: vi.fn(() => Promise.resolve("job-enqueued-directly")),
}));
vi.mock(import("../../../src/server/lib/events"), async (importOriginal) => ({
  ...(await importOriginal()),
  emitEvent: vi.fn(() => Promise.resolve("event-emitted-directly")),
}));

const keyOf = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const KEY = keyOf(7);
const OTHER_KEY = keyOf(8);
const SUBSCRIBER_ID = "55555555-5555-4555-8555-555555555555";
const READER = "reader@gmail.com";
const SITE = {
  siteUrl: "https://matterofplace.com",
  entity: null,
  address: null,
  contact: { email: null },
};

/** Every confirm token the code makes: `newToken` is 32 bytes of `crypto.getRandomValues`, an IV is 12. */
function captureTokens(): string[] {
  const tokens: string[] = [];
  const original = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      const filled = original(array);
      if (filled instanceof Uint8Array && filled.length === 32) tokens.push(toBase64Url(filled));
      return filled;
    },
  );
  return tokens;
}

const upsertArgs = z.object({
  p: z.object({ confirm_token_hash: z.string(), sealed_token: z.string().nullish() }).passthrough(),
});

/** `subscribers.subscribe` against a fake `upsert_subscriber` that keeps the `p` it was given. */
async function signUp() {
  const sent: z.infer<typeof upsertArgs>["p"][] = [];
  const db = fakeDb({
    rpc: {
      upsert_subscriber: (args) => {
        sent.push(upsertArgs.parse(args).p);
        return SUBSCRIBER_ID;
      },
    },
  });
  await subscribe(db, { email: READER, source: "interest:california", markets: ["california"] });
  const [p] = sent;
  if (p === undefined) throw new Error("upsert_subscriber was not called");
  return p;
}

/** The recipe the seed migration gives `subscriber.created`, read from the migration itself. */
function seededRecipe() {
  const folder = new URL("../../../supabase/migrations/", import.meta.url);
  const file = readdirSync(folder).find((name) => name.endsWith("_automation_seed.sql"));
  if (file === undefined) throw new Error("no automation seed migration");
  const sql = readFileSync(new URL(file, folder), "utf8");
  const steps = /\('subscriber\.created', '[^']*', true, '(\[[\s\S]*?\])'\)/.exec(sql)?.[1];
  if (steps === undefined) throw new Error("no subscriber.created recipe in the seed");
  const parsed = z.array(stepSchema).parse(JSON.parse(steps));
  return {
    id: "recipe-subscriber-created",
    trigger: "subscriber.created",
    enabled: true,
    steps: parsed,
  };
}

const confirmLink =
  /https:\/\/matterofplace\.com\/api\/public\/subscribers\/confirm\?token=([^"&\s<]+)/;

beforeEach(() => {
  Object.assign(env, { CONFIRM_TOKEN_SECRET: KEY });
  emailEnv({ CONFIRM_TOKEN_SECRET: KEY });
  vi.mocked(enqueueJob).mockClear();
  vi.mocked(emitEvent).mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(env, "CONFIRM_TOKEN_SECRET");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sealToken and openToken", () => {
  it("open a sealed token to the original, and the sealed text is base64url without it", async () => {
    const raw = toBase64Url(new Uint8Array(32).fill(3));
    const sealed = await sealToken(raw, KEY);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(raw);
    expect(await openToken(sealed, KEY)).toBe(raw);
  });

  it("a wrong key fails with token_unreadable", async () => {
    const sealed = await sealToken("raw-token", KEY);
    expect(await openToken(sealed, OTHER_KEY)).toBeNull();
    vi.stubEnv("CONFIRM_TOKEN_SECRET", OTHER_KEY);
    const resolving = resolveVariables(
      fakeDb(),
      "newsletter_confirm",
      { subscriber_id: SUBSCRIBER_ID, sealed_token: sealed },
      undefined,
      SITE,
    );
    expect(await failure(resolving)).toEqual({ dead: true, message: "token_unreadable" });
  });

  it("a changed or malformed sealed text opens to null", async () => {
    const sealed = await sealToken("raw-token", KEY);
    const changed = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    expect([await openToken(changed, KEY), await openToken("not*base64", KEY)]).toEqual([
      null,
      null,
    ]);
  });

  it("the runner without CONFIRM_TOKEN_SECRET fails with confirm_secret_missing", async () => {
    vi.stubEnv("CONFIRM_TOKEN_SECRET", undefined);
    const resolving = resolveVariables(
      fakeDb(),
      "newsletter_confirm",
      { subscriber_id: SUBSCRIBER_ID, sealed_token: await sealToken("raw-token", KEY) },
      undefined,
      SITE,
    );
    expect(await failure(resolving)).toEqual({ dead: true, message: "confirm_secret_missing" });
  });

  it("the runner with a CONFIRM_TOKEN_SECRET that is not base64 of 32 bytes fails with confirm_secret_missing", async () => {
    vi.stubEnv("CONFIRM_TOKEN_SECRET", "not*base64");
    const resolving = resolveVariables(
      fakeDb(),
      "newsletter_confirm",
      { subscriber_id: SUBSCRIBER_ID, sealed_token: await sealToken("raw-token", KEY) },
      undefined,
      SITE,
    );
    expect(await failure(resolving)).toEqual({ dead: true, message: "confirm_secret_missing" });
  });
});

describe("requestConfirmation", () => {
  it("subscribe passes the sealed token and no raw token to upsert_subscriber", async () => {
    const tokens = captureTokens();
    const p = await signUp();
    const [raw] = tokens;
    if (raw === undefined) throw new Error("no token was made");
    expect(p.confirm_token_hash).toBe(await sha256Hex(raw));
    expect(typeof p.sealed_token).toBe("string");
    expect(await openToken(p.sealed_token ?? "", KEY)).toBe(raw);
    expect(JSON.stringify(p)).not.toContain(raw);
  });

  it("calls neither emitEvent nor enqueueJob", async () => {
    const sealed = await requestConfirmation("raw-token");
    expect(sealed).not.toBeNull();
    expect([vi.mocked(emitEvent).mock.calls, vi.mocked(enqueueJob).mock.calls]).toEqual([[], []]);
  });

  it("without CONFIRM_TOKEN_SECRET returns null and logs confirm_secret_missing", async () => {
    Reflect.deleteProperty(env, "CONFIRM_TOKEN_SECRET");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await requestConfirmation("raw-token")).toBeNull();
    expect(warn.mock.calls).toEqual([
      [JSON.stringify({ level: "warn", event: "confirm_secret_missing" })],
    ]);
  });
});

describe("stub chain: signup, subscriber.created, the seeded recipe, send_email", () => {
  it("stub chain: one send_email job keyed <event_id>:<step id>, no raw token in a payload, a link that confirms the row", async () => {
    const tokens = captureTokens();
    const p = await signUp();
    const [raw] = tokens;
    if (raw === undefined || typeof p.sealed_token !== "string")
      throw new Error("no sealed token was made");

    // What `upsert_subscriber` writes in its transaction (G20): the id and the sealed token, nothing else.
    const eventPayload = { subscriber_id: SUBSCRIBER_ID, sealed_token: p.sealed_token };
    const plan = planEvent(
      seededRecipe(),
      { id: EVENT_ID, payload: eventPayload },
      { registry: getStep },
    );
    const [job] = plan.planned;
    expect(JSON.stringify(eventPayload)).not.toContain(raw);
    expect(JSON.stringify(plan.planned)).not.toContain(raw);
    // A direct enqueue would be a second job for the same signup (invariant 7).
    expect(plan.planned.length + vi.mocked(enqueueJob).mock.calls.length).toBe(1);
    expect(vi.mocked(emitEvent).mock.calls).toEqual([]);
    expect(job).toMatchObject({ type: "send_email", idempotency_key: `${EVENT_ID}:send_confirm` });
    if (job === undefined) throw new Error("no job was planned");

    const fetch = fakeFetch();
    const subscriber = {
      id: SUBSCRIBER_ID,
      email: READER,
      markets: ["california"],
      pending_source: null,
    };
    const { db } = emailWorld({
      jobKey: job.idempotency_key,
      eventType: "subscriber.created",
      tables: { subscribers: [subscriber] },
    });
    const result = await sendEmail.run(
      stepCtx(db, { eventId: EVENT_ID }),
      job.payload.params,
      job.payload.data,
    );
    expect(result).toEqual({ status: "done", result: { sent: "re_1" } });
    const [request] = fetch.requests;
    const token = confirmLink.exec(request?.body.text ?? "")?.[1];
    expect(request?.body.to).toEqual([READER]);
    expect(await sha256Hex(decodeURIComponent(token ?? ""))).toBe(p.confirm_token_hash);
  });
});
