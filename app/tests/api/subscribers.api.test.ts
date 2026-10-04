// POST /subscribers and GET /subscribers/confirm through `handlePublic` against mop-dev (CI's stack in the `db`
// job): the double opt-in of G12 and the merge rules of DL-06. Committed mode: every case removes its rows and its
// rate-limit hits afterwards. The raw confirm token is read where it is made, from `crypto.getRandomValues`.
import "./env";
import { TEST_TURNSTILE_TOKEN } from "./env";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { receiptSchema } from "../../src/domain/contracts";
import { toBase64Url } from "../../src/server/lib/crypto";
import { hashKey, sha256Hex } from "../../src/server/lib/ids";
import { handlePublic } from "../../src/server/public/pipeline";
import { committed, type Db as Pg } from "../fixtures/db";

const REQUEST_ID = "req-api-subscribers-0001";

let ipCounter = 0;
const nextIp = () =>
  `198.19.${String(Math.floor(Math.random() * 200) + 20)}.${String((ipCounter += 1))}`;
const nextEmail = () => `subscriber+${randomUUID()}@example.invalid`;

function post(body: unknown, ip: string) {
  return new Request("http://localhost/api/public/subscribers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      "x-turnstile-token": TEST_TURNSTILE_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

const click = (token: string, ip: string) =>
  handlePublic(
    new Request(
      `http://localhost/api/public/subscribers/confirm?token=${encodeURIComponent(token)}`,
      { headers: { "cf-connecting-ip": ip } },
    ),
    REQUEST_ID,
  );

const salt = (): string => {
  const value = process.env["RATE_LIMIT_SALT"];
  if (value === undefined) throw new Error("RATE_LIMIT_SALT is not set");
  return value;
};

/** Runs `fn` committed, then removes the test's subscribers and the rate-limit hits of its addresses and emails. */
async function run<T>(ips: string[], emails: string[], fn: (pg: Pg) => Promise<T>): Promise<T> {
  const keys = await Promise.all(
    [...ips, ...emails].map((value) => hashKey(salt(), value.toLowerCase())),
  );
  return committed(fn, async (pg) => {
    await pg.query("begin");
    await pg.query("select set_config('mop.retention', 'on', true)");
    await pg.query(
      "delete from public.events where entity_id in (select id from public.subscribers where email = any ($1))",
      [emails],
    );
    await pg.query("delete from public.subscribers where email = any ($1)", [emails]);
    await pg.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
    await pg.query("commit");
  });
}

const rowSchema = z.object({
  id: z.string(),
  source: z.string(),
  pending_source: z.string().nullable(),
  markets: z.array(z.string()),
  confirm_token_hash: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  unsubscribed_at: z.string().nullable(),
  archived_at: z.string().nullable(),
});

async function rowsFor(pg: Pg, email: string) {
  const result = await pg.query<{ whole: string }>(
    "select row_to_json(s)::text as whole from public.subscribers s where email = $1",
    [email],
  );
  return result.rows.map(({ whole }) => ({ ...rowSchema.parse(JSON.parse(whole)), whole }));
}

async function rowFor(pg: Pg, email: string) {
  const [row, ...rest] = await rowsFor(pg, email);
  if (row === undefined || rest.length > 0) throw new Error(`expected one row for ${email}`);
  return row;
}

const eventSchema = z.object({ type: z.string(), entity_id: z.string(), payload: z.unknown() });

/** The events of the address's row; `upsert_subscriber` and `confirm_subscriber` emit them in their transaction. */
async function eventsFor(pg: Pg, email: string) {
  const result = await pg.query(
    `select e.type, e.entity_id, e.payload from public.events e
     join public.subscribers s on s.id = e.entity_id where s.email = $1`,
    [email],
  );
  return z.array(eventSchema).parse(result.rows);
}

/** Every confirm token the requests make: `newToken` is 32 bytes of `crypto.getRandomValues`. */
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

const tokenAt = (tokens: string[], index: number): string => {
  const token = tokens[index];
  if (token === undefined) throw new Error(`no token number ${String(index)}`);
  return token;
};

const landing = (response: Response) => response.headers.get("location");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/public/subscribers", () => {
  it("merges two posts into one row with the union of markets and stores only a token hash", async () => {
    const email = nextEmail();
    const [first, second] = [nextIp(), nextIp()];
    const tokens = captureTokens();
    const { statuses, receipts, row } = await run([first, second], [email], async (pg) => {
      const answers = [
        await handlePublic(
          post({ email, source: "interest:california", markets: ["california"] }, first),
          REQUEST_ID,
        ),
        await handlePublic(
          post({ email, source: "interest:florida", markets: ["florida"] }, second),
          REQUEST_ID,
        ),
      ];
      return {
        statuses: answers.map((answer) => answer.status),
        receipts: await Promise.all(
          answers.map(async (answer) => receiptSchema.parse(await answer.json())),
        ),
        row: await rowFor(pg, email),
      };
    });
    expect(statuses).toEqual([201, 201]);
    expect(receipts[0]?.id).not.toBe(receipts[1]?.id);
    expect(row.markets).toEqual(["california", "florida"]);
    expect(tokens).toHaveLength(2);
    expect(row.confirm_token_hash).toBe(await sha256Hex(tokenAt(tokens, 1)));
    for (const token of tokens) expect(row.whole).not.toContain(token);
  });

  it("confirms on a valid token, clears the hash, and answers a reused or wrong token confirmed=0", async () => {
    const email = nextEmail();
    const ip = nextIp();
    const tokens = captureTokens();
    const { answers, row, events } = await run([ip], [email], async (pg) => {
      await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID);
      const token = tokenAt(tokens, 0);
      const valid = await click(token, ip);
      const reused = await click(token, ip);
      const wrong = await click(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, ip);
      const malformed = await click("not-a-token", ip);
      return {
        answers: [valid, reused, wrong, malformed],
        row: await rowFor(pg, email),
        events: await eventsFor(pg, email),
      };
    });
    // One `subscriber.confirmed` for the valid click, and no `subscriber.created` while `requestConfirmation` seals
    // nothing (B5's tests cover the sealed case).
    expect(events).toEqual([
      { type: "subscriber.confirmed", entity_id: row.id, payload: { subscriber_id: row.id } },
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([303, 303, 303, 303]);
    expect(answers.map(landing)).toEqual([
      "/stories?confirmed=1",
      "/stories?confirmed=0",
      "/stories?confirmed=0",
      "/stories?confirmed=0",
    ]);
    expect(answers[0]?.headers.get("cache-control")).toBe("no-store");
    expect(row.confirmed_at).not.toBeNull();
    expect(row.confirm_token_hash).toBeNull();
  });

  it("lets a Place Notes source replace an unconfirmed interest source, never the reverse", async () => {
    const [upgraded, kept] = [nextEmail(), nextEmail()];
    const ip = nextIp();
    const rows = await run([ip], [upgraded, kept], async (pg) => {
      await handlePublic(
        post({ email: upgraded, source: "interest:california", markets: ["california"] }, ip),
        REQUEST_ID,
      );
      await handlePublic(post({ email: upgraded, source: "stories" }, ip), REQUEST_ID);
      await handlePublic(post({ email: kept, source: "stories" }, ip), REQUEST_ID);
      await handlePublic(
        post({ email: kept, source: "interest:california", markets: ["california"] }, ip),
        REQUEST_ID,
      );
      return [await rowFor(pg, upgraded), await rowFor(pg, kept)];
    });
    expect(rows.map(({ source, markets }) => ({ source, markets }))).toEqual([
      { source: "stories", markets: ["california"] },
      { source: "stories", markets: ["california"] },
    ]);
  });

  it("holds a Place Notes source for a confirmed interest row until its own click (DL-06 a)", async () => {
    const email = nextEmail();
    const ip = nextIp();
    const tokens = captureTokens();
    const { pending, after } = await run([ip], [email], async (pg) => {
      await handlePublic(
        post({ email, source: "interest:california", markets: ["california"] }, ip),
        REQUEST_ID,
      );
      await click(tokenAt(tokens, 0), ip);
      await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID);
      const pending = await rowFor(pg, email);
      await click(tokenAt(tokens, 1), ip);
      return { pending, after: await rowFor(pg, email) };
    });
    expect(pending.source).toBe("interest:california");
    expect(pending.pending_source).toBe("stories");
    expect(pending.confirm_token_hash).toBe(await sha256Hex(tokenAt(tokens, 1)));
    expect(after.source).toBe("stories");
    expect(after.pending_source).toBeNull();
  });

  it("makes an unsubscribed address confirm again before it counts (DL-06 b)", async () => {
    const email = nextEmail();
    const ip = nextIp();
    const tokens = captureTokens();
    const { returning, after } = await run([ip], [email], async (pg) => {
      await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID);
      await click(tokenAt(tokens, 0), ip);
      await pg.query(
        "update public.subscribers set unsubscribed_at = now(), archived_at = now() where email = $1",
        [email],
      );
      await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID);
      const returning = await rowFor(pg, email);
      await click(tokenAt(tokens, 1), ip);
      return { returning, after: await rowFor(pg, email) };
    });
    expect(returning.confirmed_at).toBeNull();
    expect(returning.confirm_token_hash).toBe(await sha256Hex(tokenAt(tokens, 1)));
    expect(after).toMatchObject({ unsubscribed_at: null, archived_at: null });
    expect(after.confirmed_at).not.toBeNull();
  });

  it("accepts a hash set on an already confirmed row, as re-permission does, and confirms again", async () => {
    const email = nextEmail();
    const ip = nextIp();
    const tokens = captureTokens();
    const fresh = toBase64Url(new Uint8Array(32).fill(7));
    const { status, location, before, after } = await run([ip], [email], async (pg) => {
      await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID);
      await click(tokenAt(tokens, 0), ip);
      await pg.query(
        "update public.subscribers set confirmed_at = now() - interval '400 days', confirm_token_hash = $2 where email = $1",
        [email, await sha256Hex(fresh)],
      );
      const before = await rowFor(pg, email);
      const answer = await click(fresh, ip);
      return {
        status: answer.status,
        location: landing(answer),
        before,
        after: await rowFor(pg, email),
      };
    });
    expect(status).toBe(303);
    expect(location).toBe("/stories?confirmed=1");
    expect(Date.parse(after.confirmed_at ?? "")).toBeGreaterThan(
      Date.parse(before.confirmed_at ?? ""),
    );
    expect(after.confirm_token_hash).toBeNull();
  });

  it("gives a confirmed address no new link for another post of the same kind", async () => {
    const [newsletter, interest] = [nextEmail(), nextEmail()];
    const ip = nextIp();
    const tokens = captureTokens();
    const rows = await run([ip], [newsletter, interest], async (pg) => {
      await handlePublic(post({ email: newsletter, source: "stories" }, ip), REQUEST_ID);
      await click(tokenAt(tokens, 0), ip);
      await handlePublic(post({ email: newsletter, source: "home" }, ip), REQUEST_ID);
      await handlePublic(
        post({ email: interest, source: "interest:california", markets: ["california"] }, ip),
        REQUEST_ID,
      );
      await click(tokenAt(tokens, 2), ip);
      await handlePublic(
        post({ email: interest, source: "interest:florida", markets: ["florida"] }, ip),
        REQUEST_ID,
      );
      return [await rowFor(pg, newsletter), await rowFor(pg, interest)];
    });
    expect(rows.map((row) => row.confirm_token_hash)).toEqual([null, null]);
    expect(rows.map((row) => row.source)).toEqual(["stories", "interest:california"]);
    expect(rows[1]?.markets).toEqual(["california", "florida"]);
  });

  it("writes no event_pending line and logs neither the address nor the token", async () => {
    const email = nextEmail();
    const ip = nextIp();
    const tokens = captureTokens();
    const lines: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
    }
    const status = await run([ip], [email], async () => {
      const answer = await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID);
      return answer.status;
    });
    expect(status).toBe(201);
    expect(lines.some((line) => line.includes('"event":"request"'))).toBe(true);
    expect(lines.filter((line) => line.includes("event_pending"))).toEqual([]);
    expect(
      lines.filter((line) => line.includes(email) || line.includes(tokenAt(tokens, 0))),
    ).toEqual([]);
  });

  it("refuses a market outside the three with 422 and writes nothing", async () => {
    const email = nextEmail();
    const ip = nextIp();
    const { status, rows } = await run([ip], [email], async (pg) => {
      const answer = await handlePublic(
        post({ email, source: "home", markets: ["texas"] }, ip),
        REQUEST_ID,
      );
      return { status: answer.status, rows: await rowsFor(pg, email) };
    });
    expect(status).toBe(422);
    expect(rows).toEqual([]);
  });

  it("refuses the 4th signup for one email within the hour, whatever the IP", async () => {
    const ips = Array.from({ length: 4 }, nextIp);
    const email = nextEmail();
    const statuses = await run(ips, [email], async () => {
      const answers: number[] = [];
      for (const ip of ips) {
        answers.push(
          (await handlePublic(post({ email, source: "stories" }, ip), REQUEST_ID)).status,
        );
      }
      return answers;
    });
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});
