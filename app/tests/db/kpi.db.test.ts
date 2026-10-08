// B11 step 13: SQL `kpi_weekly`, the one place the CEO's weekly numbers are counted (invariant 12). Every case runs in
// one rolled-back transaction (F22). The fixture week is fixed and explicit (R51): the week of Monday 2001-01-01, long
// before any row of a shared database, so every count below is computed by hand from the rows this file writes. New
// York is UTC-5 in January, so the week runs from 2001-01-01 05:00 UTC to 2001-01-08 05:00 UTC.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, withRollback, type Db } from "../fixtures/db";
import { createSubmission, publishedProperty } from "../fixtures/factories";

const WEEK = "2001-01-01";
const EMPTY_WEEK = "2000-01-03";

interface Fixture {
  submissions: string[];
  slugs: string[];
}

async function kpi(db: Db, week: string): Promise<unknown> {
  const { rows } = await db.query<{ v: unknown }>("select public.kpi_weekly($1::date) as v", [
    week,
  ]);
  return rows[0]?.v;
}

const BASE = new Date("2001-01-01T00:00:00Z");

async function submission(db: Db, n: number, receivedAt: string): Promise<string> {
  return createSubmission(db, { n, base: BASE, state: "Submitted", received_at: receivedAt });
}

async function decision(db: Db, type: string, submissionId: string, at: string): Promise<void> {
  await db.query(
    `insert into public.events (type, entity, entity_id, payload, at)
     values ($1, 'submission', $2::uuid, jsonb_build_object('submission_id', $2::text), $3::timestamptz)`,
    [type, submissionId, at],
  );
}

async function invoice(
  db: Db,
  values: {
    submission: string;
    n: number;
    status: string;
    amount: number;
    issued: string;
    paid?: string;
  },
): Promise<void> {
  await db.query(
    `insert into public.payments (submission_id, product, amount, invoice_number, status, issued_at, paid_at)
     values ($1, 'The Feature', $2, $3, $4::public.payment_status, $5::timestamptz, $6::timestamptz)`,
    [
      values.submission,
      values.amount,
      `KPI-2001-${String(values.n)}`,
      values.status,
      values.issued,
      values.paid ?? null,
    ],
  );
}

async function post(db: Db, asset: string, property: string, channel: string, at: string) {
  await db.query(
    `insert into public.social_posts (asset_id, property_id, channel, status, scheduled_at, posted_at)
     values ($1, $2, $3, 'posted', $4::timestamptz, $4::timestamptz)`,
    [asset, property, channel, at],
  );
}

async function asset(db: Db, property: string, kind: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.assets (property_id, kind) values ($1, $2::public.asset_kind) returning id",
    [property, kind],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no asset row");
  return id;
}

async function subscriber(
  db: Db,
  n: number,
  confirmed: string | null,
  unsubscribed: string | null,
) {
  await db.query(
    `insert into public.subscribers (email, source, confirmed_at, unsubscribed_at)
     values ($1, 'test', $2::timestamptz, $3::timestamptz)`,
    [`kpi+${String(n)}@fixtures.invalid`, confirmed, unsubscribed],
  );
}

async function inquiry(db: Db, slug: string | null, at: string): Promise<void> {
  await db.query(
    `insert into public.inquiries (intent, name, email, message, source_path, subject_kind, subject_slug, received_at)
     values ('ask', 'Fixture Reader', 'reader@fixtures.invalid', 'A question.', '/contact',
       case when $1::text is null then null else 'property' end, $1::text, $2::timestamptz)`,
    [slug, at],
  );
}

/** The rows of the fixture week and its edges; the comment on each says whether it counts. */
async function fixture(db: Db): Promise<Fixture> {
  const s1 = await submission(db, 7301, "2001-01-01T06:00:00Z"); // in: Monday 01:00 in New York
  const s2 = await submission(db, 7302, "2001-01-03T12:00:00Z"); // in
  const s3 = await submission(db, 7303, "2001-01-08T04:59:00Z"); // in: Sunday 23:59 in New York
  const s4 = await submission(db, 7304, "2001-01-01T04:59:00Z"); // out: Sunday 23:59 of the week before
  const s5 = await submission(db, 7305, "2001-01-08T05:00:00Z"); // out: the next Monday

  await decision(db, "submission.accepted", s1, "2001-01-02T06:00:00Z"); // 24 hours after s1 arrived
  await decision(db, "submission.declined", s2, "2001-01-04T00:00:00Z"); // 12 hours
  await decision(db, "submission.accepted", s4, "2001-01-01T10:59:00Z"); // 6 hours
  await decision(db, "submission.declined", s5, "2001-01-09T00:00:00Z"); // out of the week
  await decision(db, "submission.awaiting_assets", s3, "2001-01-05T00:00:00Z"); // not a decision

  await invoice(db, {
    submission: s1,
    n: 1,
    status: "due",
    amount: 2500,
    issued: "2001-01-02T12:00:00Z",
  });
  await invoice(db, {
    submission: s2,
    n: 2,
    status: "paid",
    amount: 5000,
    issued: "2001-01-02T12:00:00Z",
    paid: "2001-01-03T12:00:00Z",
  });
  await invoice(db, {
    submission: s4,
    n: 3,
    status: "void",
    amount: 9999,
    issued: "2001-01-02T12:00:00Z",
  });
  await invoice(db, {
    submission: s3,
    n: 4,
    status: "paid",
    amount: 1000,
    issued: "2000-12-28T12:00:00Z",
    paid: "2001-01-05T12:00:00Z",
  });

  const p1 = await publishedProperty(db, { n: 7301, published_at: "2001-01-03T12:00:00Z" });
  const p2 = await publishedProperty(db, { n: 7302, published_at: "2000-12-28T12:00:00Z" });
  await publishedProperty(db, { n: 7303, published_at: "2001-01-10T12:00:00Z" }); // after the week

  const cover = await asset(db, p1.id, "cover");
  const carousel = await asset(db, p1.id, "carousel");
  await post(db, cover, p1.id, "instagram", "2001-01-02T15:00:00Z");
  await post(db, cover, p1.id, "x", "2001-01-03T15:00:00Z");
  await post(db, carousel, p1.id, "instagram", "2001-01-05T15:00:00Z");
  await post(db, cover, p1.id, "linkedin", "2001-01-09T15:00:00Z"); // out

  await subscriber(db, 1, "2001-01-02T00:00:00Z", null); // confirmed in the week
  await subscriber(db, 2, "2001-01-03T00:00:00Z", "2001-01-06T00:00:00Z"); // both in the week
  await subscriber(db, 3, "2000-12-20T00:00:00Z", "2001-01-04T00:00:00Z"); // unsubscribed in the week
  await subscriber(db, 4, "2000-12-15T00:00:00Z", null); // confirmed before, still on the list
  await subscriber(db, 5, "2001-01-09T00:00:00Z", null); // out

  await inquiry(db, p1.slug, "2001-01-02T00:00:00Z");
  await inquiry(db, p1.slug, "2001-01-04T00:00:00Z");
  await inquiry(db, p2.slug, "2001-01-05T00:00:00Z");
  await inquiry(db, null, "2001-01-06T00:00:00Z");
  await inquiry(db, "no-such-property", "2001-01-06T00:00:00Z"); // counts, but joins no property
  await inquiry(db, p1.slug, "2001-01-09T00:00:00Z"); // out
  return { submissions: [s1, s2, s3, s4, s5], slugs: [p1.slug, p2.slug] };
}

describe("kpi_weekly", () => {
  it("returns the hand-computed counts of every KPI on the fixture week", async () => {
    const result = await withRollback(async (db) => {
      const { slugs } = await fixture(db);
      return { value: await kpi(db, WEEK), slugs };
    });
    expect(result.value).toEqual({
      week_start: "2001-01-01",
      week_end: "2001-01-07",
      submissions_received: 3,
      decisions: { accepted: 2, declined: 1 },
      time_to_decision_hours: 12,
      invoices: { issued: 2, issued_amount: 7500, paid: 2, paid_amount: 6000 },
      properties_published: 1,
      posts_by_channel: { instagram: 2, x: 1 },
      newsletter: { confirmed: 2, unsubscribed: 2, net: 0, total_confirmed: 2 },
      inquiries: {
        received: 5,
        published_properties: 2,
        top: [
          { slug: result.slugs[0], title: "Fixture Property 7301", count: 2 },
          { slug: result.slugs[1], title: "Fixture Property 7302", count: 1 },
        ],
      },
    });
  });

  it("counts decisions from the accepted and declined events, dated by events.at", async () => {
    const decisions = await withRollback(async (db) => {
      const { submissions } = await fixture(db);
      const [s1] = submissions;
      if (s1 === undefined) throw new Error("no fixture submission");
      // A second accept of s1 later in the week is one more decision, and s1's first decision still dates its time.
      await decision(db, "submission.accepted", s1, "2001-01-06T06:00:00Z");
      return kpi(db, WEEK);
    });
    expect(decisions).toMatchObject({
      decisions: { accepted: 3, declined: 1 },
      time_to_decision_hours: 12,
    });
  });

  it("reads a week with no rows as 0 of 0 decisions and no published property", async () => {
    const value = await withRollback((db) => kpi(db, EMPTY_WEEK));
    // toEqual, not toMatchObject: a `{}` inside toMatchObject also matches null (P-2424).
    expect(value).toEqual({
      week_start: EMPTY_WEEK,
      week_end: "2000-01-09",
      submissions_received: 0,
      decisions: { accepted: 0, declined: 0 },
      time_to_decision_hours: null,
      invoices: { issued: 0, issued_amount: 0, paid: 0, paid_amount: 0 },
      properties_published: 0,
      posts_by_channel: {},
      newsletter: { confirmed: 0, unsubscribed: 0, net: 0, total_confirmed: 0 },
      inquiries: { received: 0, published_properties: 0, top: [] },
    });
  });

  it("counts two inquiries about one published property as 2 for it in the top five", async () => {
    const top = await withRollback(async (db) => {
      const property = await publishedProperty(db, {
        n: 7310,
        published_at: "2000-12-01T00:00:00Z",
      });
      await inquiry(db, property.slug, "2001-01-02T00:00:00Z");
      await inquiry(db, property.slug, "2001-01-03T00:00:00Z");
      const { rows } = await db.query<{ v: unknown }>(
        "select public.kpi_weekly($1::date) -> 'inquiries' -> 'top' as v",
        [WEEK],
      );
      return { top: rows[0]?.v, slug: property.slug };
    });
    expect(top.top).toEqual([{ slug: top.slug, title: "Fixture Property 7310", count: 2 }]);
  });

  it("refuses a week_start that is not a Monday", async () => {
    const refused = await withRollback(async (db) => {
      try {
        await kpi(db, "2001-01-02");
        return "ok";
      } catch (error) {
        if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
        throw error;
      }
    });
    expect(refused).toBe("22023 validation");
  });

  it("is callable by the service role only", async () => {
    const result = await withRollback(async (db) => {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
        `select has_function_privilege('anon', 'public.kpi_weekly(date)', 'execute') as anon,
           has_function_privilege('authenticated', 'public.kpi_weekly(date)', 'execute') as authenticated,
           has_function_privilege('service_role', 'public.kpi_weekly(date)', 'execute') as service`,
      );
      await asRole(db, "authenticated");
      try {
        await kpi(db, WEEK);
        return { privileges: rows[0], call: "ok" };
      } catch (error) {
        if (error instanceof pg.DatabaseError) return { privileges: rows[0], call: error.code };
        throw error;
      }
    });
    expect(result).toEqual({
      privileges: { anon: false, authenticated: false, service: true },
      call: "42501",
    });
  });
});
