// W6 item 8 (phase 2), ruling H142: photographs added to an open request by the person it belongs to
// (`account_add_photos`), and the count and the "can add" flag the My properties page reads. Every case runs in one
// rolled-back transaction.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { person, rowsOf } from "../fixtures/account";
import { dbNow, withRollback, type Db } from "../fixtures/db";
import { createSubmission, type SubmissionFactoryInput } from "../fixtures/factories";

const OWNER = "test-photos-a@example.test";
const OTHER = "test-photos-b@example.test";

const ADD = "select public.account_add_photos($1, $2, $3::jsonb) as added";

const photo = (name: string, type = "image/jpeg", size = 1000) => ({ name, size, type });

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable. */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

async function request(
  db: Db,
  n: number,
  email: string,
  state: SubmissionFactoryInput["state"] = "Accepted",
): Promise<string> {
  return createSubmission(db, { state, n, base: await dbNow(db), submitter_email: email });
}

async function added(db: Db, user: string, submission: string, media: unknown): Promise<unknown> {
  const { rows } = await db.query<{ added: unknown }>(ADD, [
    user,
    submission,
    JSON.stringify(media),
  ]);
  return rows[0]?.added;
}

const mediaOf = async (db: Db, submission: string) =>
  (
    await db.query<{ name: string; bytes: string; sort_order: number; storage_path: string }>(
      "select name, bytes::text, sort_order, storage_path from public.submission_media where submission_id = $1 order by sort_order",
      [submission],
    )
  ).rows;

describe("account_add_photos", () => {
  it("declares the photographs on the person's own open request, after the ones it holds, at paths of their own", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const submission = await request(db, 960, OWNER);
      await db.query(
        "insert into public.submission_media (submission_id, name, bytes, storage_path, sort_order) values ($1, 'old.jpg', 10, 'x/old.jpg', 4)",
        [submission],
      );
      const answer = await added(db, user, submission, [
        photo("front.jpg"),
        photo("iphone.heic", "image/heic", 2_000_000),
      ]);
      return { answer, submission, rows: await mediaOf(db, submission) };
    });
    const answer = rowsOf(seen.answer);
    expect(answer.map((entry) => entry["index"])).toEqual([0, 1]);
    expect(answer.map((entry) => entry["storage_path"])).toEqual([
      expect.stringMatching(new RegExp(`^${seen.submission}/[0-9a-f-]{36}\\.jpg$`)),
      expect.stringMatching(new RegExp(`^${seen.submission}/[0-9a-f-]{36}\\.heic$`)),
    ]);
    expect(seen.rows.map((row) => [row.name, row.bytes, row.sort_order])).toEqual([
      ["old.jpg", "10", 4],
      ["front.jpg", "1000", 5],
      ["iphone.heic", "2000000", 6],
    ]);
  });

  it("refuses a request that is another person's, and one that does not exist", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const others = await request(db, 961, OTHER);
      return {
        theirs: await attempt(db, ADD, [user, others, JSON.stringify([photo("a.jpg")])]),
        nobody: await attempt(db, ADD, [
          user,
          "00000000-0000-4000-8000-000000000000",
          JSON.stringify([photo("a.jpg")]),
        ]),
        rows: await mediaOf(db, others),
      };
    });
    expect(seen).toEqual({ theirs: "P0002 not_found", nobody: "P0002 not_found", rows: [] });
  });

  it("refuses a session that is no contact's", async () => {
    const seen = await withRollback(async (db) => {
      const stranger = await person(db, "test-photos-nobody@example.test");
      const submission = await request(db, 962, OWNER);
      return attempt(db, ADD, [stranger, submission, JSON.stringify([photo("a.jpg")])]);
    });
    expect(seen).toBe("P0002 not_found");
  });

  it("accepts a request until it is activated, and refuses it from then on", async () => {
    const states = [
      "Submitted",
      "Under Review",
      "Accepted",
      "Awaiting Assets",
      "Invoice Issued",
      "Scheduled",
      "Published",
      "Distribution Active",
      "Completed",
      "Declined",
      "Withdrawn",
    ] as const;
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const outcomes: Record<string, string> = {};
      let n = 970;
      for (const state of states) {
        const submission = await request(db, n, OWNER, state);
        n += 1;
        outcomes[state] = await attempt(db, ADD, [
          user,
          submission,
          JSON.stringify([photo("a.jpg")]),
        ]);
      }
      return outcomes;
    });
    expect(seen).toEqual({
      Submitted: "ok",
      "Under Review": "ok",
      Accepted: "ok",
      "Awaiting Assets": "ok",
      "Invoice Issued": "ok",
      Scheduled: "P0001 wrong_state",
      Published: "P0001 wrong_state",
      "Distribution Active": "P0001 wrong_state",
      Completed: "P0001 wrong_state",
      Declined: "P0001 wrong_state",
      Withdrawn: "P0001 wrong_state",
    });
  });

  it("refuses an empty list, more than ten, a file that is not a photograph, a file over 25 MB and a nameless one", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const submission = await request(db, 990, OWNER);
      const send = (media: unknown) => attempt(db, ADD, [user, submission, JSON.stringify(media)]);
      return {
        none: await send([]),
        notAList: await send({ name: "a.jpg" }),
        eleven: await send(Array.from({ length: 11 }, (_, index) => photo(`${String(index)}.jpg`))),
        pdf: await send([photo("a.pdf", "application/pdf")]),
        noType: await send([{ name: "a.jpg", size: 10 }]),
        huge: await send([photo("a.jpg", "image/jpeg", 26_214_401)]),
        notANumber: await send([{ name: "a.jpg", size: "big", type: "image/jpeg" }]),
        nameless: await send([photo("  ")]),
        ten: await send(Array.from({ length: 10 }, (_, index) => photo(`${String(index)}.jpg`))),
      };
    });
    expect(seen).toEqual({
      none: "22023 validation",
      notAList: "22023 validation",
      eleven: "22023 validation",
      pdf: "22023 validation",
      noType: "22023 validation",
      huge: "22023 validation",
      notANumber: "22023 validation",
      nameless: "22023 validation",
      ten: "ok",
    });
  });

  it("holds the limit of forty photographs across calls", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const submission = await request(db, 991, OWNER);
      for (let batch = 0; batch < 3; batch += 1) {
        await added(
          db,
          user,
          submission,
          Array.from({ length: 10 }, (_, index) => photo(`${String(batch)}-${String(index)}.jpg`)),
        );
      }
      // 30 held; 10 more make 40, and one beyond is refused.
      const fortieth = await attempt(db, ADD, [
        user,
        submission,
        JSON.stringify(
          Array.from({ length: 10 }, (_, index) => photo(`last-${String(index)}.jpg`)),
        ),
      ]);
      const beyond = await attempt(db, ADD, [
        user,
        submission,
        JSON.stringify([photo("one-more.jpg")]),
      ]);
      return { fortieth, beyond, held: (await mediaOf(db, submission)).length };
    });
    expect(seen).toEqual({ fortieth: "ok", beyond: "P0001 upload_limit", held: 40 });
  });

  it("is called by the service role only", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const submission = await request(db, 992, OWNER);
      const codes: Record<string, string> = {};
      for (const role of ["anon", "authenticated"]) {
        await db.query("savepoint call");
        await db.query(`set local role ${role}`);
        codes[role] = (
          await attempt(db, ADD, [user, submission, JSON.stringify([photo("a.jpg")])])
        ).slice(0, 5);
        await db.query("rollback to savepoint call");
      }
      return codes;
    });
    expect(seen).toEqual({ anon: "42501", authenticated: "42501" });
  });
});

describe("account_properties photographs", () => {
  it("counts the photographs on each request and says which can still take more", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      const open = await request(db, 993, OWNER, "Accepted");
      const live = await request(db, 994, OWNER, "Published");
      await added(db, user, open, [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);
      await db.query(
        "insert into public.submission_media (submission_id, name, bytes, storage_path) values ($1, 'live.jpg', 10, 'y/live.jpg')",
        [live],
      );
      const { rows } = await db.query<{
        page: { properties: { id: string; photos: number; can_add_photos: boolean }[] };
      }>("select public.account_properties($1) as page", [user]);
      const byId = new Map((rows[0]?.page.properties ?? []).map((entry) => [entry.id, entry]));
      return {
        open: [byId.get(open)?.photos, byId.get(open)?.can_add_photos],
        live: [byId.get(live)?.photos, byId.get(live)?.can_add_photos],
      };
    });
    expect(seen).toEqual({ open: [3, true], live: [1, false] });
  });
});
