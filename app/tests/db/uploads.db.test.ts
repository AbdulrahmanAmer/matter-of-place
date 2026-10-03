// Invariant 13 (GQ-07): the types, the size and the count of a request's photographs, the same numbers in the
// buckets of ruling H33 and in config.toml, and invariant 12 (GP-03): the rights record every request carries.
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

// STUB(B2 step 10): `uploadLimits` of src/domain/contracts.ts replaces this copy of invariant 13's numbers.
const uploadLimits = {
  maxBytes: 26214400,
  types: ["image/jpeg", "image/png", "image/heic", "image/webp"],
};

const SUBMISSION = `insert into public.submissions (
    address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story, significance,
    package, source_path, rights_version, rights_confirmed_at, rights_ip_hash
  ) values (
    '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Person', 'person@example.test',
    'x', 'x', 'The Feature', '/submit', $1, $2, $3
  )`;
const RIGHTS = ["test-v1", new Date("2026-01-01T00:00:00Z"), "test-hash"];

/** The code of the error `run` raises (and its message), or `ok`; the transaction stays usable either way. */
async function outcome(db: Db, sql: string, params: unknown[] = []): Promise<string> {
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

async function submission(db: Db): Promise<string> {
  const inserted = await db.query<{ id: string }>(`${SUBMISSION} returning id`, RIGHTS);
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("the submission insert returned no id");
  return id;
}

const MEDIA = `insert into public.submission_media (submission_id, name, storage_path, bytes, mime)
  values ($1, 'a.jpg', 'submissions/a.jpg', $2, $3)`;

describe("submission_media types and size", () => {
  it("accepts the four image types and a stored object not yet checked", async () => {
    const codes = await withRollback(async (db) => {
      const id = await submission(db);
      const accepted: Record<string, string> = {};
      for (const mime of ["image/jpeg", "image/png", "image/heic", "image/webp", "unchecked"]) {
        accepted[mime] = await outcome(db, MEDIA, [id, 1000, mime === "unchecked" ? null : mime]);
      }
      return accepted;
    });
    expect(codes).toEqual({
      "image/jpeg": "ok",
      "image/png": "ok",
      "image/heic": "ok",
      "image/webp": "ok",
      unchecked: "ok",
    });
  });

  it("refuses any other type", async () => {
    const codes = await withRollback(async (db) => {
      const id = await submission(db);
      const gif = await outcome(db, MEDIA, [id, 1000, "image/gif"]);
      const pdf = await outcome(db, MEDIA, [id, 1000, "application/pdf"]);
      return {
        gif: gif.slice(0, 5),
        pdf: pdf.slice(0, 5),
        named: gif.includes("submission_media_mime_allowed"),
      };
    });
    expect(codes).toEqual({ gif: "23514", pdf: "23514", named: true });
  });

  it("holds a file to 25 MB", async () => {
    const codes = await withRollback(async (db) => {
      const id = await submission(db);
      const bytes = (n: number | null) => outcome(db, MEDIA, [id, n, "image/jpeg"]);
      return {
        zero: (await bytes(0)).slice(0, 5),
        one: await bytes(1),
        limit: await bytes(26214400),
        over: (await bytes(26214401)).slice(0, 5),
        unknown: await bytes(null),
      };
    });
    expect(codes).toEqual({ zero: "23514", one: "ok", limit: "ok", over: "23514", unknown: "ok" });
  });
});

describe("submission_media count", () => {
  const ROW =
    "insert into public.submission_media (submission_id, name, storage_path) values ($1, 'a.jpg', $2)";

  it("refuses the 41st file of a request with upload_limit", async () => {
    const outcomes = await withRollback(async (db) => {
      const id = await submission(db);
      await db.query(
        `insert into public.submission_media (submission_id, name, storage_path)
         select $1, 'a.jpg', 'submissions/' || n from generate_series(1, 40) as n`,
        [id],
      );
      const count = await db.query<{ n: string }>(
        "select count(*) as n from public.submission_media where submission_id = $1",
        [id],
      );
      return {
        stored: count.rows[0]?.n,
        fortyFirst: await outcome(db, ROW, [id, "submissions/41"]),
      };
    });
    expect(outcomes).toEqual({ stored: "40", fortyFirst: "P0001 upload_limit" });
  });

  it("counts each request on its own", async () => {
    const code = await withRollback(async (db) => {
      const full = await submission(db);
      await db.query(
        `insert into public.submission_media (submission_id, name, storage_path)
         select $1, 'a.jpg', 'submissions/' || n from generate_series(1, 40) as n`,
        [full],
      );
      return outcome(db, ROW, [await submission(db), "submissions/other"]);
    });
    expect(code).toBe("ok");
  });
});

describe("submissions rights", () => {
  it("a request carries its rights version, time and hash", async () => {
    const codes = await withRollback(async (db) => {
      const [version, at, hash] = RIGHTS;
      const code = async (params: unknown[]) => (await outcome(db, SUBMISSION, params)).slice(0, 5);
      return {
        complete: await code([version, at, hash]),
        noVersion: await code([null, at, hash]),
        blankVersion: await code(["", at, hash]),
        noTime: await code([version, null, hash]),
        noHash: await code([version, at, null]),
      };
    });
    expect(codes).toEqual({
      complete: "ok",
      noVersion: "23502",
      blankVersion: "23514",
      noTime: "23502",
      noHash: "23502",
    });
  });
});

describe("limits", () => {
  const bucket = (id: string, isPublic: boolean, bytes: number, types: string[]) =>
    `${id}: ${isPublic ? "public" : "private"}, ${String(bytes)}, ${types.join(" ")}`;

  it("storage.buckets holds exactly submissions, media and documents, with their sizes and types", async () => {
    const rows = await withRollback(
      async (db) =>
        (
          await db.query<{ id: string; public: boolean; bytes: number; types: string[] }>(
            `select id, public, file_size_limit::int as bytes, allowed_mime_types as types
             from storage.buckets order by id`,
          )
        ).rows,
    );
    expect(rows.map((row) => bucket(row.id, row.public, row.bytes, row.types))).toEqual([
      bucket("documents", false, 10485760, [
        "application/pdf",
        "text/csv",
        "text/markdown",
        "application/json",
      ]),
      bucket("media", true, 12582912, ["image/webp", "image/jpeg", "image/png", "video/mp4"]),
      bucket("submissions", false, uploadLimits.maxBytes, uploadLimits.types),
    ]);
  });

  it("no policy on storage.objects reaches anon or authenticated", async () => {
    const policies = await withRollback(
      async (db) =>
        (
          await db.query<{ policyname: string }>(
            `select policyname from pg_policies
             where schemaname = 'storage' and tablename = 'objects'
               and roles && array['anon', 'authenticated', 'public']::name[]`,
          )
        ).rows,
    );
    expect(policies.map(({ policyname }) => policyname)).toEqual([]);
  });

  it("config.toml's storage file_size_limit equals uploadLimits.maxBytes", () => {
    const config = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
    const mebibytes = /^\[storage\][^[]*?^file_size_limit\s*=\s*"(\d+)MiB"/m.exec(config)?.[1];
    expect(Number(mebibytes) * 1024 * 1024).toBe(uploadLimits.maxBytes);
  });

  it("the submission_media checks hold uploadLimits.maxBytes and the four types", async () => {
    const checks = await withRollback(
      async (db) =>
        (
          await db.query<{ definition: string }>(
            `select pg_get_constraintdef(oid) as definition from pg_constraint
             where conrelid = 'public.submission_media'::regclass and contype = 'c'`,
          )
        ).rows,
    );
    const text = checks.map(({ definition }) => definition).join("\n");
    expect({
      maxBytes: text.includes(String(uploadLimits.maxBytes)),
      missingTypes: uploadLimits.types.filter((type) => !text.includes(`'${type}'`)),
    }).toEqual({ maxBytes: true, missingTypes: [] });
  });
});
