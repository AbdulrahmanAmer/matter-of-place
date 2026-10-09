import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storyCreateInputSchema, storyUpdateInputSchema } from "../../src/domain/admin-stories";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import {
  getStory,
  listStories,
  publishStory,
  saveStory,
  unpublishStory,
} from "../../src/server/stories/service";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// Screen 14 (B7 step 12): one database call per function after `authorize`; a visual editor writes and never
// publishes (S26). The SQL behind each RPC is in tests/db/admin.db.test.ts and admin-cache.db.test.ts.

const STORY = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const UPDATED = "2026-10-08T12:00:00.123456+00:00";
const NEXT = "2026-10-08T12:05:00.654321+00:00";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PATH = "staging/story/a-quiet-house/00000000-0000-4000-8000-0000000000c1.jpg";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-stories",
});

const visual = actor(["visual_editor"]);
const managing = actor(["managing_editor"]);
const audit = { p_actor: visual.userId, p_actor_kind: "human", p_request_id: "req-stories" };

const patch = {
  title: "A quiet house",
  slug: "a-quiet-house",
  deck: "A house kept by one family.",
  category: "Places",
  market_slug: "california",
} as const;

// The shape `list_stories` returns; the generated types give a table function's columns no null, so a draft row
// here still carries an image and a date.
const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  slug: `story-${String(n)}`,
  title: `Story ${String(n)}`,
  category: "Places" as const,
  market_slug: "california" as const,
  editorial_state: "draft" as const,
  image: `s/story-${String(n)}-0a1b2c3d.webp`,
  published_at: `2026-10-0${String(n)}T11:00:00+00:00`,
  updated_at: `2026-10-0${String(n)}T12:00:00.123456+00:00`,
});

/** What a call answered: its result, or the status and code it was refused with. */
async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, code: error.code };
    throw error;
  }
}

/** A Storage client that signs every read and records each removal. */
function storage(removed: string[] = []) {
  return {
    submissions: {
      createSignedUrl: (path: unknown) => ({
        data: { signedUrl: `https://storage.test/read/${String(path)}` },
        error: null,
      }),
      remove: (paths: unknown) => {
        if (Array.isArray(paths)) removed.push(...paths.map(String));
        return { data: [], error: null };
      },
    },
  };
}

const serveBytes = (bytes: Uint8Array<ArrayBuffer>) => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes, { status: 206 })));
};

const calls = (db: FakeDb) => db.calls.map((call) => `${call.kind}:${call.name}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listStories", () => {
  it("lists one page in one list_stories call asking for one row more, and gives the last row's cursor", async () => {
    const db = fakeDb({ rpc: { list_stories: () => [row(1), row(2), row(3)] } });
    const answer = await listStories(visual, db, { limit: 2, editorial_state: "draft" });
    expect({ answer, calls: db.calls }).toEqual({
      answer: {
        items: [row(1), row(2)],
        next_cursor: `${row(2).updated_at}~${row(2).id}`,
      },
      calls: [{ kind: "rpc", name: "list_stories", args: [{ p_limit: 3, p_state: "draft" }] }],
    });
  });

  it("hands a cursor back as updated_at and id, and refuses one it did not make with 422 and no call", async () => {
    const page = fakeDb({ rpc: { list_stories: () => [] } });
    await listStories(visual, page, { limit: 50, cursor: `${row(2).updated_at}~${row(2).id}` });
    const refused = fakeDb();
    const answer = await outcome(listStories(visual, refused, { limit: 50, cursor: "x' or 1=1" }));
    expect({ args: page.calls[0]?.args, answer, refusedCalls: refused.calls }).toEqual({
      args: [{ p_limit: 51, p_after_updated_at: row(2).updated_at, p_after_id: row(2).id }],
      answer: { status: 422, code: "validation" },
      refusedCalls: [],
    });
  });
});

describe("getStory", () => {
  it("answers the story with the address of its image on the site, and 404 for an id with no row", async () => {
    const stored = {
      ...row(1),
      id: STORY,
      deck: "A deck.",
      body: ["One."],
      properties: [],
      image: "s/a-quiet-house-0a1b2c3d.webp",
      archived_at: null,
    };
    const db = withTables(fakeDb(), { stories: [stored] });
    const found = await getStory(visual, db, STORY);
    const missing = await outcome(getStory(visual, withTables(fakeDb(), { stories: [] }), OTHER));
    expect({ image_url: found.image_url, missing }).toEqual({
      image_url: "/media/s/a-quiet-house-0a1b2c3d.webp",
      missing: { status: 404, code: "not_found" },
    });
  });
});

describe("saveStory", () => {
  it("a visual editor's POST with title, slug, deck, category and market_slug makes one save_story call with no id and answers id and updated_at", async () => {
    const db = fakeDb({ rpc: { save_story: () => ({ id: STORY, updated_at: UPDATED }) } });
    const answer = await saveStory(visual, db, { id: null, patch });
    expect({ answer, calls: db.calls }).toEqual({
      answer: { id: STORY, updated_at: UPDATED },
      calls: [
        {
          kind: "rpc",
          name: "save_story",
          args: [{ p_id: null, p_expected_updated_at: null, p_patch: patch, ...audit }],
        },
      ],
    });
  });

  it("a draft without a deck is 422 invalid_key", async () => {
    const db = fakeDb({ rpc: { save_story: () => new Error("invalid_key") } });
    const { deck: _deck, ...without } = patch;
    expect(await outcome(saveStory(visual, db, { id: null, patch: without }))).toEqual({
      status: 422,
      code: "invalid_key",
    });
  });

  it("a PATCH sends the id and the updated_at the editor read, and 409 stale reaches the caller", async () => {
    const db = fakeDb({ rpc: { save_story: () => ({ id: STORY, updated_at: NEXT }) } });
    const saved = await saveStory(visual, db, {
      id: STORY,
      expected_updated_at: UPDATED,
      patch: { title: "A quieter house" },
    });
    const stale = fakeDb({ rpc: { save_story: () => new Error("stale") } });
    expect({
      saved,
      args: db.calls[0]?.args,
      stale: await outcome(
        saveStory(visual, stale, {
          id: STORY,
          expected_updated_at: UPDATED,
          patch: { title: "A quieter house" },
        }),
      ),
    }).toEqual({
      saved: { id: STORY, updated_at: NEXT },
      args: [
        {
          p_id: STORY,
          p_expected_updated_at: UPDATED,
          p_patch: { title: "A quieter house" },
          ...audit,
        },
      ],
      stale: { status: 409, code: "stale" },
    });
  });

  it("reads the first bytes of a staged image, then makes the one save_story call carrying its path", async () => {
    serveBytes(JPEG);
    const db = fakeDb({
      storage: storage(),
      rpc: { save_story: () => ({ id: STORY, updated_at: UPDATED }) },
    });
    await saveStory(visual, db, { id: null, patch, image_staging_path: PATH });
    expect({ calls: calls(db), path: db.calls.at(-1)?.args }).toEqual({
      calls: ["storage:submissions.createSignedUrl", "rpc:save_story"],
      path: [expect.objectContaining({ p_image_staging_path: PATH })],
    });
  });

  it("removes a staged file that is not a photograph, answers 422 invalid_image and makes no save_story call", async () => {
    serveBytes(new TextEncoder().encode("<html>not an image</html>"));
    const removed: string[] = [];
    const db = fakeDb({ storage: storage(removed) });
    const answer = await outcome(
      saveStory(visual, db, { id: null, patch, image_staging_path: PATH }),
    );
    expect({ answer, removed, calls: calls(db) }).toEqual({
      answer: { status: 422, code: "invalid_image" },
      removed: [PATH],
      calls: ["storage:submissions.createSignedUrl", "storage:submissions.remove"],
    });
  });

  it("commercial gets 403 on a save and no database call", async () => {
    const db = fakeDb();
    expect({
      answer: await outcome(saveStory(actor(["commercial"]), db, { id: null, patch })),
      calls: db.calls,
    }).toEqual({ answer: { status: 403, code: "forbidden" }, calls: [] });
  });
});

describe("publishStory and unpublishStory", () => {
  it("a visual editor gets 403 on publish and on unpublish, and no database call", async () => {
    const db = fakeDb();
    expect({
      answers: [
        await outcome(publishStory(visual, db, { id: STORY, expected_updated_at: UPDATED })),
        await outcome(unpublishStory(visual, db, STORY)),
      ],
      calls: db.calls,
    }).toEqual({
      answers: [
        { status: 403, code: "forbidden" },
        { status: 403, code: "forbidden" },
      ],
      calls: [],
    });
  });

  it("a managing editor publishes at the updated_at they read and unpublishes by id, each in one call", async () => {
    const db = fakeDb({
      rpc: {
        publish_story: () => ({ id: STORY, updated_at: NEXT }),
        unpublish_story: () => ({ id: STORY, updated_at: NEXT }),
      },
    });
    const published = await publishStory(managing, db, { id: STORY, expected_updated_at: UPDATED });
    const unpublished = await unpublishStory(managing, db, STORY);
    const managedAudit = { ...audit, p_actor: managing.userId };
    expect({ published, unpublished, calls: db.calls }).toEqual({
      published: { id: STORY, updated_at: NEXT },
      unpublished: { id: STORY, updated_at: NEXT },
      calls: [
        {
          kind: "rpc",
          name: "publish_story",
          args: [{ p_id: STORY, p_expected_updated_at: UPDATED, ...managedAudit }],
        },
        { kind: "rpc", name: "unpublish_story", args: [{ p_id: STORY, ...managedAudit }] },
      ],
    });
  });

  it("answers 422 publish_incomplete while the story has no image, and 409 wrong_state for one that is not live", async () => {
    const incomplete = fakeDb({ rpc: { publish_story: () => new Error("publish_incomplete") } });
    const idle = fakeDb({ rpc: { unpublish_story: () => new Error("wrong_state") } });
    expect([
      await outcome(
        publishStory(managing, incomplete, { id: STORY, expected_updated_at: UPDATED }),
      ),
      await outcome(unpublishStory(managing, idle, STORY)),
    ]).toEqual([
      { status: 422, code: "publish_incomplete" },
      { status: 409, code: "wrong_state" },
    ]);
  });
});

describe("the story routes input", () => {
  it("lets a create body without a deck through, so the database answers 422 invalid_key, and refuses an image or an unknown key at the door", () => {
    const { deck: _deck, ...withoutDeck } = patch;
    expect({
      withoutDeck: storyCreateInputSchema.safeParse({ patch: withoutDeck }).success,
      withImage: storyCreateInputSchema.safeParse({ patch: { ...patch, image: "s/a.webp" } })
        .success,
      withState: storyUpdateInputSchema.safeParse({
        id: STORY,
        expected_updated_at: UPDATED,
        patch: { editorial_state: "published" },
      }).success,
    }).toEqual({ withoutDeck: true, withImage: false, withState: false });
  });
});
