import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import { newsletterHygiene } from "../../../src/server/jobs/system/newsletter-hygiene";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { runHygiene } from "../../../src/server/newsletter/hygiene";
import { openToken } from "../../../src/server/subscribers/confirm-email";
import { emailEnv, failure, NOW, PRODUCTION_SHARE, stepCtx } from "../../fixtures/email-send";
import { newsletterDb, type Row } from "../../fixtures/newsletter-world";

// B11 invariant 10 (GG-05): the three calls of the daily hygiene run, in order, against B5's real helpers over a
// fake database that honours `p_limit`, and a Resend that keeps its contacts and segments as the real one does.

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const enqueued = z.object({
  p_payload: z.object({ data: z.object({ sealed_token: z.string() }) }),
});
const SEGMENTS = { "place-notes": "seg-pn", "market-ca": "seg-ca" };
const SUBSCRIBER_ID = (n: number): string =>
  `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;

interface Options {
  idle?: number;
  lapsed?: number;
  audiences?: unknown;
  members?: Record<string, Row[]>;
  suppressed?: string[];
}

function world({
  idle = 0,
  lapsed = 0,
  audiences = SEGMENTS,
  members = {},
  suppressed = [],
}: Options = {}) {
  const asked: string[] = [];
  const jobs: Row[] = [];
  const cleared: string[] = [];
  const limits: unknown[] = [];
  const subscribers = Array.from({ length: idle }, (_, index) => ({
    id: SUBSCRIBER_ID(index + 1),
    email: `reader${String(index + 1)}@gmail.com`,
  }));
  const { db, calls } = newsletterDb(
    {
      settings: [
        { key: "email", value: PRODUCTION_SHARE },
        ...(audiences === null ? [] : [{ key: "resend", value: { audiences } }]),
      ],
      subscribers,
      email_suppressions: suppressed.map((email) => ({ email })),
    },
    {
      repermission_candidates: (args) => {
        limits.push(args["p_limit"]);
        return subscribers.slice(0, Number(args["p_limit"])).map(({ id }) => ({ id }));
      },
      issue_repermission: (args) => {
        asked.push(String(args["p_subscriber_id"]));
        return true;
      },
      enqueue_job: (args) => {
        jobs.push(args);
        return "job-1";
      },
      lapse_subscribers: () => lapsed,
      newsletter_audience_members: (args) => members[String(args["p_audience"])] ?? [],
      newsletter_set_contact: () => null,
      newsletter_clear_contact: (args) => {
        cleared.push(String(args["p_contact_id"]));
        return 1;
      },
    },
  );
  const steps = () =>
    calls.flatMap((call) =>
      call.kind === "rpc" && !["email_sent_today", "email_sent_month"].includes(call.name)
        ? [call.name]
        : [],
    );
  return { db, steps, asked, jobs, cleared, limits };
}

interface Contact {
  id: string;
  email: string;
}

/** A Resend whose contacts sit in the segments named in `placed`; `requests` holds every call as `<METHOD> <path>`. */
function fakeResend(contacts: Contact[], placed: Record<string, string[]>) {
  const requests: string[] = [];
  const inSegment = new Map(
    Object.entries(placed).map(([segment, ids]) => [segment, new Set(ids)]),
  );
  const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(input).pathname;
    requests.push(`${method} ${path}`);
    const [, area = "", id = "", tail = "", segment = ""] = path.split("/");
    if (method === "GET" && area === "segments" && tail === "contacts") {
      const ids = inSegment.get(id) ?? new Set<string>();
      return json({
        data: contacts
          .filter((contact) => ids.has(contact.id))
          .map((contact) => ({ ...contact, unsubscribed: false })),
      });
    }
    if (method === "DELETE" && tail === "segments") {
      return inSegment.get(segment)?.delete(id) === true
        ? json({ deleted: true })
        : json({ name: "not_found", message: "no", statusCode: 404 }, 404);
    }
    if (method === "GET" && tail === "segments") {
      return json({
        data: [...inSegment].filter(([, ids]) => ids.has(id)).map(([name]) => ({ id: name })),
      });
    }
    if (method === "DELETE") return json({ deleted: true });
    return Promise.reject(new Error(`unrouted ${method} ${path}`));
  });
  return { requests };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  emailEnv({ EMAIL_DRY_RUN: "1" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runHygiene", () => {
  it("asks each candidate, lapses, then syncs each stored audience, in that order", async () => {
    const { db, steps } = world({ idle: 2, lapsed: 3 });
    expect(await runHygiene(db, KEY)).toEqual({
      candidates: 2,
      asked: 2,
      lapsed: 3,
      audiences: {
        "place-notes": { dry_run: true, members: 0 },
        "market-ca": { dry_run: true, members: 0 },
      },
    });
    expect(steps()).toEqual([
      "repermission_candidates",
      "issue_repermission",
      "enqueue_job",
      "issue_repermission",
      "enqueue_job",
      "lapse_subscribers",
      "newsletter_audience_members",
      "newsletter_audience_members",
    ]);
  });

  it("asks for 20 candidates and so asks at most 20 of 25", async () => {
    const { db, asked, limits } = world({ idle: 25 });
    const result = await runHygiene(db, KEY);
    expect(limits).toEqual([20]);
    expect([result.candidates, result.asked, asked.length]).toEqual([20, 20, 20]);
  });

  it("seals each new confirm token with the key it was given", async () => {
    const { db, jobs } = world({ idle: 1 });
    await runHygiene(db, KEY);
    const sealed = enqueued.parse(jobs[0]).p_payload.data.sealed_token;
    expect(await openToken(sealed, KEY)).not.toBeNull();
    expect(
      await openToken(sealed, btoa(String.fromCharCode(...new Uint8Array(32).fill(6)))),
    ).toBeNull();
  });

  it("counts only the candidates it asked: a suppressed address is passed over", async () => {
    const { db, asked } = world({ idle: 2, suppressed: ["reader1@gmail.com"] });
    const result = await runHygiene(db, KEY);
    expect([result.candidates, result.asked, asked]).toEqual([2, 1, [SUBSCRIBER_ID(2)]]);
  });

  it("syncs no audience when settings.resend holds none, and skips a key it cannot sync", async () => {
    const none = world({ audiences: null });
    expect((await runHygiene(none.db, KEY)).audiences).toEqual({});
    const odd = world({ audiences: { "market-xx": "seg-x", "place-notes": "seg-pn" } });
    expect(Object.keys((await runHygiene(odd.db, KEY)).audiences)).toEqual(["place-notes"]);
  });

  it("refuses a malformed settings.resend as non-retryable", async () => {
    const { db } = world({ audiences: "oops" });
    const error: unknown = await runHygiene(db, KEY).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error).toMatchObject({ message: "resend_settings_invalid" });
  });

  it("removes a complaint-suppressed contact from each audience it is listed in and clears its stored id", async () => {
    emailEnv();
    const resend = fakeResend([{ id: "c-9", email: "reader9@gmail.com" }], {
      "seg-pn": ["c-9"],
      "seg-ca": ["c-9"],
    });
    const { db, cleared } = world({ members: { "place-notes": [], "market-ca": [] } });
    const result = await runHygiene(db, KEY);
    expect(resend.requests.filter((request) => !request.startsWith("GET "))).toEqual([
      "DELETE /contacts/c-9/segments/seg-pn",
      "DELETE /contacts/c-9/segments/seg-ca",
      "DELETE /contacts/c-9",
    ]);
    expect(cleared).toEqual(["c-9", "c-9"]);
    expect(result.audiences).toEqual({
      "place-notes": { added: 0, removed: 1, members: 0 },
      "market-ca": { added: 0, removed: 1, members: 0 },
    });
  });
});

describe("newsletter_hygiene", () => {
  const run = (
    db: ReturnType<typeof world>["db"],
    env: Record<string, string | undefined> = { CONFIRM_TOKEN_SECRET: KEY },
  ) => newsletterHygiene.run({ ...stepCtx(db, { type: "newsletter_hygiene" }), env }, {}, {});

  it("is registered and may retry twelve times", () => {
    expect(getSystemJob("newsletter_hygiene")).toBe(newsletterHygiene);
    expect(newsletterHygiene.maxAttempts).toBe(12);
  });

  it("passes the runner's CONFIRM_TOKEN_SECRET to the run and answers its counts", async () => {
    const { db, jobs } = world({ idle: 1, lapsed: 1 });
    const answer = await run(db);
    expect(answer).toMatchObject({
      status: "done",
      result: { candidates: 1, asked: 1, lapsed: 1 },
    });
    expect(jobs).toHaveLength(1);
  });

  it("is dead at once without the secret, and touches nothing", async () => {
    const { db, steps } = world({ idle: 1 });
    expect(await failure(run(db, {}))).toEqual({ dead: true, message: "confirm_secret_missing" });
    expect(steps()).toEqual([]);
  });

  it("returns retry_at when Resend answers 429 during the audience step", async () => {
    emailEnv();
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { name: "rate_limit_exceeded", message: "slow down", statusCode: 429 },
          { status: 429, headers: { "retry-after": "4" } },
        ),
      ),
    );
    const { db } = world({ lapsed: 1 });
    const answer = await run(db);
    expect(answer).toMatchObject({ status: "retry_at", reason: "resend_rate_limit_exceeded" });
    expect(answer.status === "retry_at" && answer.at.getTime() > NOW.getTime()).toBe(true);
  });

  it("ends the job dead on a malformed settings.resend", async () => {
    const { db } = world({ audiences: "oops" });
    expect(await failure(run(db))).toEqual({ dead: true, message: "resend_settings_invalid" });
  });
});
