import { useState, type ComponentProps } from "react";
import type { AuditRow, auditFilterNames } from "../../domain/admin-audit";
import { formatInZone, marketTimezone, toUtc } from "../../domain/market-time";
import { ActorBadge } from "../ui/ActorBadge";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { useAdminMe } from "../ui/admin-me";
import { actionWords, entityWords } from "./audit-words";

type FilterName = (typeof auditFilterNames)[number];

type Values = Readonly<Partial<Record<FilterName, string>>>;

type TableProps = ComponentProps<typeof DataTable<AuditRow>>;

const EASTERN = marketTimezone(null);

/** Who did it, in words: you, a team member, a colleague of the AI team, or the system itself. */
function ActorCell({ row }: { row: AuditRow }) {
  const me = useAdminMe();
  if (row.actor_id === null) return "The system";
  const name =
    row.actor_id === me.actor.id
      ? "You"
      : row.actor_kind === "agent"
        ? "A colleague (AI)"
        : "A team member";
  return (
    <span title={row.actor_id}>
      <ActorBadge name={name} kind={row.actor_kind ?? "human"} />
    </span>
  );
}

const columns: Column<AuditRow>[] = [
  { key: "at", header: "When", render: (row) => <LocalTime value={row.at} /> },
  { key: "actor", header: "Who", render: (row) => <ActorCell row={row} /> },
  {
    key: "action",
    header: "What happened",
    render: (row) => (
      <span className="admin-audit__action">
        {actionWords(row.action)}
        <code>{row.action}</code>
      </span>
    ),
  },
  {
    key: "entity",
    header: "To what",
    render: (row) => (
      <span title={row.entity_id ?? row.entity}>{entityWords(row.entity, row.entity_id)}</span>
    ),
  },
];

const textFilters: { name: FilterName; label: string; hint?: string }[] = [
  { name: "action", label: "Action", hint: "As in submissions.accept" },
  { name: "entity", label: "Entity", hint: "As in submission or settings.site" },
  { name: "actor", label: "Actor id" },
  { name: "request_id", label: "Request id" },
];

/** The text filters apply on Apply; a time typed in Eastern time is sent as UTC (GD-06). */
function AuditFilters({ values, onChange }: { values: Values; onChange: (next: Values) => void }) {
  const [draft, setDraft] = useState<Values>(values);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const now = (value: string) => `Now set to ${formatInZone(value, EASTERN, "datetime")}`;
  return (
    <form
      className="admin-toolbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onChange({
          ...draft,
          ...(from === "" ? {} : { from: toUtc(from, EASTERN) }),
          ...(to === "" ? {} : { to: toUtc(to, EASTERN) }),
        });
      }}
    >
      <Field label="Actor kind">
        {(control) => (
          <select
            {...control}
            value={draft.kind ?? ""}
            onChange={(event) => {
              setDraft({ ...draft, kind: event.target.value });
            }}
          >
            <option value="">All</option>
            <option value="human">People</option>
            <option value="agent">Agents</option>
          </select>
        )}
      </Field>
      <Field
        label="From (Eastern time)"
        {...(values.from === undefined ? {} : { hint: now(values.from) })}
      >
        {(control) => (
          <input
            {...control}
            type="datetime-local"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label="Before (Eastern time)"
        {...(values.to === undefined ? {} : { hint: now(values.to) })}
      >
        {(control) => (
          <input
            {...control}
            type="datetime-local"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        )}
      </Field>
      <button type="submit" className="admin-button">
        Apply
      </button>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        onClick={() => {
          onChange({});
        }}
      >
        Clear
      </button>
      <details
        className="admin-more"
        open={textFilters.some((filter) => values[filter.name] !== undefined)}
      >
        <summary>More filters</summary>
        <div className="admin-toolbar">
          {textFilters.map((filter) => (
            <Field
              key={filter.name}
              label={filter.label}
              {...(filter.hint === undefined ? {} : { hint: filter.hint })}
            >
              {(control) => (
                <input
                  {...control}
                  type="search"
                  maxLength={200}
                  value={draft[filter.name] ?? ""}
                  onChange={(event) => {
                    setDraft({ ...draft, [filter.name]: event.target.value.trim() });
                  }}
                />
              )}
            </Field>
          ))}
        </div>
      </details>
    </form>
  );
}

/** Screen 25: every audited change, newest first; a row opens what changed. */
export function AuditTable({
  filters,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & {
  filters: { values: Values; onChange: (next: Values) => void };
}) {
  const filtered = Object.keys(filters.values).length > 0;
  return (
    <>
      <AuditFilters
        key={JSON.stringify(filters.values)}
        values={filters.values}
        onChange={filters.onChange}
      />
      <DataTable
        caption="Audit log"
        columns={columns}
        rowId={(row) => String(row.id)}
        empty={
          filtered ? (
            <EmptyState title="Nothing matches">
              No audited change matches these filters.
            </EmptyState>
          ) : (
            <EmptyState title="Nothing audited yet">
              Every change made in the admin appears here.
            </EmptyState>
          )
        }
        {...table}
      />
    </>
  );
}
