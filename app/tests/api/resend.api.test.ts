// POST /api/hooks/resend through `handlePublic` against mop-dev (CI's stack in the `db` job). Bodies are signed here
// with node's own HMAC and the test secret of `env.ts`, so no Resend account is needed and the check is not graded by
// the code it checks. Committed mode: every case removes its subscribers and receipts afterwards.
import "./env";
import { TEST_RESEND_WEBHOOK_SECRET, TEST_TURNSTILE_TOKEN } from "./env";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDb, type Db } from "../../src/server/lib/db";
import { env } from "../../src/server/lib/env";
import { hashKey } from "../../src/server/lib/ids";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, type Db as Pg } from "../fixtures/db";

const REQUEST_ID = "req-api-resend-0001";
const IP = "198.18.250.1";

const nextEmail = () => `complaint+${randomUUID()}@example.invalid`;
const nextId = () => `msg_${randomUUID()}`;

const complaint = (email: string) =>
  JSON.stringify({
    type: "email.complained",
    created_at: "2026-10-04T00:00:00.000Z",
    data: { email_id: randomUUID(), to: [email], subject: "Place Notes" },
  });

function sign(id: string, timestamp: string, body: string): string {
  const key = Buffer.from(TEST_RESEND_WEBHOOK_SECRET.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function delivery(
  body: string,
  id: string,
  options: { ageSeconds?: number; signature?: string } = {},
) {
  const timestamp = String(Math.floor(Date.now() / 1000) - (options.ageSeconds ?? 0));
  return new Request("http://localhost/api/hooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": IP,
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": options.signature ?? sign(id, timestamp, body),
    },
    body,
  });
}

/** Runs `fn` committed with one subscriber per email, then removes them and the receipts of `ids`. */
async function run<T>(emails: string[], ids: string[], fn: (pg: Pg) => Promise<T>): Promise<T> {
  return committed(
    async (pg) => {
      for (const email of emails) {
        await pg.query(
          "insert into public.subscribers (email, source, confirmed_at) values ($1, 'stories', now())",
          [email],
        );
      }
      return fn(pg);
    },
    async (pg) => {
      await pg.query("begin");
      await pg.query("select set_config('mop.retention', 'on', true)");
      await pg.query("delete from public.subscribers where email = any ($1)", [emails]);
      await pg.query("delete from public.email_suppressions where email = any ($1)", [emails]);
      await pg.query("delete from public.email_events where provider_event_id = any ($1)", [ids]);
      await pg.query(
        "delete from public.webhook_receipts where provider = 'resend' and id = any ($1)",
        [ids],
      );
      await pg.query("commit");
    },
  );
}

async function unsubscribedAt(pg: Pg, email: string): Promise<string | null> {
  const result = await pg.query<{ at: string | null }>(
    "select unsubscribed_at::text as at from public.subscribers where email = $1",
    [email],
  );
  return z.array(z.object({ at: z.string().nullable() })).parse(result.rows)[0]?.at ?? null;
}

async function receipts(pg: Pg, id: string): Promise<number> {
  const result = await pg.query<{ count: string }>(
    "select count(*)::text as count from public.webhook_receipts where provider = 'resend' and id = $1",
    [id],
  );
  return Number(result.rows[0]?.count);
}

/** The real client, except that `unsubscribe_email` answers an error, as an outage in the effect would. */
function failingEffect(): Db {
  const real = getDb();
  return new Proxy(real, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property !== "rpc" || typeof value !== "function") return value;
      return (name: unknown, ...rest: unknown[]): unknown =>
        name === "unsubscribe_email"
          ? Promise.resolve({ data: null, error: { message: "connection refused" } })
          : Reflect.apply(value, target, [name, ...rest]);
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/hooks/resend", () => {
  it("unsubscribes the recipient of a complaint and answers 200", async () => {
    const email = nextEmail();
    const id = nextId();
    const { status, at } = await run([email], [id], async (pg) => {
      const answer = await handlePublic(delivery(complaint(email), id), REQUEST_ID);
      return { status: answer.status, at: await unsubscribedAt(pg, email) };
    });
    expect(status).toBe(200);
    expect(at).not.toBeNull();
  });

  it("applies a replayed svix-id once", async () => {
    const email = nextEmail();
    const id = nextId();
    const body = complaint(email);
    const { statuses, at, count } = await run([email], [id], async (pg) => {
      const first = await handlePublic(delivery(body, id), REQUEST_ID);
      await pg.query("update public.subscribers set unsubscribed_at = null where email = $1", [
        email,
      ]);
      const replay = await handlePublic(delivery(body, id), REQUEST_ID);
      return {
        statuses: [first.status, replay.status],
        at: await unsubscribedAt(pg, email),
        count: await receipts(pg, id),
      };
    });
    expect(statuses).toEqual([200, 200]);
    expect(at).toBeNull();
    expect(count).toBe(1);
  });

  it("refuses a bad signature with 401 and changes nothing", async () => {
    const email = nextEmail();
    const id = nextId();
    const { status, at, count } = await run([email], [id], async (pg) => {
      const forged = sign(id, "1", complaint(email));
      const answer = await handlePublic(
        delivery(complaint(email), id, { signature: forged }),
        REQUEST_ID,
      );
      return {
        status: answer.status,
        at: await unsubscribedAt(pg, email),
        count: await receipts(pg, id),
      };
    });
    expect(status).toBe(401);
    expect(at).toBeNull();
    expect(count).toBe(0);
  });

  it("refuses a svix-timestamp 301 seconds old with 401 and takes one 290 seconds old", async () => {
    const email = nextEmail();
    const [stale, recent] = [nextId(), nextId()];
    const statuses = await run([email], [stale, recent], async () => [
      (await handlePublic(delivery(complaint(email), stale, { ageSeconds: 301 }), REQUEST_ID))
        .status,
      (await handlePublic(delivery(complaint(email), recent, { ageSeconds: 290 }), REQUEST_ID))
        .status,
    ]);
    expect(statuses).toEqual([401, 200]);
  });

  it("answers 500 when the effect fails and keeps no receipt, so Resend's retry applies it", async () => {
    const email = nextEmail();
    const id = nextId();
    const { status, count, retried, at } = await run([email], [id], async (pg) => {
      const answer = await handlePublic(
        delivery(complaint(email), id),
        REQUEST_ID,
        failingEffect(),
      );
      const count = await receipts(pg, id);
      const retry = await handlePublic(delivery(complaint(email), id), REQUEST_ID);
      return {
        status: answer.status,
        count,
        retried: retry.status,
        at: await unsubscribedAt(pg, email),
      };
    });
    expect(status).toBe(500);
    expect(count).toBe(0);
    expect(retried).toBe(200);
    expect(at).not.toBeNull();
  });

  it("answers 503 unavailable while the signing secret is unset", async () => {
    const email = nextEmail();
    const id = nextId();
    const saved = env.RESEND_WEBHOOK_SECRET;
    env.RESEND_WEBHOOK_SECRET = undefined;
    try {
      const { status, code } = await run([email], [id], async () => {
        const answer = await handlePublic(delivery(complaint(email), id), REQUEST_ID);
        const body = z.object({ error: z.object({ code: z.string() }) }).parse(await answer.json());
        return { status: answer.status, code: body.error.code };
      });
      expect(status).toBe(503);
      expect(code).toBe("unavailable");
    } finally {
      env.RESEND_WEBHOOK_SECRET = saved;
    }
  });

  it("makes a confirm link sent before a complaint answer confirmed=0 (DL-06 c)", async () => {
    const email = `complaint+${randomUUID()}@example.invalid`;
    const ip = "198.18.250.2";
    const id = nextId();
    const keys = await Promise.all(
      [ip, email].map((value) => hashKey(process.env["RATE_LIMIT_SALT"] ?? "", value)),
    );
    const tokens: Uint8Array[] = [];
    const original = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, "getRandomValues").mockImplementation(
      <T extends ArrayBufferView | null>(array: T): T => {
        const filled = original(array);
        if (filled instanceof Uint8Array && filled.length === 32) tokens.push(filled.slice());
        return filled;
      },
    );
    const location = await committed(
      async () => {
        await handlePublic(
          new Request("http://localhost/api/public/subscribers", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": ip,
              "x-turnstile-token": TEST_TURNSTILE_TOKEN,
            },
            body: JSON.stringify({ email, source: "stories" }),
          }),
          REQUEST_ID,
        );
        await handlePublic(delivery(complaint(email), id), REQUEST_ID);
        const token = Buffer.from(tokens[0] ?? []).toString("base64url");
        const answer = await handlePublic(
          new Request(`http://localhost/api/public/subscribers/confirm?token=${token}`, {
            headers: { "cf-connecting-ip": ip },
          }),
          REQUEST_ID,
        );
        return answer.headers.get("location");
      },
      async (pg) => {
        await pg.query("begin");
        await pg.query("select set_config('mop.retention', 'on', true)");
        await pg.query("delete from public.subscribers where email = $1", [email]);
        await pg.query("delete from public.email_suppressions where email = $1", [email]);
        await pg.query("delete from public.email_events where provider_event_id = $1", [id]);
        await pg.query(
          "delete from public.webhook_receipts where provider = 'resend' and id = $1",
          [id],
        );
        await pg.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
        await pg.query("commit");
      },
    );
    expect(tokens).toHaveLength(1);
    expect(location).toBe("/place-notes?confirmed=0");
  });
});
