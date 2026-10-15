// What a colleague must know as fact before it reads the thread (2026-10-13 test 2, P-3454): which line woke it, so it
// answers that one, and what of its own is really waiting in Approvals, so an earlier claim in the thread is never
// taken as true. Matter said "the subject proposal is already in Approvals" when no row had ever been filed.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "../../src/server/lib/db.ts";
import { fenced } from "../matter/run.ts";

export interface WakingLine {
  author_name: string;
  author_kind: string;
  body: string;
}

export interface PendingProposal {
  action: string;
  summary: string;
  created_at: string;
}

export function groundingLines(
  woke: WakingLine | null,
  pending: readonly PendingProposal[],
): string[] {
  const lines: string[] = [];
  if (woke !== null) {
    const who = woke.author_kind === "human" ? "a person" : "not a person";
    lines.push(
      `What woke you: a line from ${woke.author_name} (${who}). Answer this line first; the thread below is context.\n` +
        fenced("THE LINE THAT WOKE YOU", woke.body),
    );
  }
  lines.push(
    pending.length === 0
      ? "Your proposals waiting in Approvals right now: none. If the thread says something of yours is in Approvals, it is not; file it again if it is still wanted."
      : `Your proposals waiting in Approvals right now (the only ones; nothing else of yours is there):\n${pending
          .map((item) => `- ${item.action}: ${item.summary} (filed ${item.created_at})`)
          .join("\n")}`,
  );
  return lines;
}

// W9 item 5: the review sequence (`workspace/05-plans/W9-review-sequence.md`) is the brief for a request. A run about a
// request is handed the sequence's section for the state the request is in, so the colleague checks, proposes and
// waits exactly as written; the runner reads the file from its checkout of main.
export const SEQUENCE_FILE = fileURLToPath(
  new URL("../../../workspace/05-plans/W9-review-sequence.md", import.meta.url),
);

/** The section of the sequence for one state (from its `## <state>` heading to the next), or null when it has none. */
export function sequenceSection(markdown: string, state: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${state}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return `The review sequence for a request in "${state}" (workspace/05-plans/W9-review-sequence.md); follow it:\n${body}`;
}

/** The sequence's section for the request an event is about, or null when the event is about no request. */
export async function requestSequence(
  client: Db,
  event: { entity: string | null; entity_id: string | null },
  file = SEQUENCE_FILE,
): Promise<string | null> {
  if (event.entity !== "submission" || event.entity_id === null || !existsSync(file)) return null;
  const { data } = await client
    .from("submissions")
    .select("workflow_state")
    .eq("id", event.entity_id)
    .maybeSingle();
  return data === null ? null : sequenceSection(readFileSync(file, "utf8"), data.workflow_state);
}
