import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";

// The Events panel of screen 16 (W7 item 5): the last events, the recipes that took each, and the events no recipe
// could plan. Read only. A payload can hold a sealed token (`subscriber.created`), so it is never selected.

const EVENT_LIMIT = 50;
const FAILURE_LIMIT = 50;

interface EventRecipe {
  id: string;
  name: string;
}

interface EventRow {
  id: string;
  type: string;
  at: string;
  entity: string | null;
  entity_id: string | null;
  processed: boolean;
  recipes: EventRecipe[];
}

interface FanoutFailure {
  event_id: string;
  type: string;
  at: string;
  entity: string | null;
  entity_id: string | null;
  attempts: number;
  next_at: string;
  last_error: string | null;
}

interface EventsAnswer {
  events: EventRow[];
  failures: FanoutFailure[];
}

const present = <T>(value: T | null): value is T => value !== null;

/** The recipes that planned jobs for each event, each once, in the order the jobs name them. */
async function recipesByEvent(db: Db, eventIds: string[]): Promise<Map<string, EventRecipe[]>> {
  const byEvent = new Map<string, EventRecipe[]>();
  if (eventIds.length === 0) return byEvent;
  const jobs = await db
    .from("jobs")
    .select("event_id, recipe_id")
    .in("event_id", eventIds)
    .not("recipe_id", "is", null);
  if (jobs.error !== null) throw fromRpcError(jobs.error);
  const planned = jobs.data.flatMap((job) =>
    present(job.event_id) && present(job.recipe_id)
      ? [{ eventId: job.event_id, recipeId: job.recipe_id }]
      : [],
  );
  const recipeIds = [...new Set(planned.map((job) => job.recipeId))];
  if (recipeIds.length === 0) return byEvent;
  const recipes = await db.from("automation_recipes").select("id, name").in("id", recipeIds);
  if (recipes.error !== null) throw fromRpcError(recipes.error);
  const names = new Map(recipes.data.map((recipe) => [recipe.id, recipe.name]));
  for (const { eventId, recipeId } of planned) {
    const taken = byEvent.get(eventId) ?? [];
    if (!taken.some((recipe) => recipe.id === recipeId)) {
      taken.push({ id: recipeId, name: names.get(recipeId) ?? "A recipe that no longer exists" });
    }
    byEvent.set(eventId, taken);
  }
  return byEvent;
}

/** The events still failing to plan, soonest retry first; the event's own columns ride along. */
async function fanoutFailures(db: Db): Promise<FanoutFailure[]> {
  const { data, error } = await db
    .from("event_fanout_failures")
    .select("event_id, attempts, next_at, last_error, events(type, at, entity, entity_id)")
    .order("next_at", { ascending: true })
    .limit(FAILURE_LIMIT);
  if (error !== null) throw fromRpcError(error);
  return data.map(({ events, ...failure }) => ({ ...failure, ...events }));
}

/** `GET /api/admin/jobs/events`: the 50 newest events with their recipes, and every event that failed to plan. */
export async function listEvents(actor: AdminActor, db: Db): Promise<EventsAnswer> {
  authorize(actor, "jobs.list");
  const events = await db
    .from("events")
    .select("id, type, at, entity, entity_id, processed_at")
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(EVENT_LIMIT);
  if (events.error !== null) throw fromRpcError(events.error);
  const recipes = await recipesByEvent(
    db,
    events.data.map((event) => event.id),
  );
  return {
    events: events.data.map(({ processed_at: processedAt, ...event }) => ({
      ...event,
      processed: processedAt !== null,
      recipes: recipes.get(event.id) ?? [],
    })),
    failures: await fanoutFailures(db),
  };
}
