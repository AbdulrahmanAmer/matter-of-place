// B7 step 10: the rows `admin-editorial.spec.ts` decides on, committed on top of B4's data set (`fixtureDataset`): three
// `Submitted` requests and one draft property whose publish checklist is green (a hero, six photographs with alt
// text, two paragraphs, every fact, not a live listing, so it needs no representative). The photographs are keys
// only: no object exists in Storage, and the publish gate reads the keys, not the files.
import { committed, dbNow, type Db } from "../../fixtures/db";
import { createSubmission, publishedPropertyRow, submissionRow } from "../../fixtures/factories";

const SUBMISSIONS = [9701, 9702, 9703] as const;
const PROPERTY = 9701;
const PHOTOGRAPHS = 6;
// The request the spec declines writes to Resend's test inbox: the send step skips a reserved domain such as
// `fixtures.invalid` before it reaches the dry run (`reserved_domain`), and the decline letter must reach the dry run.
const DECLINE_INBOX = "delivered@resend.dev";

export interface EditorialFixtures {
  submissions: { id: string; address: string }[];
  property: { id: string; slug: string; title: string };
}

/** The ids `createSubmission` gives the three requests; they do not depend on the date. */
const submissionIds = SUBMISSIONS.map(
  (n) => submissionRow({ state: "Submitted", n, base: new Date(0) }).id,
);

/**
 * Deletes the fixture rows by their ids, in one transaction that allows the hard delete (B2's `refuse_hard_delete`):
 * the property's photographs, the property (published or not), then the three requests. Jobs the run left waiting for
 * the property or a request are cancelled first, so the runner does not render a property or write a letter for a
 * request that no longer exists (it would end them `dead`, on screen 2's dead count).
 */
async function removeEditorialFixtures(db: Db): Promise<void> {
  const property = publishedPropertyRow({ n: PROPERTY }).id;
  await db.query("begin");
  try {
    await db.query("select set_config('mop.retention', 'on', true)");
    await db.query(
      `select public.cancel_job(j.id, null, 'e2e cleanup') from public.jobs j
       where (j.payload -> 'data' ->> 'property_id' = $1::text
         or j.payload -> 'data' ->> 'submission_id' = any($2::text[]))
         and j.status in ('queued', 'failed', 'waiting_approval')`,
      [property, submissionIds],
    );
    // A published row keeps B2's publish gate: removing its photographs first raises `publish_incomplete`.
    await db.query(
      `update public.properties set editorial_state = 'archived', archived_at = now(), published_at = null
       where id = $1 and editorial_state = 'published'`,
      [property],
    );
    await db.query("delete from public.property_media where property_id = $1", [property]);
    await db.query("delete from public.properties where id = $1", [property]);
    await db.query("delete from public.submissions where id = any($1::uuid[])", [submissionIds]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function insertEditorialFixtures(db: Db): Promise<EditorialFixtures> {
  const base = await dbNow(db);
  const submissions = [];
  for (const n of SUBMISSIONS) {
    const id = await createSubmission(db, {
      state: "Submitted",
      n,
      base,
      submitter_kind: "owner",
      submitter_email:
        n === SUBMISSIONS[0] ? DECLINE_INBOX : `e2e+editorial-${String(n)}@fixtures.invalid`,
    });
    submissions.push({ id, address: `${String(n)} Fixture Lane` });
  }
  const { rows: regions } = await db.query<{ slug: string }>(
    "select slug from public.regions where market_slug = 'california' order by slug limit 1",
  );
  const region = regions[0]?.slug;
  if (region === undefined) throw new Error("admin-data: the database has no California region");
  const row = publishedPropertyRow({
    n: PROPERTY,
    region_slug: region,
    editorial_state: "draft",
    status: "Off-market",
    story: ["A house kept by one family since it was built.", "The garden faces the bay."],
  });
  const entries = Object.entries(row);
  await db.query(
    `insert into public.properties (${entries.map(([column]) => column).join(", ")})
     values (${entries.map((_, index) => `$${String(index + 1)}`).join(", ")})`,
    entries.map(([, value]) => value),
  );
  for (let order = 1; order <= PHOTOGRAPHS; order += 1) {
    await db.query(
      `insert into public.property_media (property_id, media_key, alt, orientation, sort_order)
       values ($1, 'o/fixture-editorial/' || $2::int || '-0a1b2c3d.webp', 'A room of the fixture house', 'landscape', $2::int)`,
      [row.id, order],
    );
  }
  return { submissions, property: { id: row.id, slug: row.slug, title: row.title } };
}

/**
 * Commits the fixtures, runs `body` with them while holding the writer lock of G34 (`committed`), and deletes them
 * afterwards whatever `body` did. A run that died earlier left rows behind: they are deleted first.
 */
export function seedEditorialFixtures(body: (fixtures: EditorialFixtures) => Promise<void>) {
  return committed(async (db) => {
    await removeEditorialFixtures(db);
    await body(await insertEditorialFixtures(db));
  }, removeEditorialFixtures);
}
