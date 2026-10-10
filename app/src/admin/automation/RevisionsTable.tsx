import { useState, type ReactNode } from "react";
import { ActorBadge } from "../ui/ActorBadge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { DiffView } from "../ui/DiffView";
import { Drawer } from "../ui/Drawer";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import { useRestoreRevision, type RevisionRow } from "./automation-queries";
import { RequestFailure } from "./RequestFailure";
import { revisionTables } from "./revision-tables";

function subjectOf(row: RevisionRow): string {
  const table = Object.entries(revisionTables).find(([name]) => name === row.table_name)?.[1];
  const name = table === undefined ? undefined : (row.after ?? row.before)?.[table.name];
  return `${table?.label ?? row.table_name}${typeof name === "string" ? ` · ${name}` : ""}`;
}

function kindOf(row: RevisionRow): string {
  if (row.before === null) return "Created";
  if (row.after === null) return "Deleted";
  return row.note?.startsWith("restore:") === true ? "Restored" : "Edited";
}

function ActorOf({ row }: { row: RevisionRow }) {
  if (row.actor_kind === "agent") return <ActorBadge name="Automation key" kind="agent" />;
  if (row.actor_kind === "human") return <ActorBadge name="Team member" kind="human" />;
  return <ActorBadge name="Direct edit" kind="system" />;
}

const columns: readonly Column<RevisionRow>[] = [
  { key: "at", header: "When", render: (row) => <LocalTime value={row.at} /> },
  { key: "subject", header: "Change", render: subjectOf },
  { key: "kind", header: "Kind", render: kindOf },
  { key: "actor", header: "Who", render: (row) => <ActorOf row={row} /> },
];

/** One revision: what it changed and, for a person who may restore, the way back to the values before it. */
function RevisionDrawer({ row, onClose }: { row: RevisionRow; onClose: () => void }) {
  const toast = useToast();
  const restore = useRestoreRevision();
  const [asking, setAsking] = useState(false);

  const cancel = () => {
    setAsking(false);
    restore.reset();
  };
  const confirm = () => {
    restore.mutate(row.id, {
      onSuccess: () => {
        toast({ message: "Restored. The change is in the list as a new revision." });
        onClose();
      },
    });
  };

  return (
    <>
      <Drawer open title={subjectOf(row)} onClose={onClose}>
        <div className="admin-revision">
          <dl className="admin-revision__meta">
            <dt>When</dt>
            <dd>
              <LocalTime value={row.at} />
            </dd>
            <dt>Kind</dt>
            <dd>{kindOf(row)}</dd>
            <dt>Who</dt>
            <dd>
              <ActorOf row={row} />
            </dd>
          </dl>
          <DiffView before={row.before} after={row.after} />
          {row.before === null ? (
            <p>This revision created the row, so there is nothing earlier to restore.</p>
          ) : (
            <RoleGate action="automation.revisions_restore">
              <div className="admin-actions">
                <button
                  type="button"
                  className="admin-button"
                  onClick={() => {
                    setAsking(true);
                  }}
                >
                  Restore the values before this change
                </button>
              </div>
            </RoleGate>
          )}
        </div>
      </Drawer>
      <ConfirmDialog
        open={asking}
        title="Restore the earlier values"
        confirmLabel="Restore"
        pending={restore.isPending}
        onConfirm={confirm}
        onCancel={cancel}
      >
        <p>
          {subjectOf(row)} goes back to the values in the Before column. The restore is recorded as
          a new revision.
        </p>
        {restore.isError ? <RequestFailure error={restore.error} /> : null}
      </ConfirmDialog>
    </>
  );
}

/** Screen 21's list: one revision per row, newest first; a row opens its diff and, for those who may, the restore. */
export function RevisionsTable({
  rows,
  loading,
  error,
  toolbar,
  pager,
}: {
  rows: readonly RevisionRow[];
  loading: boolean;
  error: { message: string; requestId?: string } | null;
  toolbar: ReactNode;
  pager: { hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void };
}) {
  const [open, setOpen] = useState<RevisionRow | null>(null);
  return (
    <>
      <DataTable
        caption="Revisions, newest first"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        loading={loading}
        error={error}
        empty={<EmptyState title="No revisions">Nothing has been changed here yet.</EmptyState>}
        onOpen={setOpen}
        toolbar={toolbar}
        pager={pager}
      />
      {open === null ? null : (
        <RevisionDrawer
          row={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}
