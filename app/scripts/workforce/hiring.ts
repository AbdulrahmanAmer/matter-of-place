// Gap audit item 5 (Jay M3): who may add a colleague, and when a person must say yes first. Matter hires directly up to
// MATTER_DAILY_HIRES a day while the team stays under TEAM_CEILING; any other hirer, any hire past either limit and any
// hire on Opus waits in Approvals. No hire, direct or approved, ever carries the hire tool. Ruling H97.

import { createHash } from "node:crypto";
import type { HireInput } from "../../src/domain/workforce.ts";
import type { Db } from "../../src/server/lib/db.ts";

const DAY_MS = 86_400_000;

export const MATTER_DAILY_HIRES = 2;
export const TEAM_CEILING = 12;

export interface HireCounts {
  /** Colleagues Matter hired directly since midnight, Cairo time. */
  hiredToday: number;
  /** Colleagues on the team now. */
  team: number;
  /** H101: a signed-in person's message woke this run; anything else may carry outside text. */
  trusted: boolean;
}

export type HireRoute =
  { kind: "direct"; hire: HireInput } | { kind: "approval"; hire: HireInput; why: string };

/** Where one hire goes, with the hire tool always taken off. */
export function hireRoute(hirer: string, input: HireInput, counts: HireCounts): HireRoute {
  const hire = { ...input, tools: input.tools.filter((tool) => tool !== "hire") };
  if (hirer !== "matter") return { kind: "approval", hire, why: `proposed by @${hirer}` };
  if (!counts.trusted)
    return { kind: "approval", hire, why: "not asked for by a person in this run" };
  if (hire.model === "opus")
    return { kind: "approval", hire, why: "on Opus, which needs your word" };
  if (counts.hiredToday >= MATTER_DAILY_HIRES) {
    return {
      kind: "approval",
      hire,
      why: `past Matter's ${String(MATTER_DAILY_HIRES)} hires a day`,
    };
  }
  if (counts.team >= TEAM_CEILING) {
    return {
      kind: "approval",
      hire,
      why: `the team already has ${String(counts.team)} colleagues`,
    };
  }
  return { kind: "direct", hire };
}

/** The proposal a person reads in Approvals: the hire in words, and the hire itself for the database to apply. */
export function hireProposal(route: Extract<HireRoute, { kind: "approval" }>) {
  const { hire } = route;
  return {
    action: "hire",
    summary: `Hire ${hire.name} as ${hire.role} (${route.why})`,
    content: {
      body: [
        `${hire.name}, ${hire.role}.`,
        `Model: ${hire.model}. Tools: ${hire.tools.join(", ") || "none"}.`,
        hire.wake_on.length === 0
          ? "Wakes on: mentions only."
          : `Wakes on: ${hire.wake_on.join(", ")}.`,
        "",
        hire.instructions,
      ].join("\n"),
      hire,
    },
  };
}

/**
 * Applies a run's hires: a direct one joins the team, any other waits in Approvals, and the team thread says which.
 * The counts are read before each hire, so two hires in one answer count against the same limits in turn.
 */
export async function applyHires(
  db: Db,
  hirer: { slug: string; id: string },
  hires: readonly HireInput[],
  runId: string | null,
  trusted: boolean,
  now: Date = new Date(),
): Promise<void> {
  const say = (body: string) =>
    db.from("agent_messages").insert({
      thread: "team",
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      body,
    });
  for (const input of hires) {
    const [recent, team] = await Promise.all([
      db
        .from("agents")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(now.getTime() - DAY_MS).toISOString()),
      db.from("agents").select("id", { count: "exact", head: true }).neq("state", "off"),
    ]);
    const route = hireRoute(hirer.slug, input, {
      hiredToday: recent.count ?? MATTER_DAILY_HIRES,
      team: team.count ?? TEAM_CEILING,
      trusted,
    });
    if (route.kind === "direct") {
      const { error } = await db.from("agents").insert(route.hire);
      if (error === null) await say(`${route.hire.name} joined the team as ${route.hire.role}.`);
      continue;
    }
    const proposal = hireProposal(route);
    const { error } = await db.from("agent_approvals").insert({
      agent_id: hirer.id,
      run_id: runId,
      ...proposal,
      content_hash: createHash("sha256").update(JSON.stringify(proposal.content)).digest("hex"),
    });
    if (error === null)
      await say(`Proposed hiring ${route.hire.name}: it waits in Approvals (${route.why}).`);
  }
}
