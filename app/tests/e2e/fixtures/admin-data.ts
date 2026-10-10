// B7 steps 10 and 16: the rows the admin specs decide on, committed on top of B4's data set (`fixtureDataset`).
// A fixture set is three `Submitted` requests and one draft property whose publish checklist is green (a hero, six
// photographs with alt text, two paragraphs, every fact, not a live listing, so it needs no representative); the
// editorial spec and the full-path spec each have their own, so neither moves the other's rows. The photographs are
// keys only: no object exists in Storage, and the publish gate reads the keys, not the files. `seedFullPathRun` is
// the other kind: no rows, but the invoice settings an invoice needs, and the removal of everything a request made
// from `/submit` leaves behind, the invoice counter and the Storage objects included.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { committed, dbNow, type Db } from "../../fixtures/db";
import { createSubmission, publishedPropertyRow, submissionRow } from "../../fixtures/factories";
import { adminClient } from "../helpers/session";

interface FixtureSet {
  submissions: readonly number[];
  property: number;
  owner: string;
}

const EDITORIAL: FixtureSet = {
  submissions: [9701, 9702, 9703],
  property: 9701,
  owner: "fixture-editorial",
};
const FULL_PATH: FixtureSet = {
  submissions: [9711, 9712, 9713],
  property: 9711,
  owner: "fixture-full-path",
};
const PHOTOGRAPHS = 6;
// The request the spec declines writes to Resend's test inbox: the send step skips a reserved domain such as
// `fixtures.invalid` before it reaches the dry run (`reserved_domain`), and the decline letter must reach the dry run.
const DECLINE_INBOX = "delivered@resend.dev";

export interface EditorialFixtures {
  submissions: { id: string; address: string }[];
  property: { id: string; slug: string; title: string };
}

/** The ids `createSubmission` gives a set's requests; they do not depend on the date. */
const submissionIds = (set: FixtureSet) =>
  set.submissions.map((n) => submissionRow({ state: "Submitted", n, base: new Date(0) }).id);

/**
 * Deletes a set's rows by their ids, in one transaction that allows the hard delete (B2's `refuse_hard_delete`):
 * the property's photographs, the property (published or not), then the three requests. Jobs the run left waiting for
 * the property or a request are cancelled first, so the runner does not render a property or write a letter for a
 * request that no longer exists (it would end them `dead`, on screen 2's dead count).
 */
async function removeFixtures(db: Db, set: FixtureSet): Promise<void> {
  const property = publishedPropertyRow({ n: set.property }).id;
  const requests = submissionIds(set);
  await db.query("begin");
  try {
    await db.query("select set_config('mop.retention', 'on', true)");
    await db.query(
      `select public.cancel_job(j.id, null, 'e2e cleanup') from public.jobs j
       where (j.payload -> 'data' ->> 'property_id' = $1::text
         or j.payload -> 'data' ->> 'submission_id' = any($2::text[]))
         and j.status in ('queued', 'failed', 'waiting_approval')`,
      [property, requests],
    );
    // A published row keeps B2's publish gate: removing its photographs first raises `publish_incomplete`.
    await db.query(
      `update public.properties set editorial_state = 'archived', archived_at = now(), published_at = null
       where id = $1 and editorial_state = 'published'`,
      [property],
    );
    await db.query("delete from public.property_media where property_id = $1", [property]);
    await db.query("delete from public.properties where id = $1", [property]);
    await db.query("delete from public.submissions where id = any($1::uuid[])", [requests]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function insertFixtures(db: Db, set: FixtureSet): Promise<EditorialFixtures> {
  const base = await dbNow(db);
  const submissions = [];
  for (const n of set.submissions) {
    const id = await createSubmission(db, {
      state: "Submitted",
      n,
      base,
      submitter_kind: "owner",
      submitter_email:
        n === set.submissions[0] ? DECLINE_INBOX : `e2e+${set.owner}-${String(n)}@fixtures.invalid`,
    });
    submissions.push({ id, address: `${String(n)} Fixture Lane` });
  }
  const { rows: regions } = await db.query<{ slug: string }>(
    "select slug from public.regions where market_slug = 'california' order by slug limit 1",
  );
  const region = regions[0]?.slug;
  if (region === undefined) throw new Error("admin-data: the database has no California region");
  const row = publishedPropertyRow({
    n: set.property,
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
       values ($1, 'o/' || $3::text || '/' || $2::int || '-0a1b2c3d.webp', 'A room of the fixture house', 'landscape', $2::int)`,
      [row.id, order, set.owner],
    );
  }
  return { submissions, property: { id: row.id, slug: row.slug, title: row.title } };
}

/**
 * Commits a set, runs `body` with it while holding the writer lock of G34 (`committed`), and deletes it afterwards
 * whatever `body` did. A run that died earlier left rows behind: they are deleted first.
 */
function seed(set: FixtureSet, body: (fixtures: EditorialFixtures) => Promise<void>) {
  return committed(
    async (db) => {
      await removeFixtures(db, set);
      await body(await insertFixtures(db, set));
    },
    (db) => removeFixtures(db, set),
  );
}

/** The set of `admin-editorial.spec.ts`. */
export const seedEditorialFixtures = (body: (fixtures: EditorialFixtures) => Promise<void>) =>
  seed(EDITORIAL, body);

/** The set of `admin-full-path.spec.ts`' agent variant. */
export const seedFullPathFixtures = (body: (fixtures: EditorialFixtures) => Promise<void>) =>
  seed(FULL_PATH, body);

/** A request the full-path spec sends from `/submit`: its email and address are this run's alone. */
export interface FullPathRun {
  email: string;
  address: string;
}

interface SavedSettings {
  site: Record<string, unknown>;
  invoice: unknown;
  year: number;
  counter: number;
}

const runTag = process.env["GITHUB_RUN_ID"] ?? "local";
const OBJECTS_WAIT_MS = 60_000;
const OBJECTS_POLL_MS = 2000;

async function putSetting(db: Db, key: "site" | "invoice", value: unknown): Promise<void> {
  await db.query(
    `select public.settings_put_${key}($1::jsonb, null, 'human'::public.actor_kind, $2, 'e2e: admin-full-path')`,
    [JSON.stringify(value), `admin-full-path:${key}:${String(Date.now())}`],
  );
}

async function settingValue(db: Db, key: string): Promise<unknown> {
  const { rows } = await db.query<{ value: unknown }>(
    "select value from public.settings where key = $1",
    [key],
  );
  if (rows[0] === undefined) throw new Error(`admin-data: settings has no ${key} row`);
  return rows[0].value;
}

async function counterLast(db: Db, year: number): Promise<number> {
  const { rows } = await db.query<{ last: number }>(
    "select last from public.invoice_counters where year = $1",
    [year],
  );
  return rows[0]?.last ?? 0;
}

/**
 * An invoice is refused until the legal identity and the payment instructions are set (B6 invariant 7): this writes
 * the example ones and answers what it replaced.
 */
async function configureInvoicing(db: Db): Promise<SavedSettings> {
  const { rows } = await db.query<{ year: number }>(
    "select extract(year from timezone('utc', now()))::int as year",
  );
  const year = rows[0]?.year ?? 0;
  const saved: SavedSettings = {
    site: z.record(z.string(), z.unknown()).parse(await settingValue(db, "site")),
    invoice: await settingValue(db, "invoice"),
    year,
    counter: await counterLast(db, year),
  };
  await putSetting(db, "site", {
    ...saved.site,
    legal: { entity: "Example Media LLC", address: "100 Example Street, New York, NY 10001" },
  });
  const example: unknown = JSON.parse(
    readFileSync(
      new URL("../../../scripts/fixtures/invoice.example.json", import.meta.url),
      "utf8",
    ),
  );
  await putSetting(db, "invoice", example);
  return saved;
}

/** Events about the requests (`$1`), their payments or their properties. */
const OWNED_EVENTS = `(
  select e.id from public.events e
  where e.entity_id = any($1::uuid[])
    or e.entity_id in (select p.id from public.payments p where p.submission_id = any($1::uuid[]))
    or e.entity_id in (select pr.id from public.properties pr where pr.submission_id = any($1::uuid[]))
)`;
const OWNED_JOBS = `(
  j.event_id in ${OWNED_EVENTS}
  or j.payload -> 'data' ->> 'property_id' in (select pr.id::text from public.properties pr where pr.submission_id = any($1::uuid[]))
)`;
const MASTER_KEY = /^o\/([^/]+)\/(\d+)-([0-9a-f]{8})\.webp$/;

async function column(db: Db, text: string, ids: string[]): Promise<string[]> {
  const { rows } = await db.query<{ value: string | null }>(text, [ids]);
  return rows.flatMap((row) => (row.value === null ? [] : [row.value]));
}

/** Removes what the requests made from the database, in the order the foreign keys allow, then their objects. */
async function removeRequests(
  db: Db,
  { ids, email }: { ids: string[]; email: string },
  saved: SavedSettings | undefined,
) {
  // A job that is running would upload after the cleanup, and a rewound counter would reuse its key.
  for (let waited = 0; ; waited += OBJECTS_POLL_MS) {
    const { rows } = await db.query<{ running: number }>(
      `select count(*)::int as running from public.jobs j where j.status = 'running' and ${OWNED_JOBS}`,
      [ids],
    );
    if (rows[0]?.running === 0) break;
    if (waited >= OBJECTS_WAIT_MS)
      throw new Error("admin-data: a job of this run is still running");
    await sleep(OBJECTS_POLL_MS);
  }
  const owned = `property_id in (select id from public.properties where submission_id = any($1::uuid[]))`;
  const uploads = await column(
    db,
    "select storage_path as value from public.submission_media where submission_id = any($1::uuid[])",
    ids,
  );
  const staged = await column(
    db,
    `select staging_path as value from public.property_media where ${owned}`,
    ids,
  );
  const masters = await column(
    db,
    `select media_key as value from public.property_media where ${owned}`,
    ids,
  );
  const documents = await column(
    db,
    "select invoice_file_key as value from public.payments where submission_id = any($1::uuid[])",
    ids,
  );
  const numbers = await column(
    db,
    "select invoice_number as value from public.payments where submission_id = any($1::uuid[])",
    ids,
  );
  await db.query("begin");
  try {
    // What the run caused, found by name: the mail, the jobs of its events, then the events (G16: only under retention).
    await db.query("select set_config('mop.retention', 'on', true)");
    await db.query(
      "delete from public.email_messages where entity = 'submission' and entity_id = any($1::uuid[])",
      [ids],
    );
    await db.query(`delete from public.jobs j where ${OWNED_JOBS}`, [ids]);
    await db.query(`delete from public.events where id in ${OWNED_EVENTS}`, [ids]);
    await db.query(
      "delete from public.campaigns where payment_id in (select id from public.payments where submission_id = any($1::uuid[]))",
      [ids],
    );
    // A published row keeps B2's publish gate: its photographs go only once it is archived.
    await db.query(
      `update public.properties set editorial_state = 'archived', archived_at = now(), published_at = null
       where submission_id = any($1::uuid[]) and editorial_state = 'published'`,
      [ids],
    );
    await db.query(`delete from public.property_media where ${owned}`, [ids]);
    await db.query("delete from public.properties where submission_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.payments where submission_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.submissions where id = any($1::uuid[])", [ids]);
    await db.query(
      `delete from public.contacts c where lower(c.email) = lower($1)
       and not exists (select 1 from public.submissions s where s.contact_id = c.id)`,
      [email],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
  // The number is rewound only while it is still the highest this run issued: someone else's number is never undone.
  if (saved !== undefined && numbers.length > 0) {
    const highest = Math.max(...numbers.map((issued) => Number(issued.split("-")[2])));
    await db.query("update public.invoice_counters set last = $1 where year = $2 and last = $3", [
      saved.counter,
      saved.year,
      highest,
    ]);
  }
  const storage = adminClient().storage;
  const removals = [];
  if (uploads.length + staged.length > 0)
    removals.push(storage.from("submissions").remove([...uploads, ...staged]));
  if (documents.length > 0) removals.push(storage.from("documents").remove(documents));
  if (masters.length > 0) {
    const { variantKeys } = await import("../../../scripts/variants.ts");
    const keys = masters.flatMap((key) => {
      const [, owner, n, sha8] = MASTER_KEY.exec(key) ?? [];
      return owner === undefined || n === undefined || sha8 === undefined
        ? [key]
        : Object.values(variantKeys(owner, Number(n), sha8));
    });
    removals.push(storage.from("media").remove(keys));
  }
  for (const removed of await Promise.all(removals)) {
    if (removed.error !== null)
      throw new Error(`admin-data: storage cleanup: ${removed.error.message}`);
  }
}

/**
 * Holds the writer lock of G34, sets the invoice settings, runs `body` with an email and an address only this run
 * uses, and afterwards removes the request that email made and puts the settings and the invoice counter back.
 */
export function seedFullPathRun(body: (run: FullPathRun) => Promise<void>) {
  const run = {
    email: `e2e+full-path-${runTag}-${randomUUID().slice(0, 8)}@fixtures.invalid`,
    address: `${String(randomInt(1000, 9999))} Fixture Way`,
  };
  let saved: SavedSettings | undefined;
  return committed(
    async (db) => {
      saved = await configureInvoicing(db);
      await body(run);
    },
    async (db) => {
      try {
        const { rows } = await db.query<{ id: string }>(
          "select id from public.submissions where submitter_email = $1",
          [run.email],
        );
        if (rows.length > 0) {
          await removeRequests(db, { ids: rows.map((row) => row.id), email: run.email }, saved);
        }
      } finally {
        if (saved !== undefined) {
          await putSetting(db, "site", saved.site);
          await putSetting(db, "invoice", saved.invoice);
        }
      }
    },
  );
}
