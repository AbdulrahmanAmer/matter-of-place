import "../fixtures/worker-env";
import { describe, expect, it, vi } from "vitest";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { ForbiddenError } from "../../src/server/lib/authz";
import { AppError } from "../../src/server/lib/errors";
import {
  approveProposedPost,
  createProposedPost,
  listProposedPosts,
  rejectProposedPost,
  rerenderProposedPost,
} from "../../src/server/publishing/proposed-posts/service";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// W8 item 10 (H116): who decides a proposed post. A person approves; Matter's key (an agent with `admin`) may reject
// and ask for a re-render but never approve; a colleague's key does none of these. The database half, and the rows an
// approval makes, are tests/db/proposed-posts.db.test.ts.

const fanned = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../../src/server/automation/fanout", () => ({
  fanoutEvent: (_db: unknown, eventId: string) => {
    fanned.ids.push(eventId);
    return Promise.resolve(0);
  },
}));

const POST = "3f2a9c1d-0000-4000-8000-0000000000a1";
const EVENT = "3f2a9c1d-0000-4000-8000-0000000000e1";
const SOCIAL = "3f2a9c1d-0000-4000-8000-0000000000b1";
const USER = "00000000-0000-4000-8000-000000000001";

const person: AdminActor = {
  userId: USER,
  kind: "human",
  roles: ["chief_editor"],
  scopes: [],
  requestId: "r1",
};
const matter: AdminActor = { ...person, kind: "agent", roles: ["admin"], scopes: ["channels"] };
const colleague: AdminActor = {
  ...person,
  kind: "agent",
  roles: ["media_ops"],
  scopes: ["channels"],
};

/** The code a refused call answers with, or "ok". */
async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "ok";
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

function decisions() {
  return fakeDb({
    rpc: {
      approve_proposed_post: () => ({
        post_id: POST,
        event_ids: [EVENT],
        social_post_ids: [SOCIAL],
      }),
      reject_proposed_post: () => 1,
    },
  });
}

describe("approving a proposed post", () => {
  it("is a person's: Matter's key is refused manual_approval and a colleague's key forbidden, before any call", async () => {
    const db = decisions();
    expect({
      matter: await outcome(approveProposedPost(matter, db, { id: POST, revision: 1 })),
      colleague: await outcome(approveProposedPost(colleague, db, { id: POST, revision: 1 })),
    }).toEqual({ matter: "manual_approval", colleague: "forbidden" });
    expect(db.calls).toEqual([]);
  });

  it("calls approve_proposed_post as the person for the revision they saw and plans each channel's event", async () => {
    fanned.ids.length = 0;
    const db = decisions();
    expect(await approveProposedPost(person, db, { id: POST, revision: 2 })).toEqual({
      post_id: POST,
      revision: 2,
      event_ids: [EVENT],
      social_post_ids: [SOCIAL],
    });
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "approve_proposed_post",
        args: [
          { p_id: POST, p_revision: 2, p_actor: USER, p_actor_kind: "human", p_request_id: "r1" },
        ],
      },
    ]);
    expect(fanned.ids).toEqual([EVENT]);
  });
});

describe("rejecting and asking for a re-render", () => {
  it("is open to a person and to Matter's key, and refused to a colleague's key before any call", async () => {
    const db = decisions();
    const note = { id: POST, note: "The X cover is too dark." };
    expect({
      matter: await outcome(rejectProposedPost(matter, db, note)),
      person: await outcome(rerenderProposedPost(person, db, note)),
    }).toEqual({ matter: "ok", person: "ok" });
    const sent = { p_id: POST, p_note: note.note, p_actor: USER, p_request_id: "r1" };
    expect(db.calls.map((call) => call.args[0])).toEqual([
      { ...sent, p_rerender: false, p_actor_kind: "agent" },
      { ...sent, p_rerender: true, p_actor_kind: "human" },
    ]);
    const refused = decisions();
    await expect(rejectProposedPost(colleague, refused, note)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(rerenderProposedPost(colleague, refused, note)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(refused.calls).toEqual([]);
  });
});

describe("proposing and listing", () => {
  it("files a person's post under their account and Matter's as the colleague matter", async () => {
    const db = fakeDb({ rpc: { create_proposed_post: () => POST } });
    const input = {
      title: "Fairfield",
      property_id: null,
      submission_id: null,
      test: true,
      channels: [],
    };
    await createProposedPost(person, db, input);
    await createProposedPost(matter, db, input);
    expect(
      db.calls.map((call) => {
        const args = call.args[0];
        return typeof args === "object" && args !== null
          ? [
              Reflect.get(args, "p_proposer_kind"),
              Reflect.get(args, "p_proposer_agent") ?? null,
              "p_property" in args,
            ]
          : null;
      }),
    ).toEqual([
      ["human", null, false],
      ["agent", "matter", false],
    ]);
  });

  it("shows each post with the channels of its current revision and each file's address", async () => {
    const row = {
      id: POST,
      title: "Fairfield",
      property_id: null,
      submission_id: null,
      proposer_kind: "agent" as const,
      proposer_agent: "maya",
      proposer_user: null,
      test: true,
      status: "proposed" as const,
      revision: 2,
      rejection_note: null,
      approved_at: null,
      approved_by: null,
      run_id: null,
      created_at: "2026-10-16T05:00:00Z",
      updated_at: "2026-10-16T05:00:00Z",
    };
    const channel = (revision: number, key: string) => ({
      id: `c${String(revision)}`,
      post_id: POST,
      revision,
      channel: "x",
      format: "single",
      caption: "Fairfield.",
      media: {
        images: [
          { key, source: "studio", original: null, alt: "The hall.", w: 1080, h: 1350, bytes: 1 },
        ],
        reel: null,
      },
      asset_id: null,
      social_post_id: null,
      created_at: row.created_at,
    });
    const db = withTables(fakeDb(), {
      proposed_posts: [row],
      proposed_post_channels: [channel(1, "proposed/a/old.jpg"), channel(2, "proposed/b/new.jpg")],
    });
    const listed = await listProposedPosts(person, db, { limit: 50 });
    expect(
      listed.items.map((item) => item.channels.map((c) => c.images.map((image) => image.url))),
    ).toEqual([[["/media/proposed/b/new.jpg"]]]);
  });

  it("pages newest first by a keyset cursor, a post on the same instant included once", async () => {
    const post = (id: string, at: string) => ({
      id,
      title: id,
      property_id: null,
      submission_id: null,
      proposer_kind: "human" as const,
      proposer_agent: null,
      proposer_user: USER,
      test: false,
      status: "proposed" as const,
      revision: 1,
      rejection_note: null,
      approved_at: null,
      approved_by: null,
      run_id: null,
      created_at: at,
      updated_at: at,
    });
    const newest = "3f2a9c1d-0000-4000-8000-0000000000c3";
    const tieHigh = "3f2a9c1d-0000-4000-8000-0000000000c2";
    const tieLow = "3f2a9c1d-0000-4000-8000-0000000000c1";
    const db = withTables(fakeDb(), {
      proposed_posts: [
        post(tieLow, "2026-10-16T05:00:00Z"),
        post(newest, "2026-10-16T06:00:00Z"),
        post(tieHigh, "2026-10-16T05:00:00Z"),
      ],
      proposed_post_channels: [],
    });
    const first = await listProposedPosts(person, db, { limit: 2 });
    const second = await listProposedPosts(person, db, {
      limit: 2,
      cursor: first.next_cursor ?? "",
    });
    expect([
      first.items.map((item) => item.id),
      first.next_cursor,
      second.items.map((item) => item.id),
      second.next_cursor,
    ]).toEqual([[newest, tieHigh], `2026-10-16T05:00:00Z~${tieHigh}`, [tieLow], null]);
  });
});
