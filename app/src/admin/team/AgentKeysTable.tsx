import type { ComponentProps } from "react";
import type { AgentKeyRow } from "../../domain/admin-team";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";

type TableProps = ComponentProps<typeof DataTable<AgentKeyRow>>;

/** The agent keys: their agent, the areas they cover, when they were last used, and a revoke per live key. */
export function AgentKeysTable({
  agentName,
  pending,
  onRevoke,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & {
  agentName: (userId: string) => string;
  pending: boolean;
  onRevoke: (row: AgentKeyRow) => void;
}) {
  const columns: Column<AgentKeyRow>[] = [
    { key: "label", header: "Key", render: (row) => row.label },
    { key: "agent", header: "Agent", render: (row) => agentName(row.user_id) },
    { key: "scopes", header: "Areas", render: (row) => row.scopes.join(", ") },
    {
      key: "used",
      header: "Last used",
      render: (row) =>
        row.last_used_at === null ? "Never" : <LocalTime value={row.last_used_at} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.revoked_at === null ? (
          <span className="admin-actions">
            <StatusPill label="Live" tone="ok" />
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={pending}
              onClick={() => {
                onRevoke(row);
              }}
            >
              Revoke
            </button>
          </span>
        ) : (
          <StatusPill label="Revoked" />
        ),
    },
  ];
  return (
    <DataTable
      {...table}
      caption="Agent keys"
      columns={columns}
      rowId={(row) => row.id}
      empty={<EmptyState title="No agent keys yet" />}
    />
  );
}
