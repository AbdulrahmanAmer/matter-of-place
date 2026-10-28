// W7 item 11 (the item's own text): "What happened to their proposals: approved, declined (with the reason) or edited
// before sending, for every colleague, not only the declines that became lessons."
// Each colleague is shown its own newest decided proposals (its own `agent_id`, never another's): what each was (its
// action and its one-line summary, the colleague's own words; a run about outside text writes fixed ones), and what a
// person did with it. A decline's reason is our staff's words and is shown; the body of a proposal and a person's
// edited version never are. The read is one ordered page of NEWEST rows, not a count: the block is there so the next
// draft follows the newest decisions, ten of them fit a prompt, and the share approved as drafted is already the
// scorecard's number (scorecard.ts, `asIsPercent`).
import type { Db } from "../../src/server/lib/db.ts";

const NEWEST = 10;
const SUMMARY_CAP = 120;
const REASON_CAP = 300;

const ACTIONS: Record<string, string> = {
  reply_inquiry: "Reply to an inquiry",
  social_post: "Social post",
  newsletter_issue: "Place Notes issue",
  campaign_plan: "Paid campaign plan",
  instructions_change: "Change to a colleague's instructions",
  hire: "A new colleague",
  admin_call: "A change you asked to make",
};

/** A decided proposal as the block reads it. */
export interface OutcomeRow {
  action: string;
  summary: string;
  state: string;
  reason: string | null;
  edited: boolean;
  decided_at: string | null;
}

/** One line of text, at most `cap` characters. */
const oneLine = (text: string, cap: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
};

function outcome(row: OutcomeRow): string {
  if (row.state === "rejected")
    return row.reason === null || row.reason.trim() === ""
      ? "declined, no reason given"
      : `declined, because: "${oneLine(row.reason, REASON_CAP)}"`;
  return row.edited ? "approved after a person edited it" : "approved as drafted";
}

/** The block: each decided proposal, newest first, with what became of it. */
export function outcomesBlock(rows: readonly OutcomeRow[]): string {
  return [
    `What happened to your proposals (your ${String(NEWEST)} newest decided, newest first):`,
    ...(rows.length === 0
      ? ["- none decided yet"]
      : rows.map(
          (row) =>
            `- ${row.decided_at?.slice(0, 10) ?? "undated"}, ${ACTIONS[row.action] ?? row.action} "${oneLine(row.summary, SUMMARY_CAP)}": ${outcome(row)}`,
        )),
  ].join("\n");
}

/** The block for any colleague's inside run, over its own proposals. A failed read is one plain line. */
export async function proposalOutcomeLines(client: Db, agentId: string): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("agent_approvals")
      .select("action, summary, state, reason, edited_content, decided_at")
      .eq("agent_id", agentId)
      .in("state", ["approved", "rejected"])
      .order("decided_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(NEWEST);
    if (error !== null) throw new Error("not read");
    return [
      outcomesBlock(
        data.map(({ edited_content, ...row }) => ({ ...row, edited: edited_content !== null })),
      ),
    ];
  } catch {
    return [
      "What happened to your proposals could not be read for this run; say so if a draft depends on it.",
    ];
  }
}
