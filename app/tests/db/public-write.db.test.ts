// B3's write functions called directly over pg, each case inside one rolled-back transaction, so a registered `sql`
// mutation (MOP_MUTATION_SQL) replaces a function body for that case only (T-07).
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

const ADDRESS = "1 Test Way";

function submission(email: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: ADDRESS,
    city: "Berkeley",
    state: "California",
    zip: "94702",
    property_type: "Residence",
    submitter_kind: "agent",
    submitter_name: "Test Agent",
    submitter_email: email,
    brokerage: "Test Brokerage",
    story: "x",
    significance: "x",
    package: "The Feature",
    source_path: "/__test",
    rights_version: "test-v1",
    rights_confirmed_at: "2026-10-01T00:00:00Z",
    rights_ip_hash: "test-hash",
    media: [],
    ...extra,
  };
}

interface Created {
  id: string;
  media: { id: string; index: number; name: string; storage_path: string }[];
}

async function createSubmission(db: Db, payload: Record<string, unknown>): Promise<Created> {
  const result = await db.query<Created>("select id, media from public.create_submission($1)", [
    payload,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("create_submission returned no row");
  return row;
}

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row: ${sql}`);
  return row;
}

interface Subscriber {
  source: string;
  markets: string[];
  confirm_token_hash: string | null;
  pending_source: string | null;
  confirmed_at: Date | null;
  unsubscribed_at: Date | null;
  archived_at: Date | null;
  resend_contact_id: string | null;
}

const SUBSCRIBER = `select source, markets, confirm_token_hash, pending_source, confirmed_at, unsubscribed_at,
  archived_at, resend_contact_id from public.subscribers where email = $1`;

async function upsert(
  db: Db,
  email: string,
  source: string,
  hash: string,
  markets: string[] = [],
): Promise<void> {
  await db.query("select public.upsert_subscriber($1)", [
    { email, markets, source, confirm_token_hash: hash, sealed_token: null },
  ]);
}

const confirm = (db: Db, hash: string) =>
  one<{ id: string | null }>(db, "select public.confirm_subscriber($1) as id", [hash]);

describe("create_submission", () => {
  it("points a request for the same address 11 days later at the first one, and not a different address", async () => {
    const outcome = await withRollback(async (db) => {
      const email = "dup-agent@example.invalid";
      const first = await one<{ id: string }>(
        db,
        `insert into public.submissions (address, city, state, zip, property_type, submitter_kind, submitter_name,
           submitter_email, brokerage, story, significance, package, source_path, rights_version, rights_confirmed_at,
           rights_ip_hash, received_at)
         values ($1, 'Berkeley', 'California', '94702', 'Residence', 'agent', 'Test Agent', $2, 'Test Brokerage', 'x',
           'x', 'The Feature', '/__test', 'test-v1', now(), 'test-hash', now() - interval '11 days')
         returning id`,
        [ADDRESS, email],
      );
      const again = await createSubmission(
        db,
        submission(email.toUpperCase(), { address: " 1  test way " }),
      );
      const other = await createSubmission(db, submission(email, { address: "2 Other Road" }));
      const pointers = await db.query<{ id: string; duplicate_of: string | null }>(
        "select id, duplicate_of from public.submissions where id = any ($1)",
        [[again.id, other.id]],
      );
      const pointer = new Map(pointers.rows.map((row) => [row.id, row.duplicate_of]));
      return { first: first.id, again: pointer.get(again.id), other: pointer.get(other.id) };
    });
    expect(outcome.again).toBe(outcome.first);
    expect(outcome.other).toBeNull();
  });

  it("returns each media row with its 0-based index in payload order and a path from the declared type", async () => {
    const created = await withRollback((db) =>
      createSubmission(
        db,
        submission("order@example.invalid", {
          media: [
            { name: "image.jpg", size: 10, type: "image/jpeg" },
            { name: "image.jpg", size: 11, type: "image/png" },
            { name: "c.heic", size: 12, type: "image/heic" },
          ],
        }),
      ),
    );
    expect(created.media.map(({ index, name }) => [index, name])).toEqual([
      [0, "image.jpg"],
      [1, "image.jpg"],
      [2, "c.heic"],
    ]);
    const extensions = [".jpg", ".png", ".heic"];
    expect(created.media.map(({ storage_path }) => storage_path)).toEqual(
      created.media.map(({ id }, index) => `${created.id}/${id}${extensions[index] ?? ""}`),
    );
  });

  it("answers a second post within 10 minutes with the first request", async () => {
    const outcome = await withRollback(async (db) => {
      const payload = submission("double@example.invalid", {
        media: [{ name: "a.jpg", size: 10, type: "image/jpeg" }],
      });
      const first = await createSubmission(db, payload);
      const second = await createSubmission(db, payload);
      const rows = await one<{ count: number }>(
        db,
        "select count(*)::int as count from public.submissions where submitter_email = $1",
        ["double@example.invalid"],
      );
      return { first, second, rows: rows.count };
    });
    expect(outcome.second).toEqual(outcome.first);
    expect(outcome.rows).toBe(1);
  });

  it("links one contact per email, keeps its first kind and refreshes name and phone", async () => {
    const contact = await withRollback(async (db) => {
      await createSubmission(db, submission("person@example.invalid", { submitter_phone: "111" }));
      await createSubmission(
        db,
        submission("Person@Example.invalid", {
          address: "9 Second Street",
          submitter_kind: "owner",
          submitter_name: "New Name",
          submitter_phone: "222",
          brokerage: null,
        }),
      );
      const contacts = await db.query<{
        kind: string;
        name: string;
        phone: string;
        brokerage: string;
        linked: number;
      }>(
        `select c.kind::text as kind, c.name, c.phone, c.brokerage,
           (select count(*)::int from public.submissions s where s.contact_id = c.id) as linked
         from public.contacts c where lower(c.email) = 'person@example.invalid'`,
      );
      return contacts.rows;
    });
    expect(contact).toEqual([
      { kind: "agent", name: "New Name", phone: "222", brokerage: "Test Brokerage", linked: 2 },
    ]);
  });

  it("refuses more than 40 media entries with validation", async () => {
    const media = Array.from({ length: 41 }, (_, index) => ({
      name: `${String(index)}.jpg`,
      size: 1,
      type: "image/jpeg",
    }));
    await expect(
      withRollback((db) => createSubmission(db, submission("many@example.invalid", { media }))),
    ).rejects.toMatchObject({ message: "validation", code: "22023" });
  });
});

describe("rate_limit_check", () => {
  it("writes no hit for any check when one check of the call fails", async () => {
    const outcome = await withRollback(async (db) => {
      await db.query(
        "insert into public.rate_limits (bucket, key_hash) values ('test:ip', 'test-full')",
      );
      const result = await one<{ allowed: boolean; retry_after: number }>(
        db,
        "select * from public.rate_limit_check($1)",
        [
          JSON.stringify([
            { bucket: "test:ip", key_hash: "test-full", limit: 1, window_seconds: 60 },
            { bucket: "test:email", key_hash: "test-fresh", limit: 5, window_seconds: 60 },
          ]),
        ],
      );
      const hits = await one<{ count: number }>(
        db,
        "select count(*)::int as count from public.rate_limits where key_hash in ('test-full', 'test-fresh')",
      );
      return { result, hits: hits.count };
    });
    expect(outcome).toEqual({ result: { allowed: false, retry_after: 60 }, hits: 1 });
  });
});

describe("upsert_subscriber (DL-06)", () => {
  it("lets a Place Notes source replace an interest source on an unconfirmed row, never the reverse", async () => {
    const rows = await withRollback(async (db) => {
      await upsert(db, "a@example.invalid", "interest:california", "test-h1", ["california"]);
      await upsert(db, "A@example.invalid", "stories", "test-h2");
      await upsert(db, "b@example.invalid", "stories", "test-h3");
      await upsert(db, "b@example.invalid", "interest:florida", "test-h4", ["florida"]);
      return [
        await one<Subscriber>(db, SUBSCRIBER, ["a@example.invalid"]),
        await one<Subscriber>(db, SUBSCRIBER, ["b@example.invalid"]),
      ];
    });
    expect(
      rows.map(({ source, markets, confirm_token_hash }) => ({
        source,
        markets,
        confirm_token_hash,
      })),
    ).toEqual([
      { source: "stories", markets: ["california"], confirm_token_hash: "test-h2" },
      { source: "stories", markets: ["florida"], confirm_token_hash: "test-h4" },
    ]);
  });

  it("parks a Place Notes source of a confirmed interest-only address in pending_source with a new hash", async () => {
    const row = await withRollback(async (db) => {
      await upsert(db, "c@example.invalid", "interest:california", "test-h1", ["california"]);
      await confirm(db, "test-h1");
      await upsert(db, "c@example.invalid", "stories", "test-h2");
      return one<Subscriber>(db, SUBSCRIBER, ["c@example.invalid"]);
    });
    expect(row).toMatchObject({
      source: "interest:california",
      pending_source: "stories",
      confirm_token_hash: "test-h2",
    });
  });

  it("makes an unsubscribed address that signs up again unconfirmed, with a new hash", async () => {
    const row = await withRollback(async (db) => {
      await upsert(db, "d@example.invalid", "stories", "test-h1");
      await confirm(db, "test-h1");
      await db.query(
        "update public.subscribers set resend_contact_id = 'test-contact' where email = 'd@example.invalid'",
      );
      await db.query("select public.unsubscribe_email('D@example.invalid')");
      await upsert(db, "d@example.invalid", "stories", "test-h2");
      return one<Subscriber>(db, SUBSCRIBER, ["d@example.invalid"]);
    });
    expect(row).toMatchObject({
      confirmed_at: null,
      resend_contact_id: null,
      confirm_token_hash: "test-h2",
    });
    expect(row.unsubscribed_at).not.toBeNull();
  });

  it("changes only markets for any other post to a confirmed address", async () => {
    const row = await withRollback(async (db) => {
      await upsert(db, "e@example.invalid", "stories", "test-h1", ["california"]);
      await confirm(db, "test-h1");
      await upsert(db, "e@example.invalid", "home", "test-h2", ["new-york"]);
      return one<Subscriber>(db, SUBSCRIBER, ["e@example.invalid"]);
    });
    expect(row).toMatchObject({
      source: "stories",
      markets: ["california", "new-york"],
      confirm_token_hash: null,
      pending_source: null,
    });
  });
});

describe("confirm_subscriber (DL-06)", () => {
  it("confirms once, moves a pending source into source, and a reused link matches nothing", async () => {
    const outcome = await withRollback(async (db) => {
      await upsert(db, "f@example.invalid", "interest:california", "test-h1", ["california"]);
      await confirm(db, "test-h1");
      await upsert(db, "f@example.invalid", "stories", "test-h2");
      const first = await confirm(db, "test-h2");
      const reused = await confirm(db, "test-h2");
      return {
        first: first.id,
        reused: reused.id,
        row: await one<Subscriber>(db, SUBSCRIBER, ["f@example.invalid"]),
      };
    });
    expect(outcome.first).not.toBeNull();
    expect(outcome.reused).toBeNull();
    expect(outcome.row).toMatchObject({
      source: "stories",
      pending_source: null,
      confirm_token_hash: null,
    });
  });

  it("clears unsubscribed_at and archived_at when a returning address confirms", async () => {
    const row = await withRollback(async (db) => {
      await upsert(db, "g@example.invalid", "stories", "test-h1");
      await db.query(
        "update public.subscribers set unsubscribed_at = now(), archived_at = now() where email = 'g@example.invalid'",
      );
      await upsert(db, "g@example.invalid", "stories", "test-h2");
      await confirm(db, "test-h2");
      return one<Subscriber>(db, SUBSCRIBER, ["g@example.invalid"]);
    });
    expect(row).toMatchObject({
      unsubscribed_at: null,
      archived_at: null,
      confirm_token_hash: null,
    });
    expect(row.confirmed_at).not.toBeNull();
  });

  it("answers a link clicked after unsubscribe_email with no row", async () => {
    const id = await withRollback(async (db) => {
      await upsert(db, "h@example.invalid", "stories", "test-h1");
      await db.query("select public.unsubscribe_email('h@example.invalid')");
      return (await confirm(db, "test-h1")).id;
    });
    expect(id).toBeNull();
  });

  it("accepts a hash set on an already confirmed row and confirms it again", async () => {
    const outcome = await withRollback(async (db) => {
      await upsert(db, "i@example.invalid", "stories", "test-h1");
      await db.query(
        "update public.subscribers set confirmed_at = now() - interval '1 year', confirm_token_hash = 'test-re' where email = 'i@example.invalid'",
      );
      const result = await confirm(db, "test-re");
      const row = await one<Subscriber & { recent: boolean }>(
        db,
        `select confirm_token_hash, confirmed_at > now() - interval '1 minute' as recent
         from public.subscribers where email = 'i@example.invalid'`,
      );
      return { id: result.id, row };
    });
    expect(outcome.id).not.toBeNull();
    expect(outcome.row).toMatchObject({ confirm_token_hash: null, recent: true });
  });
});
