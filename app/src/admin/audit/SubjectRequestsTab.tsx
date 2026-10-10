import { useState } from "react";
import {
  noteRequired,
  type SubjectRequestRow,
  type SubjectStatusAction,
} from "../../domain/admin-audit";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useCursorPages } from "../ui/use-cursor-pages";
import { useToast } from "../ui/use-toast";
import {
  useSubjectDelete,
  useSubjectExport,
  useSubjectOptOut,
  useSubjectRequests,
  useSubjectStatus,
} from "./audit-queries";

const KIND_LABEL: Readonly<Record<SubjectRequestRow["kind"], string>> = {
  access: "Access",
  deletion: "Deletion",
  opt_out: "Opt out",
  correction: "Correction",
};

/** The red line of the 45 day clock (screen 25). */
const URGENT_DAYS = 10;

type Pending =
  | { row: SubjectRequestRow; action: Exclude<SubjectStatusAction, "start_verification"> }
  | { row: SubjectRequestRow; action: "delete" | "opt_out" };

const DIALOG: Readonly<Record<Pending["action"], { title: string; confirm: string }>> = {
  confirm_identity: { title: "Identity confirmed", confirm: "Confirm identity" },
  reject: { title: "Reject this request", confirm: "Reject" },
  fulfil_correction: { title: "Mark corrected", confirm: "Mark corrected" },
  delete: { title: "Delete this person's data", confirm: "Delete" },
  opt_out: { title: "Opt out this address", confirm: "Opt out" },
};

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "This change could not be made.";

/** Saves the access bundle as a JSON file. */
function download(id: string, bundle: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `data-request-${id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** A button that shows only to actors holding `action`; the server checks again. */
function Act({
  action,
  label,
  disabled,
  onClick,
}: {
  action: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <RoleGate action={action}>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    </RoleGate>
  );
}

/**
 * Screen 25's second tab: the data requests with their 45 day clock. Identity comes first; once it is confirmed,
 * each kind offers its one fulfilling action (invariant 15).
 */
export function SubjectRequestsTab() {
  const toast = useToast();
  const pages = useCursorPages();
  const page = useSubjectRequests(pages.cursor);
  const status = useSubjectStatus();
  const exporting = useSubjectExport();
  const deleting = useSubjectDelete();
  const optingOut = useSubjectOptOut();
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const busy = status.isPending || exporting.isPending || deleting.isPending || optingOut.isPending;
  const nextCursor = page.data?.next_cursor ?? null;
  const loadError = page.error;

  const done = (message: string) => ({
    onSuccess: () => {
      toast({ message });
    },
    onError: (error: unknown) => {
      toast({ message: failure(error), tone: "danger" });
    },
  });
  const open = (next: Pending) => {
    setNote("");
    setNoteError(null);
    setPending(next);
  };

  const actions = (row: SubjectRequestRow) => {
    if (row.status === "fulfilled" || row.status === "rejected") return null;
    const verified = row.verified_at !== null;
    return (
      <span className="admin-actions">
        {row.status === "received" ? (
          <Act
            action="audit.subject_status"
            label="Start verification"
            disabled={busy}
            onClick={() => {
              status.mutate(
                { id: row.id, action: "start_verification" },
                done("Verification started."),
              );
            }}
          />
        ) : null}
        {row.status === "verifying" && !verified ? (
          <Act
            action="audit.subject_status"
            label="Identity confirmed"
            disabled={busy}
            onClick={() => {
              open({ row, action: "confirm_identity" });
            }}
          />
        ) : null}
        {verified && row.kind === "access" ? (
          <Act
            action="audit.subject_export"
            label="Export"
            disabled={busy}
            onClick={() => {
              exporting.mutate(row.id, {
                onSuccess: (bundle) => {
                  download(row.id, bundle);
                  toast({ message: "Export downloaded. The request is fulfilled." });
                },
                onError: (error) => {
                  toast({ message: failure(error), tone: "danger" });
                },
              });
            }}
          />
        ) : null}
        {verified && row.kind === "deletion" ? (
          <Act
            action="audit.subject_delete"
            label="Delete"
            disabled={busy}
            onClick={() => {
              open({ row, action: "delete" });
            }}
          />
        ) : null}
        {verified && row.kind === "opt_out" ? (
          <Act
            action="audit.subject_opt_out"
            label="Opt out"
            disabled={busy}
            onClick={() => {
              open({ row, action: "opt_out" });
            }}
          />
        ) : null}
        {verified && row.kind === "correction" ? (
          <Act
            action="audit.subject_status"
            label="Mark corrected"
            disabled={busy}
            onClick={() => {
              open({ row, action: "fulfil_correction" });
            }}
          />
        ) : null}
        <Act
          action="audit.subject_status"
          label="Reject"
          disabled={busy}
          onClick={() => {
            open({ row, action: "reject" });
          }}
        />
      </span>
    );
  };

  const columns: Column<SubjectRequestRow>[] = [
    {
      key: "received",
      header: "Received",
      render: (row) => <LocalTime value={row.received_at} style="date" />,
    },
    { key: "kind", header: "Kind", render: (row) => KIND_LABEL[row.kind] },
    { key: "email", header: "Address", render: (row) => row.email },
    {
      key: "days",
      header: "Days left",
      align: "end",
      render: (row) =>
        row.status === "fulfilled" || row.status === "rejected" ? (
          "Closed"
        ) : (
          <StatusPill
            label={String(row.days_left)}
            tone={row.days_left <= URGENT_DAYS ? "danger" : "neutral"}
          />
        ),
    },
    { key: "status", header: "Status", render: (row) => row.status },
    {
      key: "identity",
      header: "Identity",
      render: (row) => (row.verified_at === null ? "Not confirmed" : "Confirmed"),
    },
    { key: "actions", header: "Actions", render: actions },
  ];

  const confirm = () => {
    if (pending === null) return;
    const { row, action } = pending;
    const close = { onSettled: () => setPending(null) };
    if (action === "delete") {
      deleting.mutate(row.id, { ...done("The person's data is anonymised."), ...close });
      return;
    }
    if (action === "opt_out") {
      optingOut.mutate(row.id, { ...done("The address is opted out."), ...close });
      return;
    }
    const trimmed = note.trim();
    if (noteRequired.includes(action) && trimmed === "") {
      setNoteError("Add a note.");
      return;
    }
    status.mutate(
      { id: row.id, action, ...(trimmed === "" ? {} : { note: trimmed }) },
      { ...done("Request updated."), ...close },
    );
  };

  return (
    <>
      <DataTable
        caption="Data requests"
        columns={columns}
        rows={page.data?.items ?? []}
        rowId={(row) => row.id}
        loading={page.isPending}
        error={
          loadError === null
            ? null
            : {
                message: loadError.message,
                ...(loadError instanceof AdminApiError && loadError.requestId !== undefined
                  ? { requestId: loadError.requestId }
                  : {}),
              }
        }
        empty={<EmptyState title="No data requests" />}
        pager={pages.pager(nextCursor)}
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending === null ? "" : DIALOG[pending.action].title}
        confirmLabel={pending === null ? "" : DIALOG[pending.action].confirm}
        danger={pending?.action === "delete" || pending?.action === "reject"}
        pending={busy}
        onConfirm={confirm}
        onCancel={() => {
          setPending(null);
        }}
      >
        {pending === null ? null : pending.action === "delete" ? (
          <p>
            Every row of {pending.row.email} is anonymised: the address, name, phone and messages.
            This cannot be undone.
          </p>
        ) : pending.action === "opt_out" ? (
          <p>{pending.row.email} is unsubscribed and no mail is sent to it again.</p>
        ) : (
          <Field
            label="Note"
            hint={
              noteRequired.includes(pending.action)
                ? pending.action === "fulfil_correction"
                  ? "Required. Name what was corrected."
                  : "Required."
                : "Optional. How identity was confirmed."
            }
            {...(noteError === null ? {} : { error: noteError })}
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}
