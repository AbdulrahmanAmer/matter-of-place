import type { ComponentProps } from "react";
import type { TeamUser } from "../../domain/admin-team";
import { appRoles, roleLabels } from "../../domain/contracts";
import type { AppRole } from "../../domain/rows";
import { ActorBadge } from "../ui/ActorBadge";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";

type TableProps = ComponentProps<typeof DataTable<TeamUser>>;

interface UserActions {
  pending: boolean;
  onGrant: (id: string, role: AppRole) => void;
  onRevoke: (id: string, role: AppRole) => void;
  onDisable: (id: string, disabled: boolean) => void;
}

function RoleList({ row, actions }: { row: TeamUser; actions: UserActions }) {
  const missing = appRoles.filter((role) => !row.roles.includes(role));
  return (
    <div className="admin-actions">
      {row.roles.map((role) => (
        <span key={role} className="admin-pill">
          {roleLabels[role]}
          {/* The last role is not offered: a user without one leaves this list (disable instead). */}
          {row.roles.length > 1 ? (
            <button
              type="button"
              className="admin-button admin-button--quiet"
              aria-label={`Remove ${roleLabels[role]} from ${row.display_name ?? row.email}`}
              disabled={actions.pending}
              onClick={() => {
                actions.onRevoke(row.user_id, role);
              }}
            >
              Remove
            </button>
          ) : null}
        </span>
      ))}
      {missing.length > 0 ? (
        <select
          aria-label={`Add a role to ${row.display_name ?? row.email}`}
          value=""
          disabled={actions.pending}
          onChange={(event) => {
            const role = missing.find((item) => item === event.target.value);
            if (role !== undefined) actions.onGrant(row.user_id, role);
          }}
        >
          <option value="">Add a role</option>
          {missing.map((role) => (
            <option key={role} value={role}>
              {roleLabels[role]}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/** Screen 23's users: people and agent accounts, their roles, whether they are active, and when they last acted. */
export function UsersTable({
  actions,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty"> & { actions: UserActions }) {
  const columns: Column<TeamUser>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => <ActorBadge name={row.display_name ?? row.email} kind={row.actor_kind} />,
    },
    { key: "email", header: "Email", render: (row) => row.email },
    { key: "roles", header: "Roles", render: (row) => <RoleList row={row} actions={actions} /> },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="admin-actions">
          <StatusPill
            label={row.disabled ? "Disabled" : "Active"}
            tone={row.disabled ? "danger" : "neutral"}
          />
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={actions.pending}
            onClick={() => {
              actions.onDisable(row.user_id, !row.disabled);
            }}
          >
            {row.disabled ? "Enable" : "Disable"}
          </button>
        </span>
      ),
    },
    {
      key: "active",
      header: "Last active",
      render: (row) =>
        row.last_active_at === null ? "Never" : <LocalTime value={row.last_active_at} />,
    },
  ];
  return (
    <DataTable
      {...table}
      caption="Team"
      columns={columns}
      rowId={(row) => row.user_id}
      empty={<EmptyState title="No one on the team yet" />}
    />
  );
}
