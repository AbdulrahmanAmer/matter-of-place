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

/** Said in the thread when the owner is paused or off after the hold, so there is no explanation; Matter decides all the same. */
export const OWNER_UNAVAILABLE =
  "The owner of the held message is paused or off, so it cannot explain it; Matter decides without an explanation.";

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
 * The owner's explanation as Matter's prompt shows it (W8 0d second review): the line the owner's own finished run on
 * the held line recorded as its reply (`agent_runs.reply_message_id`), fenced as a reply drafted from an outside
 * message (`shownBody`), capped. The owner writes every outside reply into the one thread, so the run names its line:
 * no window of times (the runner's laptop and the database keep different clocks), and another message's reply is
 * never shown as this explanation, whatever it was written meanwhile. Null when there is none: no run, a run that did
 * not finish (failed, or still queued or running), or one that said nothing.
 */
export async function ownerExplanation(
  client: Db,
  held: { id: string; thread: string },
  ownerId: string,
): Promise<string | null> {
  const { data: runs } = await client
    .from("agent_runs")
    .select("state, reply_message_id")
    .eq("agent_id", ownerId)
    .eq("message_id", held.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const run = runs?.[0];
  if (run?.state !== "done" || run.reply_message_id === null) return null;
  const { data } = await client
    .from("agent_messages")
    .select("author_id, body")
    .eq("id", run.reply_message_id)
    .eq("thread", held.thread)
    .eq("author_id", `${OUTSIDE_REPLY_PREFIX}${held.thread}`)
    .limit(1);
  const line = data?.[0];
  return line === undefined
    ? null
    : shownBody({ author_id: line.author_id, body: line.body.slice(0, EXPLANATION_MAX) });
}

/** The fixed summary of an explanation run that never started because its owner was paused or off. */
export const OWNER_UNAVAILABLE_SUMMARY = "Owner paused or off (W8 0d)";

/**
 * Each loop of the runner: an explanation run still queued for an owner that is paused or off will not be claimed
 * (`claim_agent_run` takes only an idle or working colleague), so Matter's read of that held line would never be
 * queued. The run is closed with fixed words, the thread says why there is no explanation (`OWNER_UNAVAILABLE`), and
 * the line goes to Matter (`handToMatter`, once per line). Returns how many lines it handed on; it throws nothing a
 * reader of the loop could not already see in the thread.
 */
export async function handUnavailableOwners(client: Db): Promise<number> {
  const { data: agents } = await client.from("agents").select("id, slug, state");
  const away = (agents ?? []).filter((row) => row.state === "paused" || row.state === "off");
  if (away.length === 0) return 0;
  const { data: runs } = await client
    .from("agent_runs")
    .select("id, agent_id, message_id")
    .eq("state", "queued")
    .in(
      "agent_id",
      away.map((row) => row.id),
    );
  if (runs === null || runs.length === 0) return 0;
  const { data: lines } = await client
    .from("agent_messages")
    .select("id, thread, author_kind, author_id")
    .in(
      "id",
      runs.map((run) => run.message_id).filter((id): id is string => id !== null),
    );
  let handed = 0;
  for (const run of runs) {
    const owner = away.find((row) => row.id === run.agent_id);
    const line = lines?.find((row) => row.id === run.message_id);
    if (owner === undefined || line === undefined || run.message_id === null) continue;
    if (!explainsHeld(owner.slug, line)) continue;
    // no row back: another runner claimed the run since the read above, so its owner explains the line after all
    const { data: closed, error } = await client
      .from("agent_runs")
      .update({
        state: "done",
        finished_at: new Date().toISOString(),
        summary: OWNER_UNAVAILABLE_SUMMARY,
      })
      .eq("id", run.id)
      .eq("state", "queued")
      .select("id");
    if (error !== null || (closed ?? []).length === 0) continue;
    await client.from("agent_messages").insert({
      thread: line.thread,
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      body: OWNER_UNAVAILABLE,
    });
    await handToMatter(client, agents ?? [], run.message_id, line.thread, false);
    handed += 1;
  }
  return handed;
}
