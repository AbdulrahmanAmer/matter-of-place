import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import type { Tables } from "../../src/db/index.ts";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { listApprovals } from "../../src/server/workforce/service";
import { assetRow } from "../fixtures/asset-rows";
import { fakeDb } from "../fixtures/fake-db";

// W7 item 20: a post or a plan that asked for a reel shows it beside its text in Approvals: being made until the
// runner records the asset (its meta.request_id), then the asset's status and its two files on our media address.

const person: AdminActor = {
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles: ["admin"],
  scopes: [],
  requestId: "req-reels",
};
const SOCIAL = "22222222-2222-4222-8222-222222222222";

function approval(
  id: string,
  action: string,
  content: Tables<"agent_approvals">["content"],
): Tables<"agent_approvals"> {
  return {
    id,
    agent_id: SOCIAL,
    run_id: null,
    action,
    summary: `Summary ${id}`,
    content,
    content_hash: "a".repeat(64),
    state: "pending",
    reason: null,
    edited_content: null,
    decided_at: null,
    decided_by: null,
    created_at: "2026-10-15T09:00:00Z",
  };
}

describe("the reels beside proposals (W7 item 20)", () => {
  it("reads a recorded reel's status and files by its request id, and calls an unrecorded one in the making", async () => {
    const db = fakeDb({
      tables: {
        agent_approvals: [
          approval("33333333-3333-4333-8333-333333333331", "social_post", {
            body: "A first look.",
            reel: { request_id: "req-made", name: "Coast" },
          }),
          approval("33333333-3333-4333-8333-333333333332", "campaign_plan", {
            body: "Three weeks.",
            reel: { request_id: "req-waiting", name: "Florida" },
          }),
          approval("33333333-3333-4333-8333-333333333333", "reply_inquiry", { body: "Hello." }),
        ],
        agents: [
          {
            id: SOCIAL,
            slug: "social",
            name: "Maya Okafor",
            role: "Plans and drafts social posts",
            state: "idle",
            model: "sonnet",
            instructions: "",
            tools: ["request_reel"],
            wake_on: [],
            current_task: null,
            last_seen_at: null,
            created_at: "2026-10-12T00:00:00Z",
            created_by: null,
          },
        ],
        assets: [
          assetRow({
            status: "pending",
            meta: { request_id: "req-made" },
            files: [
              {
                role: "video",
                media_key: "requested/req-made/reel.aaaaaaaa.mp4",
                w: 1080,
                h: 1920,
                bytes: 1,
              },
              {
                role: "poster",
                media_key: "requested/req-made/poster.bbbbbbbb.jpg",
                w: 1080,
                h: 1920,
                bytes: 1,
              },
            ],
          }),
        ],
      },
    });
    const { items } = await listApprovals(person, db);
    const [made, waiting, none] = items.map((item) => item.reel);
    expect([made?.request_id, made?.name, made?.status]).toEqual(["req-made", "Coast", "pending"]);
    expect(made?.video).toMatch(/requested\/req-made\/reel\.aaaaaaaa\.mp4$/);
    expect(made?.poster).toMatch(/requested\/req-made\/poster\.bbbbbbbb\.jpg$/);
    expect([waiting, none]).toEqual([
      { request_id: "req-waiting", name: "Florida", status: "making", video: null, poster: null },
      null,
    ]);
    expect(db.calls.filter((call) => call.name === "assets")).toHaveLength(1);
  });

  it("asks nothing of the assets when no proposal asked for a reel", async () => {
    const db = fakeDb({
      tables: {
        agent_approvals: [
          approval("33333333-3333-4333-8333-333333333334", "reply_inquiry", { body: "Hello." }),
        ],
        agents: [],
      },
    });
    const { items } = await listApprovals(person, db);
    expect(items.map((item) => item.reel)).toEqual([null]);
  });
});
