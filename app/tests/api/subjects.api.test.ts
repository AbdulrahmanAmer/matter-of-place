// POST /subjects/request (GP-01) through `handlePublic` against mop-dev (CI's stack in the `db` job). Committed
// mode: every case removes its requests, its subscribers and the rate-limit hits of its addresses afterwards.
import "./env";
import { TEST_TURNSTILE_TOKEN } from "./env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { receiptSchema } from "../../src/domain/contracts";
import { hashKey } from "../../src/server/lib/ids";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, dbNow, type Db as Pg } from "../fixtures/db";

const REQUEST_ID = "req-api-subjects-0001";

let ipCounter = 0;
const nextIp = () =>
  `198.20.${String(Math.floor(Math.random() * 200) + 20)}.${String((ipCounter += 1))}`;
const nextEmail = () => `subject+${randomUUID()}@example.invalid`;

function post(body: unknown, ip: string, token: string | null = TEST_TURNSTILE_TOKEN) {
  const headers = new Headers({ "content-type": "application/json", "cf-connecting-ip": ip });
  if (token !== null) headers.set("x-turnstile-token", token);
  return new Request("http://localhost/api/public/subjects/request", {
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

/** Runs `fn` committed, then removes the test's requests, subscribers and rate-limit hits. */
async function run<T>(ips: string[], emails: string[], fn: (pg: Pg) => Promise<T>): Promise<T> {
  const keys = await Promise.all(
    [...ips, ...emails].map((value) => hashKey(salt(), value.toLowerCase())),
  );
  return committed(fn, async (pg) => {
    await pg.query("begin");
    await pg.query("select set_config('mop.retention', 'on', true)");
    await pg.query(
      "delete from public.events where entity_id in (select id from public.subject_requests where email = any ($1))",
      [emails],
    );
    await pg.query("delete from public.subject_requests where email = any ($1)", [emails]);
    await pg.query("delete from public.subscribers where email = any ($1)", [emails]);
    await pg.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
    await pg.query("commit");
  });
}

const rowSchema = z.object({ kind: z.string(), status: z.string(), gap: z.string() });

async function rowsFor(pg: Pg, email: string) {
  const result = await pg.query(
    "select kind, status, (due_at - received_at)::text as gap from public.subject_requests where email = $1",
    [email],
  );
  return z.array(rowSchema).parse(result.rows);
}

const eventSchema = z.object({ entity_id: z.string(), payload: z.unknown() });

/** The `subject_request.received` events written since `since`; the write function emits them (G29). */
async function eventsSince(pg: Pg, since: Date) {
  const result = await pg.query(
    "select entity_id, payload from public.events where type = 'subject_request.received' and at >= $1",
    [since],
  );
  return z.array(eventSchema).parse(result.rows);
}

/** The id of the address's one request. */
async function requestId(pg: Pg, email: string): Promise<string> {
  const result = await pg.query("select id from public.subject_requests where email = $1", [email]);
  return z.tuple([z.object({ id: z.string() })]).parse(result.rows)[0].id;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/public/subjects/request", () => {
  it("answers 201 with a Receipt and stores one received request due in 45 days", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { response, rows, id, emitted } = await run([ip], [email], async (pg) => {
      const since = await dbNow(pg);
      const answer = await handlePublic(
        post({ email, kind: "access", note: "My data" }, ip),
        REQUEST_ID,
      );
      return {
        response: answer,
        rows: await rowsFor(pg, email),
        id: await requestId(pg, email),
        emitted: await eventsSince(pg, since),
      };
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    receiptSchema.parse(await response.json());
    expect(rows).toEqual([{ kind: "access", status: "received", gap: "45 days" }]);
    expect(emitted.filter((event) => event.entity_id === id)).toEqual([
      { entity_id: id, payload: { request_id: id, kind: "access" } },
    ]);
  });

  it("answers the same Receipt shape whether or not any data is on file", async () => {
    const ip = nextIp();
    const [known, unknown] = [nextEmail(), nextEmail()];
    const bodies = await run([ip], [known, unknown], async (pg) => {
      await pg.query("insert into public.subscribers (email, source) values ($1, 'stories')", [
        known,
      ]);
      const answers = [
        await handlePublic(post({ email: known, kind: "deletion" }, ip), REQUEST_ID),
        await handlePublic(post({ email: unknown, kind: "deletion" }, ip), REQUEST_ID),
      ];
      return Promise.all(
        answers.map(async (answer) => ({
          status: answer.status,
          body: z.record(z.string(), z.unknown()).parse(await answer.json()),
        })),
      );
    });
    expect(bodies.map(({ status }) => status)).toEqual([201, 201]);
    expect(bodies.map(({ body }) => Object.keys(body).sort())).toEqual([
      ["id", "receivedAt"],
      ["id", "receivedAt"],
    ]);
  });

  it("takes a correction request as its own kind (G29)", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { status, rows } = await run([ip], [email], async (pg) => {
      const answer = await handlePublic(post({ email, kind: "correction" }, ip), REQUEST_ID);
      return { status: answer.status, rows: await rowsFor(pg, email) };
    });
    expect(status).toBe(201);
    expect(rows.map((row) => row.kind)).toEqual(["correction"]);
  });

  it("refuses kind sell with 422 and writes no row", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { status, rows } = await run([ip], [email], async (pg) => {
      const answer = await handlePublic(post({ email, kind: "sell" }, ip), REQUEST_ID);
      return { status: answer.status, rows: await rowsFor(pg, email) };
    });
    expect(status).toBe(422);
    expect(rows).toEqual([]);
  });

  it("refuses the 4th request in a day from one IP with 429", async () => {
    const ip = nextIp();
    const emails = Array.from({ length: 4 }, nextEmail);
    const statuses = await run([ip], emails, async () => {
      const answers: number[] = [];
      for (const email of emails) {
        answers.push((await handlePublic(post({ email, kind: "access" }, ip), REQUEST_ID)).status);
      }
      return answers;
    });
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it("refuses the 3rd request in a day for one email, whatever the IP", async () => {
    const ips = Array.from({ length: 3 }, nextIp);
    const email = nextEmail();
    const statuses = await run(ips, [email], async () => {
      const answers: number[] = [];
      for (const ip of ips) {
        answers.push((await handlePublic(post({ email, kind: "opt_out" }, ip), REQUEST_ID)).status);
      }
      return answers;
    });
    expect(statuses).toEqual([201, 201, 429]);
  });

  it("refuses a request without a Turnstile token with 403 and writes nothing", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { status, rows } = await run([ip], [email], async (pg) => {
      const answer = await handlePublic(post({ email, kind: "access" }, ip, null), REQUEST_ID);
      return { status: answer.status, rows: await rowsFor(pg, email) };
    });
    expect(status).toBe(403);
    expect(rows).toEqual([]);
  });

  it("writes the address into no log line", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const lines: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
    }
    const status = await run([ip], [email], async () => {
      const answer = await handlePublic(post({ email, kind: "access" }, ip), REQUEST_ID);
      return answer.status;
    });
    expect(status).toBe(201);
    expect(lines.some((line) => line.includes('"event":"request"'))).toBe(true);
    expect(lines.filter((line) => line.includes(email))).toEqual([]);
  });

  it("answers a filled website field with 201 and writes no row", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { status, rows, emitted } = await run([ip], [email], async (pg) => {
      const since = await dbNow(pg);
      const answer = await handlePublic(
        post({ email, kind: "access", website: "https://spam.example" }, ip),
        REQUEST_ID,
      );
      return {
        status: answer.status,
        rows: await rowsFor(pg, email),
        emitted: await eventsSince(pg, since),
      };
    });
    expect(status).toBe(201);
    expect(rows).toEqual([]);
    expect(emitted).toEqual([]);
  });
});
