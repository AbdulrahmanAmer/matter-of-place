import { AdminApiError } from "../ui/admin-fetch";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { useEvents } from "./jobs-queries";
import type { EventsAnswer } from "./jobs-api";

type EventRow = EventsAnswer["events"][number];
type FailureRow = EventsAnswer["failures"][number];

const ID_PREFIX = 8;

function EntityCell({ entity, id }: { entity: string | null; id: string | null }) {
  if (id === null) return "The site";
  return (
    <a href={`/admin/jobs?entity=${id}`}>
      {entity ?? "record"} {id.slice(0, ID_PREFIX)}
    </a>
  );
}

function recipesOf(row: EventRow) {
  if (!row.processed) return "Not planned yet";
  if (row.recipes.length === 0) return "No recipe took it";
  return row.recipes.map((recipe) => recipe.name).join(", ");
}

const eventColumns: Column<EventRow>[] = [
  { key: "type", header: "Event", render: (row) => row.type },
  { key: "at", header: "When", render: (row) => <LocalTime value={row.at} /> },
  {
    key: "for",
    header: "For",
    render: (row) => <EntityCell entity={row.entity} id={row.entity_id} />,
  },
  { key: "processed", header: "Processed", render: (row) => (row.processed ? "Yes" : "Not yet") },
  { key: "recipes", header: "Recipe", render: recipesOf },
];

const failureColumns: Column<FailureRow>[] = [
  { key: "type", header: "Event", render: (row) => row.type },
  { key: "at", header: "When", render: (row) => <LocalTime value={row.at} /> },
  {
    key: "for",
    header: "For",
    render: (row) => <EntityCell entity={row.entity} id={row.entity_id} />,
  },
  { key: "attempts", header: "Attempts", render: (row) => String(row.attempts) },
  { key: "next", header: "Next try", render: (row) => <LocalTime value={row.next_at} /> },
  { key: "error", header: "Last error", render: (row) => row.last_error ?? "None recorded" },
];

/**
 * The Events panel of screen 16 (W7 item 5): the last 50 events with the recipe that took each, and the events no
 * recipe could plan. A payload is never part of the answer: it can hold a sealed token.
 */
export function EventsPanel() {
  const events = useEvents();
  const failure = events.error;
  const requestId = failure instanceof AdminApiError ? failure.requestId : undefined;
  const error =
    failure === null
      ? null
      : { message: failure.message, ...(requestId === undefined ? {} : { requestId }) };
  const failures = events.data?.failures ?? [];
  return (
    <section aria-labelledby="admin-events-title">
      <h2 id="admin-events-title">Events</h2>
      <p>
        What happened on the site, and which recipe took it. An event no recipe could plan is listed
        first and tried again.
      </p>
      <DataTable
        caption="Events that failed to plan"
        columns={failureColumns}
        rows={failures}
        rowId={(row) => row.event_id}
        empty={null}
      />
      <DataTable
        caption="Events"
        columns={eventColumns}
        rows={events.data?.events ?? []}
        rowId={(row) => row.id}
        loading={events.isPending}
        error={error}
        empty={
          <EmptyState title="No events yet">
            An event appears here when something happens.
          </EmptyState>
        }
      />
    </section>
  );
}
