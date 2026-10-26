import { describe, expect, it } from "vitest";
import {
  checkPreview,
  nextWords,
  oneLine,
  PREVIEW_MAX_BYTES,
  previewKey,
  putPiece,
  statusText,
  type PieceView,
} from "../../scripts/workforce/studio.ts";
import { fakeDb } from "../fixtures/fake-db.ts";

// W8 item 0f: what status.md and the row of a studio piece say, and the preview that may leave the laptop.

const view: PieceView = {
  id: "8d5f2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f",
  title: "Fairfield stair",
  owner: "social",
  thread: "social",
  state: "draft",
  folder: "2026-10-16-fairfield-stair",
  drafts: 2,
  preview: null,
  asset: null,
  next: nextWords({ state: "draft", drafts: 2 }),
  history: [
    { at: "2026-10-16T05:00:00.000Z", line: "asked for; waits in the studio" },
    { at: "2026-10-16T05:30:00.000Z", line: "draft 2 passed the motion gate and the review" },
  ],
};

describe("status.md (W8 0f)", () => {
  it("says who, the state and what is next, then what happened in order", () => {
    expect(statusText(view)).toBe(
      [
        "# Fairfield stair",
        "",
        "- Piece: 2026-10-16-fairfield-stair",
        "- Who: social, asked in the social thread",
        "- State: draft",
        "- Drafts: 2",
        "- Next: Matter reviews draft 2: approve it, ask for a revision, or hold it for the operator.",
        "- Preview: none",
        "- Visual: none",
        "",
        "## What happened",
        "- 2026-10-16T05:00:00.000Z asked for; waits in the studio",
        "- 2026-10-16T05:30:00.000Z draft 2 passed the motion gate and the review",
        "",
      ].join("\n"),
    );
  });

  it("names a next step for every state, and never carries a path or a long reason whole", () => {
    const states = [
      "queued",
      "working",
      "draft",
      "waiting_operator",
      "approved",
      "done",
      "failed",
    ] as const;
    for (const state of states) {
      const next = nextWords({ state, drafts: 1, question: "q", reason: "r".repeat(900) });
      expect(next.length).toBeGreaterThan(10);
      expect(next.length).toBeLessThan(330);
    }
    expect(nextWords({ state: "queued", drafts: 1, revise: "Hold the title." })).toBe(
      "The designer revises it as Matter asked: Hold the title.",
    );
    expect(nextWords({ state: "done", drafts: 1, kept: true })).toMatch(/stays in this folder/);
    expect(nextWords({ state: "done", drafts: 1 })).toMatch(/uploaded once/);
  });

  it("flattens a reviewer's several lines into one", () => {
    expect(oneLine("a title\n  is cut off\n\n at the top")).toBe("a title is cut off at the top");
    expect(oneLine("x".repeat(400), 50)).toHaveLength(50);
  });
});

describe("the preview of a piece waiting on the operator (W8 0f)", () => {
  it("refuses an empty still and one past the small limit", () => {
    expect(checkPreview(new Uint8Array(PREVIEW_MAX_BYTES))).toHaveLength(PREVIEW_MAX_BYTES);
    expect(() => checkPreview(new Uint8Array(PREVIEW_MAX_BYTES + 1))).toThrow("preview_too_large");
    expect(() => checkPreview(new Uint8Array(0))).toThrow("preview_too_large");
  });

  it("keys a still by its piece and its hash, in a folder of the piece's own", () => {
    const key = previewKey(view.id, new Uint8Array([1, 2, 3]));
    expect(key).toMatch(new RegExp(`^studio/${view.id}/preview\\.[0-9a-f]{8}\\.jpg$`));
    expect(previewKey(view.id, new Uint8Array([1, 2, 4]))).not.toBe(key);
  });
});

describe("the row of a piece (W8 0f)", () => {
  it("is one upsert holding the title, owner, state, folder and the next line, and the preview and visual once they exist", async () => {
    const db = fakeDb({ rpc: { studio_piece_put: () => undefined } });
    await putPiece(db, view);
    await putPiece(db, {
      ...view,
      state: "done",
      preview: "studio/x/preview.ab12cd34.jpg",
      asset: "a1",
    });
    expect(db.calls.map((call) => call.args[0])).toEqual([
      {
        p_id: view.id,
        p_title: "Fairfield stair",
        p_owner: "social",
        p_state: "draft",
        p_folder: "2026-10-16-fairfield-stair",
        p_note: view.next,
      },
      expect.objectContaining({
        p_state: "done",
        p_preview_key: "studio/x/preview.ab12cd34.jpg",
        p_asset_id: "a1",
      }),
    ]);
  });

  it("throws the database's reason when it cannot be written", async () => {
    const db = fakeDb({ rpc: { studio_piece_put: () => new Error("duplicate key value") } });
    await expect(putPiece(db, view)).rejects.toThrow("studio_row_failed: duplicate key value");
  });
});
