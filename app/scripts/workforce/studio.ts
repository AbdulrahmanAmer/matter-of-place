// W8 item 0f: the studio folder. `~/.mop-workforce/studio/<date>-<name>/` holds one piece of work: its brief, every draft
// and revision (`drafts/01/`, `drafts/02/`, ...) and `status.md` (who, state, next). Every colleague may read every
// piece; only a run a person or Matter started writes (the toolkit of W8 0i names the studio for reading, and a
// decision on a piece is a `media` entry of Matter's answer, which the runner keeps only for Matter at full power).
// Nothing goes to Storage until a piece is approved; a piece that waits on the operator uploads only a small still, for
// the admin screen. The database keeps one small row per piece (`studio_pieces`), always written from the folder.
// This file is the part that does not depend on what the piece is: its states, its words, its row, its preview and
// the decision Matter makes. A reel's own making and its brief live in `reel.ts`.
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";

export const STUDIO = join(homedir(), ".mop-workforce", "studio");

export const pieceStates = [
  "queued",
  "working",
  "draft",
  "waiting_operator",
  "approved",
  "done",
  "failed",
] as const;
type PieceState = (typeof pieceStates)[number];

/** A piece as `status.md` and its row say it: no path, and none of the requester's words beyond its title. */
export type PieceView = {
  id: string;
  title: string;
  owner: string;
  thread: string;
  state: PieceState;
  /** The folder's name under the studio. */
  folder: string;
  drafts: number;
  /** The Storage key of the small preview, once one was uploaded for the admin screen. */
  preview: string | null;
  /** The pending visual the piece became. */
  asset: string | null;
  next: string;
  history: readonly { at: string; line: string }[];
};

/** One line of plain words from text that may run long or over several lines (a reviewer's reasons, a refusal). */
export function oneLine(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** What happens next to a piece, in fixed words (`status.md`'s Next, and the row's note). */
export function nextWords(input: {
  state: PieceState;
  drafts: number;
  /** The question Matter put to the operator. */
  question?: string | undefined;
  /** What Matter asked to change. */
  revise?: string | undefined;
  /** The reason a piece failed. */
  reason?: string | undefined;
  /** True when a finished piece stays in the studio because its subject is not on the site. */
  kept?: boolean | undefined;
}): string {
  const draft = String(input.drafts);
  switch (input.state) {
    case "queued":
      return input.revise === undefined
        ? "The runner makes it, one piece at a time."
        : `The designer revises it as Matter asked: ${oneLine(input.revise, 200)}`;
    case "working":
      return "It is being made on this laptop.";
    case "draft":
      return `Matter reviews draft ${draft}: approve it, ask for a revision, or hold it for the operator.`;
    case "waiting_operator":
      return `Waits for the operator (${oneLine(input.question ?? "", 200)}). A small preview is for the admin screen.`;
    case "approved":
      return `Approved; the runner uploads draft ${draft} once and records it.`;
    case "done":
      return input.kept === true
        ? "Done; its subject is not on the site, so the film stays in this folder."
        : "Done; uploaded once and waiting in Visuals for a person.";
    case "failed":
      return `Failed (${oneLine(input.reason ?? "no reason recorded", 200)}). Matter may approve its last draft again or ask for a revision.`;
  }
}

/** The text of `status.md`. */
export function statusText(view: PieceView): string {
  return [
    `# ${oneLine(view.title, 120)}`,
    "",
    `- Piece: ${view.folder}`,
    `- Who: ${view.owner}, asked in the ${view.thread} thread`,
    `- State: ${view.state}`,
    `- Drafts: ${String(view.drafts)}`,
    `- Next: ${view.next}`,
    `- Preview: ${view.preview === null ? "none" : "uploaded for the admin screen"}`,
    `- Visual: ${view.asset ?? "none"}`,
    "",
    "## What happened",
    ...view.history.map((entry) => `- ${entry.at} ${entry.line}`),
    "",
  ].join("\n");
}

/** The preview is a still of a draft, small enough for a list: past this it is refused, never sent. */
export const PREVIEW_MAX_BYTES = 150_000;

export function checkPreview(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0 || bytes.length > PREVIEW_MAX_BYTES) throw new Error("preview_too_large");
  return bytes;
}

/** The key of a piece's preview in the private `submissions` bucket; its hash keeps a new still from clashing with the old. */
export function previewKey(id: string, bytes: Uint8Array): string {
  return `studio/${id}/preview.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.jpg`;
}

/** Writes a piece's row (an upsert by the brief's id, so it can be repeated). A failure throws, naming the database's reason. */
export async function putPiece(db: Db, view: PieceView): Promise<void> {
  const { error } = await db.rpc("studio_piece_put", {
    p_id: view.id,
    p_title: view.title,
    p_owner: view.owner,
    p_state: view.state,
    p_folder: view.folder,
    p_note: view.next,
    ...(view.preview === null ? {} : { p_preview_key: view.preview }),
    ...(view.asset === null ? {} : { p_asset_id: view.asset }),
  });
  if (error !== null) throw new Error(`studio_row_failed: ${error.message}`);
}

/**
 * Matter's decision on a piece waiting for review (a `media` entry of its answer, or `reel.ts --decide`): approve it
 * (the runner uploads it once), ask for a revision (the designer takes it again with the note), or hold it for the
 * operator (the runner uploads a small preview and the piece waits for a person's word).
 */
export const studioDecisionSchema = z
  .object({
    skill: z.literal("studio"),
    piece: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    decision: z.enum(["approve", "revise", "ask_operator"]),
    note: z.string().min(1).max(500).optional(),
  })
  .superRefine((decision, ctx) => {
    if (decision.decision !== "approve" && decision.note === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: `${decision.decision} needs a note: what to change, or what to ask`,
      });
    }
  });
export type StudioDecision = z.infer<typeof studioDecisionSchema>;
