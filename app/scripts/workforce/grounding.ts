// What a colleague must know as fact before it reads the thread (2026-10-13 test 2, P-3454): which line woke it, so it
// answers that one, and what of its own is really waiting in Approvals, so an earlier claim in the thread is never
// taken as true. Matter said "the subject proposal is already in Approvals" when no row had ever been filed.
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
