// POST /inquiries through `handlePublic` against mop-dev (CI's stack in the `db` job). Committed mode: the rows are
// written by supabase-js on its own connection, so every case removes its rows and its rate-limit hits afterwards.
import "./env";
import { TEST_TURNSTILE_TOKEN } from "./env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { receiptSchema } from "../../src/domain/contracts";
import { hashKey } from "../../src/server/lib/ids";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, dbNow, type Db as Pg } from "../fixtures/db";
import { fakeDb } from "../fixtures/fake-db";

const REQUEST_ID = "req-api-inquiries-0001";
const SOURCE = "/__test";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let ipCounter = 0;
const nextIp = () =>
  `198.18.${String(Math.floor(Math.random() * 200) + 20)}.${String((ipCounter += 1))}`;
const nextEmail = () => `inquiry+${randomUUID()}@example.invalid`;

const inquiry = (email: string, over: Record<string, unknown> = {}) => ({
  intent: "ask",
  name: "Test Visitor",
  email,
  message: "Is the garden open to the street?",
  sourcePath: SOURCE,
  ...over,
});

function post(body: unknown, ip: string, token: string | null = TEST_TURNSTILE_TOKEN) {
  const headers = new Headers({ "content-type": "application/json", "cf-connecting-ip": ip });
  if (token !== null) headers.set("x-turnstile-token", token);
  return new Request("http://localhost/api/public/inquiries", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const salt = (): string => {
  const value = process.env["RATE_LIMIT_SALT"];
  if (value === undefined) throw new Error("RATE_LIMIT_SALT is not set");
  return value;
};

/** Runs `fn` committed, then removes the test's inquiries and the rate-limit hits of its addresses and emails. */
async function run<T>(ips: string[], emails: string[], fn: (pg: Pg) => Promise<T>): Promise<T> {
  const keys = await Promise.all(
    [...ips, ...emails].map((value) => hashKey(salt(), value.toLowerCase())),
  );
  return committed(fn, async (pg) => {
    await pg.query("begin");
    await pg.query("select set_config('mop.retention', 'on', true)");
    await pg.query(
      "delete from public.events where entity_id in (select id from public.inquiries where source_path = $1)",
      [SOURCE],
    );
    await pg.query("delete from public.inquiries where source_path = $1", [SOURCE]);
    await pg.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
    await pg.query("commit");
  });
}

const rowSchema = z.object({
  intent: z.string(),
  source_path: z.string(),
  turnstile_ok: z.boolean(),
  ip_hash: z.string().nullable(),
  whole: z.string(),
});

async function rowsFor(pg: Pg, email: string) {
  const result = await pg.query(
    "select intent, source_path, turnstile_ok, ip_hash, row_to_json(i)::text as whole from public.inquiries i where email = $1",
    [email],
  );
  return z.array(rowSchema).parse(result.rows);
}

const eventSchema = z.object({ entity_id: z.string(), payload: z.unknown() });

/** The `inquiry.received` events written since `since`; the write function emits them in its own transaction (G49). */
async function eventsSince(pg: Pg, since: Date) {
  const result = await pg.query(
    "select entity_id, payload from public.events where type = 'inquiry.received' and at >= $1",
    [since],
  );
  return z.array(eventSchema).parse(result.rows);
}

/** Every JSON line the server logs while `fn` runs, from all three console levels. */
async function logged<T>(fn: () => Promise<T>): Promise<{ value: T; events: string[] }> {
  const lines: string[] = [];
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  }
  const value = await fn();
  const events = lines.flatMap((line) => {
    if (!line.startsWith("{")) return [];
    const parsed = z.object({ event: z.string() }).safeParse(JSON.parse(line));
    return parsed.success ? [parsed.data.event] : [];
  });
  return { value, events };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/public/inquiries", () => {
  it("answers 201 with a Receipt and stores one row with a hashed address and no raw IP", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { response, rows, events, emitted } = await run([ip], [email], async (pg) => {
      const since = await dbNow(pg);
      const { value, events } = await logged(() =>
        handlePublic(post(inquiry(email, { intent: "showing" }), ip), REQUEST_ID),
      );
      return {
        response: value,
        rows: await rowsFor(pg, email),
        events,
        emitted: await eventsSince(pg, since),
      };
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const receipt = receiptSchema.parse(await response.json());
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.intent).toBe("showing");
    expect(row?.source_path).toBe(SOURCE);
    expect(row?.turnstile_ok).toBe(true);
    expect(row?.ip_hash).toBe(await hashKey(salt(), ip));
    expect(row?.whole).not.toContain(ip);
    expect(row?.whole).toContain(receipt.id);
    expect(events).not.toContain("event_pending");
    expect(emitted.filter((event) => event.entity_id === receipt.id)).toEqual([
      { entity_id: receipt.id, payload: { inquiry_id: receipt.id } },
    ]);
  });

  it("stores the posted attribution, and '{}' when the body has none (B15)", async () => {
    const ip = nextIp();
    const [withIt, without] = [nextEmail(), nextEmail()];
    const { statuses, stored } = await run([ip], [withIt, without], async (pg) => {
      const answers = [
        await handlePublic(
          post(inquiry(withIt, { attribution: { first_touch: { utm_source: "test" } } }), ip),
          REQUEST_ID,
        ),
        await handlePublic(post(inquiry(without), ip), REQUEST_ID),
      ];
      const result = await pg.query(
        `select email, attribution->'first_touch'->>'utm_source' as utm_source, attribution::text as attribution
         from public.inquiries where email = any ($1) order by email = $2 desc`,
        [[withIt, without], withIt],
      );
      return {
        statuses: answers.map((answer) => answer.status),
        stored: z
          .array(
            z.object({
              email: z.string(),
              utm_source: z.string().nullable(),
              attribution: z.string(),
            }),
          )
          .parse(result.rows),
      };
    });
    expect(statuses).toEqual([201, 201]);
    expect(stored).toEqual([
      { email: withIt, utm_source: "test", attribution: '{"first_touch": {"utm_source": "test"}}' },
      { email: without, utm_source: null, attribution: "{}" },
    ]);
  });

  it("refuses a request without a Turnstile token with 403 and writes nothing", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { status, rows } = await run([ip], [email], async (pg) => {
      const response = await handlePublic(post(inquiry(email), ip, null), REQUEST_ID);
      return { status: response.status, rows: await rowsFor(pg, email) };
    });
    expect(status).toBe(403);
    expect(rows).toEqual([]);
  });

  it("accepts the write flagged when Turnstile is unreachable and logs turnstile_unreachable", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return url === SITEVERIFY
        ? Promise.reject(new TypeError("fetch failed"))
        : realFetch(input, init);
    });
    const { status, rows, events } = await run([ip], [email], async (pg) => {
      const { value, events } = await logged(() =>
        handlePublic(post(inquiry(email), ip), REQUEST_ID),
      );
      return { status: value.status, rows: await rowsFor(pg, email), events };
    });
    expect(status).toBe(201);
    expect(rows.map((row) => row.turnstile_ok)).toEqual([false]);
    expect(events).toContain("turnstile_unreachable");
  });

  it("answers a filled website field with 201, writes no row and emits no event", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { response, rows, events, emitted } = await run([ip], [email], async (pg) => {
      const since = await dbNow(pg);
      const { value, events } = await logged(() =>
        handlePublic(post({ ...inquiry(email), website: "https://spam.example" }, ip), REQUEST_ID),
      );
      return {
        response: value,
        rows: await rowsFor(pg, email),
        events,
        emitted: await eventsSince(pg, since),
      };
    });
    expect(response.status).toBe(201);
    receiptSchema.parse(await response.json());
    expect(rows).toEqual([]);
    expect(emitted).toEqual([]);
    expect(events).toContain("honeypot");
    expect(events).not.toContain("event_pending");
  });

  it("rejects a schema failure with 422 and writes nothing", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { status, rows } = await run([ip], [email], async (pg) => {
      const response = await handlePublic(post(inquiry(email, { message: "" }), ip), REQUEST_ID);
      return { status: response.status, rows: await rowsFor(pg, email) };
    });
    expect(status).toBe(422);
    expect(rows).toEqual([]);
  });

  it("refuses the 11th inquiry from one IP within the hour with 429 and Retry-After", async () => {
    const ip = nextIp();
    const emails = Array.from({ length: 11 }, nextEmail);
    const responses = await run([ip], emails, async () => {
      const answers: Response[] = [];
      for (const email of emails) {
        answers.push(await handlePublic(post(inquiry(email), ip), REQUEST_ID));
      }
      return answers;
    });
    expect(responses.slice(0, 10).map((response) => response.status)).toEqual(
      Array.from({ length: 10 }, () => 201),
    );
    expect(responses[10]?.status).toBe(429);
    expect(Number(responses[10]?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses the 6th inquiry from one email within the hour, whatever the IP", async () => {
    const ips = Array.from({ length: 6 }, nextIp);
    const email = nextEmail();
    const statuses = await run(ips, [email], async () => {
      const answers: number[] = [];
      for (const ip of ips) {
        answers.push((await handlePublic(post(inquiry(email), ip), REQUEST_ID)).status);
      }
      return answers;
    });
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("answers 503 unavailable when the database refuses the write, and no row exists", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const failing = fakeDb({
      rpc: {
        rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        create_inquiry: () => new Error("connection refused"),
      },
    });
    const { response, rows } = await run([ip], [email], async (pg) => {
      const answer = await handlePublic(post(inquiry(email), ip), REQUEST_ID, failing);
      return { response: answer, rows: await rowsFor(pg, email) };
    });
    expect(response.status).toBe(503);
    expect(
      z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code,
    ).toBe("unavailable");
    expect(rows).toEqual([]);
  });
});
