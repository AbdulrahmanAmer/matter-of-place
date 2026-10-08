import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { renderTemplate } from "../../../src/server/email/render";
import { sendEmail } from "../../../src/server/jobs/steps/send-email";
import type { JsonObject } from "../../../src/server/jobs/types";
import { sendStandalone } from "../../../src/server/newsletter/standalone";
import {
  CONTACT,
  emailEnv,
  emailWorld,
  failure,
  fakeFetch,
  JOB_ID,
  NOW,
  PRODUCTION_SHARE,
  stepCtx,
} from "../../fixtures/email-send";
import { newsletterDb, propertyRow, uuid, type Row } from "../../fixtures/newsletter-world";

// B11 step 9: the Campaign email of a property against a fake provider and a database whose asset function keeps the
// one asset row, as `set_asset_text` does. `renderTemplate` is stubbed where a test needs the HTML to hold or lack the
// unsubscribe variable, and restored where the footer of the real `standalone.tsx` is the point.
vi.mock("../../../src/server/email/render", { spy: true });

const PROPERTY = 1;
const SEGMENT = "58d550b4-fec1-420d-9c36-71a8f2d610cc";
const LEGAL = { entity: "Omnikom Media LLC", address: "100 Ocean Drive, Miami, FL 33139" };
const DRAFT = { object: "broadcast", id: "br_1" };
const SEND = "POST /broadcasts/br_1/send";

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function provider(
  routes: Record<string, Reply | (() => Reply)>,
  bodies: Record<string, unknown> = {},
): string[] {
  const keys: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    keys.push(key);
    if (typeof init?.body === "string") bodies[key] = JSON.parse(init.body);
    const route = routes[key];
    if (route === undefined) return Promise.reject(new Error(`unrouted ${key}`));
    const reply = typeof route === "function" ? route() : route;
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  });
  return keys;
}

const ROUTES = {
  [`GET /segments/${SEGMENT}/contacts`]: { body: { data: [] } },
  "POST /broadcasts": { body: DRAFT },
  [SEND]: { body: { id: "br_1" } },
  "GET /broadcasts/br_1": { body: { id: "br_1", status: "draft" } },
};

const metaOf = z.record(z.string(), z.unknown());

const assetRow = (options: Row = {}, meta: Row = {}): Row => ({
  id: uuid(500),
  property_id: uuid(PROPERTY),
  revision: 2,
  kind: "standalone_email",
  status: "approved",
  meta: {
    subject: "Oak Hill",
    preheader: "A quiet street.",
    block: {
      title: "Oak Hill",
      deck: "A quiet street.",
      image_key: "properties/oak/og.jpg",
      image_url: "https://matterofplace.com/media/properties/oak/og.jpg",
      link: "https://matterofplace.com/california/oak-hill?utm_source=newsletter&utm_medium=social&utm_campaign=newsletter",
    },
    ...meta,
  },
  ...options,
});

interface World {
  property?: Row;
  assets?: Row[];
  recipients?: number;
  sentToday?: number;
  channel?: boolean;
  legal?: { entity: string | null; address: string | null };
  jobAgeMs?: number;
}

function world(options: World = {}) {
  const notices: unknown[] = [];
  const assets = options.assets ?? [assetRow()];
  const writes: unknown[] = [];
  const { db } = newsletterDb(
    {
      properties: [
        propertyRow(PROPERTY, {
          slug: "oak-hill",
          title: "Oak Hill",
          market_slug: "california",
          ...options.property,
        }),
      ],
      assets,
      channel_settings: [{ channel: "newsletter", enabled: options.channel ?? true }],
      email_templates: [
        {
          key: "standalone",
          subject: "{{subject}}",
          preheader: "{{preheader}}",
          body: [],
          class: "bulk",
          enabled: true,
        },
      ],
      jobs: [
        {
          id: JOB_ID,
          created_at: new Date(NOW.getTime() - (options.jobAgeMs ?? 60_000)).toISOString(),
        },
      ],
      settings: [
        { key: "email", value: PRODUCTION_SHARE },
        { key: "site", value: { contact: { email: CONTACT }, legal: options.legal ?? LEGAL } },
        { key: "resend", value: { audiences: { "market-ca": SEGMENT } } },
      ],
    },
    {
      newsletter_recipient_count: () => options.recipients ?? 3,
      newsletter_audience_members: () => [],
      email_sent_today: () => options.sentToday ?? 0,
      email_sent_month: () => 0,
      enqueue_job: (args) => {
        notices.push(args["p_payload"]);
        return "job-2";
      },
      set_asset_text: (args) => {
        writes.push(args["p_meta"]);
        const held = assets.find((row) => row["id"] === args["p_asset"]);
        if (held !== undefined)
          held["meta"] = { ...metaOf.parse(held["meta"]), ...metaOf.parse(args["p_meta"]) };
        return null;
      },
    },
  );
  return { db, assets, notices, writes };
}

const run = (
  db: ReturnType<typeof world>["db"],
  data: JsonObject = { property_id: uuid(PROPERTY) },
) => sendStandalone(stepCtx(db), data);

const runStep = (db: ReturnType<typeof world>["db"]) =>
  sendEmail.run(stepCtx(db), { template: "standalone" }, { property_id: uuid(PROPERTY) });

const withFooter = (html: string) =>
  `<p>${LEGAL.address}</p><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>${html}`;

function stubRender(html = withFooter("")): void {
  vi.mocked(renderTemplate).mockImplementation((_row, variables) =>
    Promise.resolve({
      subject: String(variables["subject"]),
      preheader: String(variables["preheader"]),
      html,
      text: "",
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  emailEnv();
  stubRender();
});

afterEach(() => {
  vi.mocked(renderTemplate).mockReset();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a standalone send_email job", () => {
  it("creates one broadcast to market-ca for a California property and sends no per-recipient mail", async () => {
    const keys = provider(ROUTES);
    const { db, writes } = world({ recipients: 3 });
    expect(await runStep(db)).toEqual({
      status: "done",
      result: { broadcast_id: "br_1", recipients: 3 },
    });
    expect(keys).toEqual([`GET /segments/${SEGMENT}/contacts`, "POST /broadcasts", SEND]);
    expect(writes).toEqual([
      { broadcast: { id: "br_1" } },
      { broadcast: { id: "br_1", recipients: 3, sent_at: NOW.toISOString() } },
    ]);
  });

  it("resumes a crash between create and send with the send only", async () => {
    const keys = provider(ROUTES);
    const { db, writes } = world({ assets: [assetRow({}, { broadcast: { id: "br_1" } })] });
    expect(await run(db)).toEqual({
      status: "done",
      result: { broadcast_id: "br_1", recipients: 3 },
    });
    expect(keys).toEqual(["GET /broadcasts/br_1", `GET /segments/${SEGMENT}/contacts`, SEND]);
    expect(writes).toEqual([
      { broadcast: { id: "br_1", recipients: 3, sent_at: NOW.toISOString() } },
    ]);
  });

  it("skips an asset that was already sent, with no call to Resend", async () => {
    const keys = provider({});
    const sent = { id: "br_1", recipients: 3, sent_at: "2026-10-04T10:00:00.000Z" };
    const { db, writes } = world({ assets: [assetRow({}, { broadcast: sent })] });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "already_sent" } });
    expect(keys).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("sends nothing for a property unpublished or taken down after the approval", async () => {
    const keys = provider({});
    const unpublished = world({ property: { editorial_state: "draft" } });
    const takenDown = world({ property: { taken_down_at: "2026-10-05T09:00:00.000Z" } });
    expect(await run(unpublished.db)).toEqual({
      status: "done",
      result: { skipped: "property_unpublished" },
    });
    expect(await run(takenDown.db)).toEqual({
      status: "done",
      result: { skipped: "property_unpublished" },
    });
    expect(keys).toEqual([]);
  });

  it("adopts a broadcast Resend already sent: zero send calls, sent_at written (INT-10)", async () => {
    const keys = provider({ "GET /broadcasts/br_1": { body: { id: "br_1", status: "sent" } } });
    const { db, writes } = world({
      assets: [assetRow({}, { broadcast: { id: "br_1" } })],
      recipients: 4,
    });
    expect(await run(db)).toEqual({ status: "done", result: { adopted: true } });
    expect(keys).toEqual(["GET /broadcasts/br_1"]);
    expect(writes).toEqual([
      { broadcast: { id: "br_1", recipients: 4, sent_at: NOW.toISOString() } },
    ]);
  });

  it("confirms a Conflict from the send through getBroadcast and adopts it", async () => {
    const keys = provider({
      ...ROUTES,
      [SEND]: { status: 409, body: { name: "conflict", message: "x", statusCode: 409 } },
      "GET /broadcasts/br_1": { body: { id: "br_1", status: "sending" } },
    });
    const { db, writes } = world();
    expect(await run(db)).toEqual({ status: "done", result: { adopted: true } });
    expect(keys.filter((key) => key === SEND)).toHaveLength(1);
    expect(writes.at(-1)).toEqual({
      broadcast: { id: "br_1", recipients: 3, sent_at: NOW.toISOString() },
    });
  });

  it("ends sent with a dry_ broadcast id and no fetch under EMAIL_DRY_RUN=1", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const keys = provider({});
    const { db, writes } = world();
    const answer = await run(db);
    expect(answer.status).toBe("done");
    expect(keys).toEqual([]);
    expect(JSON.stringify(writes.at(-1))).toMatch(/"id":"dry_[0-9a-f-]+","recipients":3/);
  });
});

describe("the approval of the asset", () => {
  it("waits an hour for a pending asset and consumes no attempt", async () => {
    const keys = provider({});
    const { db } = world({ assets: [assetRow({ status: "pending" })] });
    expect(await run(db)).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 3_600_000),
      reason: "asset_not_approved",
    });
    expect(keys).toEqual([]);
  });

  it("gives up on a rejected asset, on a missing asset and on a pending asset after seven days", async () => {
    const rejected = world({ assets: [assetRow({ status: "rejected" })] });
    const missing = world({ assets: [] });
    const late = world({
      assets: [assetRow({ status: "pending" })],
      jobAgeMs: 7 * 86_400_000 + 1000,
    });
    for (const { db } of [rejected, missing, late]) {
      expect(await failure(run(db))).toEqual({ dead: true, message: "asset_not_approved" });
    }
  });

  it("reads the highest revision of the asset", async () => {
    provider(ROUTES);
    const older = assetRow({ id: uuid(501), revision: 1, status: "rejected" });
    const { db } = world({ assets: [older, assetRow({ revision: 2 })] });
    expect((await run(db)).status).toBe("done");
  });
});

describe("the footer gate", () => {
  it("throws footer_incomplete when the legal address is null", async () => {
    const keys = provider({});
    const { db } = world({ legal: { entity: LEGAL.entity, address: null } });
    expect(await failure(run(db))).toEqual({ dead: true, message: "footer_incomplete" });
    expect(keys).toEqual([]);
  });

  it("sends the real render with the unsubscribe variable and the legal address in the HTML and the text", async () => {
    const bodies: Record<string, unknown> = {};
    provider(ROUTES, bodies);
    vi.mocked(renderTemplate).mockRestore();
    const { db } = world();
    await run(db);
    const sent = z.object({ html: z.string(), text: z.string() }).parse(bodies["POST /broadcasts"]);
    for (const part of [sent.html, sent.text]) {
      expect(part).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
      expect(part).toContain(LEGAL.address);
      expect(part).toContain(LEGAL.entity);
    }
    expect(sent.html).toContain("Oak Hill");
  });

  it("throws footer_incomplete when the rendered HTML lacks the unsubscribe variable", async () => {
    const keys = provider({});
    stubRender("<p>Oak Hill</p>");
    const { db } = world();
    expect(await failure(run(db))).toEqual({ dead: true, message: "footer_incomplete" });
    expect(keys).toEqual([]);
  });
});

describe("the link and the gates before the send", () => {
  it("puts utm_campaign=standalone-<slug> on the block link", async () => {
    provider(ROUTES);
    const { db } = world();
    await run(db);
    const variables = vi.mocked(renderTemplate).mock.calls[0]?.[1];
    const block = z.object({ link: z.string() }).parse(variables?.["block"]);
    const params = new URL(block.link).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      utm_source: "place_notes",
      utm_medium: "email",
      utm_campaign: "standalone-oak-hill",
      utm_content: "oak-hill",
    });
  });

  it("skips while the newsletter channel is off", async () => {
    const keys = provider({});
    const { db } = world({ channel: false });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "channel_disabled" } });
    expect(keys).toEqual([]);
  });

  it("holds 30 recipients with 25 sent today to tomorrow and tells the admin once", async () => {
    const keys = provider(ROUTES);
    const { db, notices } = world({ recipients: 30, sentToday: 25 });
    expect(await run(db)).toMatchObject({ status: "retry_at", reason: "quota" });
    expect(keys).toEqual([]);
    expect(notices).toMatchObject([
      {
        params: { headline: "Standalone email for Oak Hill waits for tomorrow's quota" },
        data: { link_path: "/admin/assets" },
      },
    ]);
  });

  it("refuses 51 recipients as quota_exceeds_plan with one notice", async () => {
    const keys = provider(ROUTES);
    const { db, notices } = world({ recipients: 51 });
    expect(await failure(run(db))).toEqual({ dead: true, message: "quota_exceeds_plan" });
    expect(keys).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it("returns retry_at five seconds ahead on a 429 from the create call", async () => {
    provider({
      ...ROUTES,
      "POST /broadcasts": {
        status: 429,
        body: { name: "rate_limit_exceeded", message: "x", statusCode: 429 },
        headers: { "Retry-After": "5" },
      },
    });
    const { db } = world();
    expect(await run(db)).toMatchObject({
      status: "retry_at",
      at: new Date(NOW.getTime() + 5000),
    });
  });
});

describe("a standalone test job", () => {
  it("sends one [Test] message to the actor and makes no broadcast call", async () => {
    vi.mocked(renderTemplate).mockRestore();
    const { requests } = fakeFetch();
    const { db } = emailWorld();
    const result = await sendEmail.run(
      stepCtx(db),
      { template: "standalone" },
      { test: true, actor_email: "editor@gmail.com" },
    );
    expect(result).toEqual({ status: "done", result: { sent: "re_1" } });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toMatchObject({
      to: ["editor@gmail.com"],
      subject: "[Test] Alder Court, Pasadena",
    });
    expect(db.calls.filter((call) => call.name === "newsletter_recipient_count")).toEqual([]);
  });
});
