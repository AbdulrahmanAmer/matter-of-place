import type { ComponentProps } from "react";
import type { Issue } from "../../domain/admin-newsletter";
import { pluralize } from "../../lib/format";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";

type TableProps = ComponentProps<typeof DataTable<Issue>>;

const STATUS: Readonly<Record<Issue["status"], { label: string; tone: Tone }>> = {
  draft: { label: "Draft", tone: "neutral" },
  approved: { label: "Approved", tone: "info" },
  sending: { label: "Sending", tone: "warning" },
  sent: { label: "Sent", tone: "ok" },
};

/** The status as a pill, shared by the list and the editor so both name a state the same way. */
export function IssueStatus({ status }: { status: Issue["status"] }) {
  return <StatusPill {...STATUS[status]} />;
}

function whenIssue({ status, scheduled_for, sent_at }: Issue) {
  if (status === "sent" && sent_at !== null) return <LocalTime value={sent_at} />;
  if (status !== "draft" && scheduled_for !== null) {
    return (
      <>
        Scheduled <LocalTime value={scheduled_for} />
      </>
    );
  }
  return null;
}

const columns: Column<Issue>[] = [
  {
    key: "number",
    header: "Issue",
    render: (row) => (
      <a
        href={`/admin/newsletter/${row.id}`}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        No. {row.number}
      </a>
    ),
  },
  { key: "status", header: "Status", render: (row) => <IssueStatus status={row.status} /> },
  { key: "subject", header: "Subject", render: (row) => row.subject },
  {
    key: "blocks",
    header: "Blocks",
    align: "end",
    render: (row) => `${String(row.blocks.length)} ${pluralize(row.blocks.length, "block")}`,
  },
  { key: "when", header: "Sent or scheduled", render: whenIssue },
];

/** Screen 13, first tab: every Place Notes issue, newest first. */
export function IssuesTable(table: Omit<TableProps, "caption" | "columns" | "rowId" | "empty">) {
  return (
    <DataTable
      caption="Place Notes issues"
      columns={columns}
      rowId={(row) => row.id}
      empty={
        <EmptyState title="No issue yet">
          An issue is built every two weeks from what was published since the last one.
        </EmptyState>
      }
      {...table}
    />
  );
}
