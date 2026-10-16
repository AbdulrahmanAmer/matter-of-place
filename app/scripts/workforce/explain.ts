// W8 0d, the second half: a held message is explained before it is decided. `holdForMatter` (daemon.ts) queues the
// owner's run on the held line; that run sees only the triage, explains the context to the team in its thread and
// proposes nothing (`explainLines`, `ruleOutside` in triage.ts); at any end of it the runner queues Matter's read of the
// held line, once, and Matter's prompt carries the owner's explanation fenced as data. CRITICAL (security).
import type { Db } from "../../src/server/lib/db.ts";
import { HELD_AUTHOR, OUTSIDE_REPLY_PREFIX, shownBody } from "./triage.ts";

/** How much of the owner's explanation Matter's prompt carries. */
export const EXPLANATION_MAX = 3000;

/**
 * Whether a run is its owner's explanation of a held line: the line's thread, author kind and id as the database
 * holds them (never its text). The runner writes a held line as a system line in its owner's thread; Matter's own read
 * of the line is not an explanation.
 */
export function explainsHeld(
  agentSlug: string,
  line: { thread: string; author_kind: string | null; author_id: string | null },
): boolean {
  return (
    agentSlug !== "matter" &&
    line.author_kind === "system" &&
    line.author_id === HELD_AUTHOR &&
    line.thread === agentSlug
  );
}

/** Said in the thread when the explanation did not finish; Matter decides all the same. */
export const EXPLANATION_FAILED =
  "The owner's explanation of the held message did not finish; Matter decides without it.";

/**
 * The end of an explanation, whatever it was (answered, dropped, failed with a recorded reason): Matter's read of the
 * held line is queued, never twice for one line. It throws nothing, so a run that already failed is not failed again;
 * what could not be done is said in the thread, and the held line then waits for a person.
 */
export async function handToMatter(
  client: Db,
  agents: readonly { id: string; slug: string }[],
  heldId: string,
  thread: string,
  failed: boolean,
): Promise<"queued" | "already" | "not queued"> {
  const tell = (body: string) =>
    client.from("agent_messages").insert({
      thread,
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      body,
    });
  if (failed) await tell(EXPLANATION_FAILED);
  const matterRow = agents.find((row) => row.slug === "matter");
  const queued =
    matterRow === undefined
      ? null
      : await client
          .from("agent_runs")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", matterRow.id)
          .eq("message_id", heldId);
  if (matterRow !== undefined && queued !== null && queued.error === null) {
    if ((queued.count ?? 0) > 0) return "already";
    const { error } = await client
      .from("agent_runs")
      .insert({ agent_id: matterRow.id, cause: "message", message_id: heldId });
    if (error === null) return "queued";
  }
  await tell(
    "Matter's read of the held message could not be queued; it waits in this thread for a person.",
  );
  return "not queued";
}

/**
 * The owner's explanation as Matter's prompt shows it: the owner's latest reply in its thread newer than the held line
 * and not newer than Matter's run, fenced as a reply drafted from an outside message (`shownBody`), capped. Null when
 * there is none (the explanation failed, or said nothing).
 */
export async function ownerExplanation(
  client: Db,
  held: { id: string; thread: string },
  matterRunAt: string,
): Promise<string | null> {
  const { data: heldRows } = await client
    .from("agent_messages")
    .select("created_at")
    .eq("id", held.id)
    .limit(1);
  const heldAt = heldRows?.[0]?.created_at;
  if (heldAt === undefined) return null;
  const { data } = await client
    .from("agent_messages")
    .select("author_id, body")
    .eq("thread", held.thread)
    .eq("author_id", `${OUTSIDE_REPLY_PREFIX}${held.thread}`)
    .gt("created_at", heldAt)
    .lte("created_at", matterRunAt)
    .order("created_at", { ascending: false })
    .limit(1);
  const line = data?.[0];
  return line === undefined
    ? null
    : shownBody({ author_id: line.author_id, body: line.body.slice(0, EXPLANATION_MAX) });
}
