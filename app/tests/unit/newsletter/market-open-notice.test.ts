import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import { marketOpenNotice } from "../../../src/server/jobs/system/market-open-notice";
import {
  emailEnv,
  emailWorld,
  fakeFetch,
  NOW,
  PRODUCTION_SHARE,
  resendError,
  stepCtx,
  type World,
} from "../../fixtures/email-send";

// B11 invariant 14 (G15, G37, G58, DL-07): the one mail an interest-only signup gets when its market opens. B5's real
// `sendOne` runs against the email world, so the ceilings, the message rows and the resumed job are B5's own.

const subscriber = (n: number, source: string, markets: string[], values = {}) => ({
  id: `5e1f0a00-0000-4000-8000-00000000000${String(n)}`,
  email: `reader${String(n)}@gmail.com`,
  source,
  markets,
  confirmed_at: "2026-09-01T00:00:00.000Z",
  unsubscribed_at: null,
  archived_at: null,
  ...values,
});

const SUBSCRIBERS = [
  subscriber(1, "interest:california", ["california"]),
  subscriber(2, "interest:california", ["california"]),
  subscriber(3, "footer", ["california"]),
  subscriber(4, "interest:florida", ["florida"]),
  subscriber(5, "interest:california", ["california"], { confirmed_at: null }),
  subscriber(6, "interest:california", ["california"], {
    unsubscribed_at: "2026-09-02T00:00:00.000Z",
  }),
];

function world(options: World = {}) {
  return emailWorld({
    share: PRODUCTION_SHARE,
    ...options,
    tables: {
      markets: [
        { slug: "california", name: "California" },
        { slug: "florida", name: "Florida" },
        { slug: "new-york", name: "New York" },
      ],
      subscribers: SUBSCRIBERS,
    },
  });
}

const run = (db: ReturnType<typeof world>["db"], market = "california") =>
  marketOpenNotice.run(stepCtx(db, { type: "market_open_notice" }), {}, { market });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  emailEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("market_open_notice", () => {
  it("is registered with twelve attempts", () => {
    expect(getSystemJob("market_open_notice")).toBe(marketOpenNotice);
    expect(marketOpenNotice.maxAttempts).toBe(12);
  });

  it("sends market_open once to each confirmed interest-only subscriber of the market, with its name and link", async () => {
    const resend = fakeFetch();
    const { db, messages } = world();
    expect(await run(db)).toEqual({ status: "done", result: { sent: 2 } });
    expect(resend.requests.map(({ body }) => body.to)).toEqual([
      ["reader1@gmail.com"],
      ["reader2@gmail.com"],
    ]);
    expect(messages.map(({ template_key, kind }) => [template_key, kind])).toEqual([
      ["market_open", "bulk"],
      ["market_open", "bulk"],
    ]);
    for (const { body } of resend.requests) {
      expect(body.subject).toBe("Matter of Place now publishes in California");
      expect(body.html).toContain("https://matterofplace.com/california");
    }
  });

  it("sends nothing to a Place Notes-only or an interest:florida subscriber", async () => {
    const resend = fakeFetch();
    await run(world().db);
    const sentTo = resend.requests.flatMap(({ body }) => body.to);
    expect(sentTo).not.toContain("reader3@gmail.com");
    expect(sentTo).not.toContain("reader4@gmail.com");
  });

  it("stops at the first retry_at sendOne returns and returns it", async () => {
    const resend = fakeFetch((attempt) =>
      attempt === 1 ? resendError(429, "rate_limit_exceeded", { "retry-after": "5" }) : undefined,
    );
    const result = await run(world().db);
    expect(result).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 5000),
      reason: "rate_limit_exceeded",
    });
    expect(resend.requests).toHaveLength(1);
  });

  it("holds every market_open send once email_sent_today() is at bulk_cap (DL-07)", async () => {
    const resend = fakeFetch();
    const { db, messages } = world({ sentToday: PRODUCTION_SHARE.bulk_cap });
    expect(await run(db)).toEqual({
      status: "retry_at",
      at: new Date("2026-10-06T01:00:00.000Z"),
      reason: "daily_cap_bulk",
    });
    expect(resend.requests).toEqual([]);
    expect(messages).toEqual([]);
  });

  it("market_open_notice runs twice without a second outside effect", async () => {
    const resend = fakeFetch();
    const { db } = world();
    await run(db);
    expect(await run(db)).toEqual({ status: "done", result: { sent: 0 } });
    expect(resend.deliveries()).toBe(2);
    expect(resend.requests).toHaveLength(2);
  });

  it("ends sent: 0 for a market with no interest signup", async () => {
    const resend = fakeFetch();
    expect(await run(world().db, "new-york")).toEqual({ status: "done", result: { sent: 0 } });
    expect(resend.requests).toEqual([]);
  });

  it("sends nothing while the market_open template is switched off", async () => {
    const resend = fakeFetch();
    const { db } = world({ templates: { market_open: { enabled: false } } });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "template_disabled" } });
    expect(resend.requests).toEqual([]);
  });
});
