// W6 item 8, ruling H142: the upload reconcile over the real `submission_media` table, in one rolled-back transaction.
// The supabase-js client cannot see the test's transaction, so `reconcileUploads` gets an adapter that answers its one
// query and its one rpc over the test's own `pg` client; Storage is a stand-in holding the objects the test puts there.
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { Db as AppDb } from "../../src/server/lib/db";
import { reconcileUploads } from "../../src/server/submissions/reconcile";
import { person } from "../fixtures/account";
import { dbNow, withRollback, type Db } from "../fixtures/db";
import { createSubmission } from "../fixtures/factories";

const OWNER = "test-reconcile-a@example.test";
const DAY = 86_400_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PDF = new Uint8Array(Array.from("%PDF-1.7 not a photograph", (char) => char.charCodeAt(0)));
// What Storage answers for a path with no object (measured on mop-dev in B3 step 8).
const NOT_FOUND = { name: "StorageApiError", message: "Object not found", code: "NoSuchKey" };

type Answer = { data: unknown; error: null };

/** PostgREST answers a time as ISO text, where `pg` gives a `Date`. */
const asJson = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

/** The client `reconcileUploads` takes: its `is` and `gt` query and `mark_media_uploaded` over `pg`, Storage in memory. */
function reconcileDb(
  client: Db,
  objects: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
  removed: string[],
): AppDb {
  const from = (table: string) => ({
    select: (columns: string) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      const run = async (): Promise<Answer> => {
        const { rows } = await client.query<Record<string, unknown>>(
          `select ${columns} from public.${table} where ${filters.join(" and ")}`,
          values,
        );
        return { data: rows.map(asJson), error: null };
      };
      const builder = {
        is: (column: string) => {
          filters.push(`${column} is null`);
          return builder;
        },
        gt: (column: string, value: string) => {
          values.push(value);
          filters.push(`${column} > $${String(values.length)}::timestamptz`);
          return builder;
        },
        then: (resolve: (answer: Answer) => unknown, reject: (reason: unknown) => unknown) =>
          run().then(resolve, reject),
      };
      return builder;
    },
  });
  const rpc = async (name: string, args: Record<string, unknown>): Promise<Answer> => {
    if (name !== "mark_media_uploaded") throw new Error(`unexpected rpc ${name}`);
    const { rows } = await client.query<{ v: boolean }>(
      "select public.mark_media_uploaded($1, $2, $3) as v",
      [args["p_media_id"], args["p_mime"], args["p_sha256"]],
    );
    return { data: rows[0]?.v ?? null, error: null };
  };
  const storage = {
    from: () => ({
      download: (path: string) => {
        const found = objects.get(path);
        return Promise.resolve(
          found === undefined
            ? { data: null, error: NOT_FOUND }
            : { data: new Blob([found]), error: null },
        );
      },
      remove: (paths: string[]) => {
        removed.push(...paths);
        return Promise.resolve({ data: [], error: null });
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the one cast of the adapter: only `from`, `rpc` and `storage` are read
  return { from, rpc, storage } as unknown as AppDb;
}

describe("reconcileUploads on the database", () => {
  it("settles a photograph added from the room to a request received a week ago, and removes one that is not an image", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const base = await dbNow(db);
      const submission = await createSubmission(db, {
        state: "Submitted",
        n: 996,
        base,
        submitter_email: OWNER,
        received_at: new Date(base.getTime() - 7 * DAY).toISOString(),
      });
      const { rows } = await db.query<{ added: { storage_path: string }[] }>(
        "select public.account_add_photos($1, $2, $3::jsonb) as added",
        [
          user,
          submission,
          JSON.stringify([
            { name: "front.jpg", size: 1000, type: "image/jpeg" },
            { name: "notes.jpg", size: 1000, type: "image/jpeg" },
          ]),
        ],
      );
      const [front = "", notes = ""] = (rows[0]?.added ?? []).map((entry) => entry.storage_path);
      const objects = new Map([
        [front, JPEG],
        [notes, PDF],
      ]);
      const removed: string[] = [];
      await reconcileUploads(reconcileDb(db, objects, removed), new Date(), Date.now());
      const media = await db.query<{ name: string; settled: boolean; mime: string | null }>(
        `select name, uploaded_at is not null as settled, mime from public.submission_media
         where submission_id = $1 order by sort_order`,
        [submission],
      );
      return { media: media.rows, removed, notes };
    });
    expect(seen.media).toEqual([
      { name: "front.jpg", settled: true, mime: "image/jpeg" },
      { name: "notes.jpg", settled: false, mime: null },
    ]);
    expect(seen.removed).toEqual([seen.notes]);
  });
});
