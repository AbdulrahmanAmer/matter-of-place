import type { ComponentProps, SyntheticEvent } from "react";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { JobStatus } from "./JobStatus";
import {
  jobEntity,
  jobFilterNames,
  type Job,
  type JobFilterName,
  type JobFilters,
} from "./jobs-queries";

type TableProps = ComponentProps<typeof DataTable<Job>>;

const STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "dead",
  "waiting_approval",
  "cancelled",
] as const;

const words = (text: string) => text.replaceAll("_", " ");

const ID_PREFIX = 8;

function EntityCell({ job }: { job: Job }) {
  const entity = jobEntity(job);
  if (entity === null) return "system";
  return (
    <a
      href={`/admin/jobs?entity=${entity.id}`}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {entity.kind} {entity.id.slice(0, ID_PREFIX)}
    </a>
  );
}

const columns: Column<Job>[] = [
  { key: "type", header: "Type", render: (row) => words(row.type) },
  { key: "entity", header: "Entity", render: (row) => <EntityCell job={row} /> },
  { key: "status", header: "Status", render: (row) => <JobStatus job={row} /> },
  {
    key: "attempts",
    header: "Attempts",
    render: (row) => `${String(row.attempts)} of ${String(row.max_attempts)}`,
  },
  { key: "created", header: "Created", render: (row) => <LocalTime value={row.created_at} /> },
  {
    key: "finished",
    header: "Finished",
    render: (row) =>
      row.finished_at === null ? "Not finished" : <LocalTime value={row.finished_at} />,
  },
  { key: "error", header: "Error", render: (row) => row.error ?? "None" },
];

const field = (data: FormData, name: string): string | undefined => {
  const value = data.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
};

/** Status, type and error text; Filter applies them together. The entity filter is kept as the address has it. */
function JobFilterForm({
  values,
  onChange,
}: {
  values: JobFilters;
  onChange: (next: JobFilters) => void;
}) {
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Partial<Record<JobFilterName, string>> = {};
    for (const name of jobFilterNames) {
      const value = name === "entity" ? values.entity : field(data, name);
      if (value !== undefined) next[name] = value;
    }
    onChange(next);
  };
  return (
    <form
      key={JSON.stringify(values)}
      className="admin-job-filters"
      aria-label="Filter jobs"
      onSubmit={submit}
    >
      <Field label="Status">
        {(control) => (
          <select {...control} name="status" defaultValue={values.status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {words(status)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Type">
        {(control) => <input {...control} name="type" defaultValue={values.type ?? ""} />}
      </Field>
      <Field label="Error contains">
        {(control) => <input {...control} name="q" defaultValue={values.q ?? ""} />}
      </Field>
      <button type="submit" className="admin-button admin-button--quiet">
        Filter
      </button>
    </form>
  );
}

/** Screen 16's table: every job, newest first, with the record it belongs to; a row opens the job. */
export function JobsTable({
  filters,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty" | "toolbar"> & {
  filters: { values: JobFilters; onChange: (next: JobFilters) => void };
}) {
  const filtered = jobFilterNames.some((name) => filters.values[name] !== undefined);
  return (
    <DataTable
      caption="Jobs"
      columns={columns}
      rowId={(row) => row.id}
      toolbar={<JobFilterForm values={filters.values} onChange={filters.onChange} />}
      empty={
        filtered ? (
          <EmptyState title="No jobs match">Nothing matches these filters.</EmptyState>
        ) : (
          <EmptyState title="No jobs yet">A job appears here when an event plans work.</EmptyState>
        )
      }
      {...table}
    />
  );
}
