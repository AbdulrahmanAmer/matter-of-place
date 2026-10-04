// POST /submissions and POST /submissions/:id/uploads through `handlePublic` against mop-dev (CI's stack in the `db`
// job), with real signing calls to the private `submissions` bucket. Committed mode: every case removes its
// submissions, their contacts and the rate-limit hits of its addresses and emails afterwards.
import "./env";
import { TEST_TURNSTILE_TOKEN } from "./env";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { currentRightsVersion } from "../../src/domain/contracts";
import { hashKey } from "../../src/server/lib/ids";
import { handlePublic } from "../../src/server/public/pipeline";
import { uploadToken } from "../../src/server/submissions/upload-token";
import { committed, dbNow, type Db as Pg } from "../fixtures/db";
import { fakeDb } from "../fixtures/fake-db";
import { serviceClient } from "../fixtures/service";

const REQUEST_ID = "req-api-submissions-0001";
const SOURCE = "/__test";
const BASE = "http://localhost/api/public";
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

let ipCounter = 0;
const nextIp = () =>
  `198.19.${String(Math.floor(Math.random() * 200) + 20)}.${String((ipCounter += 1))}`;
const nextEmail = () => `submission+${randomUUID()}@example.invalid`;

interface Media {
  name: string;
  size: number;
  type: string;
}

const photos = (count: number, type = "image/jpeg"): Media[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `photo-${String(index + 1)}.jpg`,
    size: 1000 + index,
    type,
  }));

const submission = (email: string, over: Record<string, unknown> = {}) => ({
  address: `${String(Math.floor(Math.random() * 9000) + 100)} Test Lane`,
  city: "Malibu",
  state: "California",
  zip: "90265",
  currency: "USD",
  propertyType: "Residence",
  submitterKind: "agent",
  submitterName: "Ada Test",
  submitterEmail: email,
  brokerage: "Test Realty",
  story: "Built into the cliff in 1962 and kept by one family since.",
  significance: "An early example of the coastal modern house.",
  package: "Not sure yet",
  rightsConfirmed: true,
  media: photos(1),
  sourcePath: SOURCE,
  ...over,
});

function post(path: string, body: unknown, ip: string) {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      "x-turnstile-token": TEST_TURNSTILE_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

const send = (body: unknown, ip: string) =>
  handlePublic(post("/submissions", body, ip), REQUEST_ID);
const signMore = (id: string, body: unknown, ip: string) =>
  handlePublic(post(`/submissions/${id}/uploads`, body, ip), REQUEST_ID);

const entrySchema = z.object({
  media_id: z.string(),
  index: z.number(),
  url: z.string().optional(),
  thumb_url: z.string().optional(),
});
const receiptSchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  upload_token: z.string(),
  uploads: z.array(entrySchema),
});
const moreSchema = z.object({
  uploads: z.array(z.object({ media_id: z.string(), url: z.string(), thumb_url: z.string() })),
});
const errorCode = async (response: Response) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code;

const salt = (): string => {
  const value = process.env["RATE_LIMIT_SALT"];
  if (value === undefined) throw new Error("RATE_LIMIT_SALT is not set");
  return value;
};

/** Runs `fn` committed, then removes the test's submissions, their contacts and its rate-limit hits. */
async function run<T>(ips: string[], emails: string[], fn: (pg: Pg) => Promise<T>): Promise<T> {
  const keys = await Promise.all(
    [...ips, ...emails].map((value) => hashKey(salt(), value.toLowerCase())),
  );
  return committed(fn, async (pg) => {
    await pg.query("begin");
    await pg.query("select set_config('mop.retention', 'on', true)");
    await pg.query(
      "delete from public.events where entity_id in (select id from public.submissions where source_path = $1)",
      [SOURCE],
    );
    await pg.query("delete from public.submissions where source_path = $1", [SOURCE]);
    await pg.query("delete from public.contacts where lower(email) = any ($1)", [
      emails.map((email) => email.toLowerCase()),
    ]);
    await pg.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
    await pg.query("commit");
  });
}

const mediaRowSchema = z.object({
  id: z.string(),
  storage_path: z.string(),
  sort_order: z.number(),
});

async function mediaRows(pg: Pg, submissionId: string) {
  const result = await pg.query(
    "select id, storage_path, sort_order from public.submission_media where submission_id = $1 order by sort_order",
    [submissionId],
  );
  return z.array(mediaRowSchema).parse(result.rows);
}

const submissionRowSchema = z.object({
  id: z.string(),
  submitter_kind: z.string(),
  contact_id: z.string().nullable(),
  duplicate_of: z.string().nullable(),
  listed_with_agent: z.boolean().nullable(),
  listing_agent_name: z.string().nullable(),
  rights_version: z.string(),
  rights_confirmed_at: z.date(),
  rights_ip_hash: z.string(),
});

async function submissionsOf(pg: Pg, email: string) {
  const result = await pg.query(
    `select id, submitter_kind, contact_id, duplicate_of, listed_with_agent, listing_agent_name, rights_version,
       rights_confirmed_at, rights_ip_hash
     from public.submissions where lower(submitter_email) = lower($1) order by received_at`,
    [email],
  );
  return z.array(submissionRowSchema).parse(result.rows);
}

const eventSchema = z.object({ entity_id: z.string(), payload: z.unknown() });

/** The `submission.received` events written since `since`; `create_submission` emits them in its transaction (G20). */
async function eventsSince(pg: Pg, since: Date) {
  const result = await pg.query(
    "select entity_id, payload from public.events where type = 'submission.received' and at >= $1",
    [since],
  );
  return z.array(eventSchema).parse(result.rows);
}

const contactSchema = z.object({
  id: z.string(),
  kind: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  brokerage: z.string().nullable(),
});

async function contactsOf(pg: Pg, email: string) {
  const result = await pg.query(
    "select id, kind, email, name, phone, brokerage from public.contacts where lower(email) = lower($1)",
    [email],
  );
  return z.array(contactSchema).parse(result.rows);
}

describe("POST /api/public/submissions", () => {
  it("stores the submission and one media row per entry, indexed in posted order under its own path", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const media = [
      { name: "a.jpg", size: 10, type: "image/jpeg" },
      { name: "b.png", size: 20, type: "image/png" },
      { name: "c.heic", size: 30, type: "image/heic" },
      { name: "d.webp", size: 40, type: "image/webp" },
    ];
    const { receipt, rows, emitted } = await run([ip], [email], async (pg) => {
      const since = await dbNow(pg);
      const response = await send(submission(email, { media }), ip);
      expect(response.status).toBe(201);
      const body = receiptSchema.parse(await response.json());
      return {
        receipt: body,
        rows: await mediaRows(pg, body.id),
        emitted: await eventsSince(pg, since),
      };
    });
    expect(emitted.filter((event) => event.entity_id === receipt.id)).toEqual([
      { entity_id: receipt.id, payload: { submission_id: receipt.id } },
    ]);
    expect(receipt.uploads).toHaveLength(media.length);
    expect(receipt.uploads.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
    expect(rows.map((row) => row.id)).toEqual(receipt.uploads.map((entry) => entry.media_id));
    expect(rows.map((row) => row.storage_path)).toEqual(
      ["jpg", "png", "heic", "webp"].map(
        (ext, index) => `${receipt.id}/${receipt.uploads[index]?.media_id ?? ""}.${ext}`,
      ),
    );
  });

  it("signs the first 10 of 40 photographs with their path and thumbnail, and returns an upload token", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const { receipt, rows } = await run([ip], [email], async (pg) => {
      const response = await send(submission(email, { media: photos(40) }), ip);
      expect(response.status).toBe(201);
      const body = receiptSchema.parse(await response.json());
      return { receipt: body, rows: await mediaRows(pg, body.id) };
    });
    expect(receipt.upload_token).toMatch(/^\d+\.[\w-]+$/);
    expect(receipt.uploads).toHaveLength(40);
    expect(
      receipt.uploads.map((entry, index) => [
        entry.url?.includes(rows[index]?.storage_path ?? "missing") ?? false,
        entry.thumb_url?.includes(`${receipt.id}/${entry.media_id}.thumb.jpg`) ?? false,
      ]),
    ).toEqual(receipt.uploads.map((_, index) => [index < 10, index < 10]));
    expect(
      receipt.uploads.slice(10).filter((entry) => "url" in entry || "thumb_url" in entry),
    ).toEqual([]);
  });

  it("signs 10 more on /uploads with the token, leaves out an uploaded one, and refuses a bad or expired token", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const outcome = await run([ip], [email], async () => {
      const first = receiptSchema.parse(
        await (await send(submission(email, { media: photos(21) }), ip)).json(),
      );
      const unsigned = first.uploads.slice(10).map((entry) => entry.media_id);
      const next = unsigned.slice(0, 10);
      const more = await signMore(
        first.id,
        { media_ids: next, upload_token: first.upload_token },
        ip,
      );
      const uploaded = unsigned[10] ?? "";
      const marked = await serviceClient().rpc("mark_media_uploaded", {
        p_media_id: uploaded,
        p_mime: "image/jpeg",
        p_sha256: "0".repeat(64),
      });
      const after = await signMore(
        first.id,
        { media_ids: [uploaded], upload_token: first.upload_token },
        ip,
      );
      const other = await signMore(
        randomUUID(),
        { media_ids: next, upload_token: first.upload_token },
        ip,
      );
      const flipped = first.upload_token.endsWith("A") ? "B" : "A";
      const altered = await signMore(
        first.id,
        { media_ids: next, upload_token: first.upload_token.slice(0, -1) + flipped },
        ip,
      );
      const expired = await signMore(
        first.id,
        {
          media_ids: next,
          upload_token: await uploadToken(first.id, Date.now() - TWO_HOURS_MS - 1000),
        },
        ip,
      );
      return { first, next, more, marked, after, other, altered, expired };
    });
    expect(outcome.more.status).toBe(200);
    const signed = moreSchema.parse(await outcome.more.json()).uploads;
    expect(signed.map((entry) => entry.media_id)).toEqual(outcome.next);
    for (const entry of signed) {
      expect(entry.url).toContain(`${outcome.first.id}/${entry.media_id}.jpg`);
      expect(entry.thumb_url).toContain(`${outcome.first.id}/${entry.media_id}.thumb.jpg`);
    }
    expect(outcome.marked.data).toBe(true);
    expect(outcome.after.status).toBe(200);
    expect(moreSchema.parse(await outcome.after.json()).uploads).toEqual([]);
    for (const refused of [outcome.other, outcome.altered, outcome.expired]) {
      expect(refused.status).toBe(403);
      expect(await errorCode(refused)).toBe("forbidden");
    }
  });

  it("refuses the 13th /uploads call from one IP within the hour", async () => {
    const ip = nextIp();
    const statuses = await run([ip], [], async () => {
      const answers: number[] = [];
      for (let call = 0; call < 13; call += 1) {
        const response = await signMore(
          randomUUID(),
          { media_ids: [randomUUID()], upload_token: "1.bad" },
          ip,
        );
        answers.push(response.status);
      }
      return answers;
    });
    expect(statuses.slice(0, 12)).toEqual(Array.from({ length: 12 }, () => 403));
    expect(statuses[12]).toBe(429);
  });

  it("answers 503 unavailable when a signing call fails", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const failing = fakeDb({
      rpc: {
        rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        create_submission: () => [
          {
            id: randomUUID(),
            received_at: new Date().toISOString(),
            media: [{ id: randomUUID(), index: 0, name: "a.jpg", storage_path: "x/y.jpg" }],
          },
        ],
      },
      storage: {
        submissions: {
          createSignedUploadUrl: () =>
            Promise.resolve({ data: null, error: new Error("storage down") }),
        },
      },
    });
    const response = await run([ip], [email], () =>
      handlePublic(post("/submissions", submission(email), ip), REQUEST_ID, failing),
    );
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("unavailable");
  });

  it("answers a second post within 10 minutes with the first submission's id", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const body = submission(email);
    const ids = await run([ip], [email], async () => {
      const first = receiptSchema.parse(await (await send(body, ip)).json());
      const second = receiptSchema.parse(await (await send(body, ip)).json());
      return [first.id, second.id];
    });
    expect(ids[1]).toBe(ids[0]);
  });

  it("refuses an entry over 25 MB, a GIF and 41 entries with 422, and accepts 40", async () => {
    const ips = Array.from({ length: 4 }, nextIp);
    const emails = Array.from({ length: 4 }, nextEmail);
    const at = (list: string[], index: number) => list[index] ?? "";
    const outcome = await run(ips, emails, async (pg) => {
      const big = await send(
        submission(at(emails, 0), {
          media: [{ name: "big.jpg", size: 26_214_401, type: "image/jpeg" }],
        }),
        at(ips, 0),
      );
      const gif = await send(
        submission(at(emails, 1), { media: photos(1, "image/gif") }),
        at(ips, 1),
      );
      const many = await send(submission(at(emails, 2), { media: photos(41) }), at(ips, 2));
      const forty = await send(submission(at(emails, 3), { media: photos(40) }), at(ips, 3));
      const refusedRows = [];
      for (const email of emails.slice(0, 3)) refusedRows.push(...(await submissionsOf(pg, email)));
      return {
        statuses: [big.status, gif.status, many.status, forty.status],
        refusedRows,
      };
    });
    expect(outcome.statuses).toEqual([422, 422, 422, 201]);
    expect(outcome.refusedRows).toEqual([]);
  });

  it("points a request for the same address and email 11 days later at the first, and not another address", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const body = submission(email);
    const rows = await run([ip], [email], async (pg) => {
      const first = await send(body, ip);
      const firstId = receiptSchema.parse(await first.json()).id;
      await pg.query(
        "update public.submissions set received_at = received_at - interval '11 days' where id = $1",
        [firstId],
      );
      const again = await send({ ...body, address: body.address.toUpperCase() }, ip);
      const elsewhere = await send({ ...body, address: "77 Other Road" }, ip);
      expect([first.status, again.status, elsewhere.status]).toEqual([201, 201, 201]);
      return submissionsOf(pg, email);
    });
    expect(rows).toHaveLength(3);
    expect(rows[1]?.duplicate_of).toBe(rows[0]?.id);
    expect(rows[2]?.duplicate_of).toBeNull();
  });

  it("links one contact per email: an agent first, then the same person as an owner keeps the kind and the brokerage", async () => {
    const ips = [nextIp(), nextIp()];
    const email = nextEmail();
    const outcome = await run(ips, [email], async (pg) => {
      const agent = await send(
        submission(email, { submitterPhone: "+1 310 555 0100" }),
        ips[0] ?? "",
      );
      const afterAgent = await contactsOf(pg, email);
      const owner = await send(
        submission(email.toUpperCase(), {
          submitterKind: "owner",
          submitterName: "Ada Owner",
          submitterPhone: "+1 310 555 0199",
          brokerage: undefined,
          address: "5 Second Street",
        }),
        ips[1] ?? "",
      );
      return {
        statuses: [agent.status, owner.status],
        afterAgent,
        contacts: await contactsOf(pg, email),
        rows: await submissionsOf(pg, email),
      };
    });
    expect(outcome.statuses).toEqual([201, 201]);
    expect(outcome.afterAgent.map((contact) => [contact.kind, contact.email])).toEqual([
      ["agent", email.toLowerCase()],
    ]);
    expect(outcome.contacts).toHaveLength(1);
    const [contact] = outcome.contacts;
    expect(outcome.rows.map((row) => row.contact_id)).toEqual([contact?.id, contact?.id]);
    expect(outcome.rows.map((row) => row.submitter_kind)).toEqual(["agent", "owner"]);
    expect(contact?.kind).toBe("agent");
    expect(contact?.name).toBe("Ada Owner");
    expect(contact?.phone).toBe("+1 310 555 0199");
    expect(contact?.brokerage).toBe("Test Realty");
  });

  it("refuses an agent without a brokerage with 422 and writes no row", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const outcome = await run([ip], [email], async (pg) => {
      const response = await send(submission(email, { brokerage: undefined }), ip);
      return { status: response.status, rows: await submissionsOf(pg, email) };
    });
    expect(outcome.status).toBe(422);
    expect(outcome.rows).toEqual([]);
  });

  it("stores an owner's listing agent with listed_with_agent", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const rows = await run([ip], [email], async (pg) => {
      const response = await send(
        submission(email, {
          submitterKind: "owner",
          brokerage: undefined,
          listedWithAgent: true,
          listingAgentName: "Lena Lister",
        }),
        ip,
      );
      expect(response.status).toBe(201);
      return submissionsOf(pg, email);
    });
    expect(rows.map((row) => [row.listed_with_agent, row.listing_agent_name])).toEqual([
      [true, "Lena Lister"],
    ]);
  });

  it("records the rights version, time and a hashed address, never the raw IP", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const rows = await run([ip], [email], async (pg) => {
      await send(submission(email), ip);
      return submissionsOf(pg, email);
    });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.rights_version).toBe(currentRightsVersion);
    expect(row?.rights_confirmed_at).toBeInstanceOf(Date);
    expect(row?.rights_ip_hash).toBe(await hashKey(salt(), ip));
    expect(row?.rights_ip_hash).not.toContain(ip);
  });

  it("answers a filled website field with 201 and writes no row", async () => {
    const ip = nextIp();
    const email = nextEmail();
    const outcome = await run([ip], [email], async (pg) => {
      const since = await dbNow(pg);
      const response = await send({ ...submission(email), website: "spam" }, ip);
      return {
        status: response.status,
        rows: await submissionsOf(pg, email),
        emitted: await eventsSince(pg, since),
      };
    });
    expect(outcome.status).toBe(201);
    expect(outcome.rows).toEqual([]);
    expect(outcome.emitted).toEqual([]);
  });
});
