import { useState } from "react";
import {
  redirectSchema,
  redirectStatusChoices,
  type LinkCheck,
  type OldAddress,
  type RedirectPutInput,
  type RedirectRow,
} from "../../domain/admin-settings";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { useCursorPages } from "../ui/use-cursor-pages";
import { useToast } from "../ui/use-toast";
import { useArchiveRedirect, useRedirects, useSaveRedirect } from "./settings-queries";

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "This redirect could not be saved.";

/** The add or edit form. The rules are checked here against the listed rows, and again by the server. */
function RedirectForm({
  row,
  active,
  pending,
  onSave,
  onCancel,
}: {
  row: RedirectRow | null;
  active: readonly RedirectRow[];
  pending: boolean;
  onSave: (input: RedirectPutInput, refused: (message: string) => void) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(row?.from_path ?? "");
  const [to, setTo] = useState(row?.to_path ?? "");
  const [status, setStatus] = useState(String(row?.status ?? 301));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="admin-fields"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = redirectSchema(active).safeParse({
          ...(row === null ? {} : { id: row.id }),
          from_path: from,
          to_path: to,
          status: Number(status),
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check this redirect.");
          return;
        }
        setError(null);
        onSave(parsed.data, setError);
      }}
    >
      <Field label="Old address" hint="A path on this site, such as /summer.">
        {(control) => (
          <input
            {...control}
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label="New address" hint="The path visitors are sent to.">
        {(control) => (
          <input
            {...control}
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label="Status"
        hint="301 for a move that lasts, 302 for a while."
        {...(error === null ? {} : { error })}
      >
        {(control) => (
          <select
            {...control}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          >
            {redirectStatusChoices.map((choice) => (
              <option key={choice} value={String(choice)}>
                {choice}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="admin-actions">
        <button type="submit" className="admin-button" disabled={pending}>
          {row === null ? "Add redirect" : "Save redirect"}
        </button>
        {row === null ? null : (
          <button type="button" className="admin-button admin-button--quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The test-a-link box: a typed path, sent when the form is submitted, answered by the same read as the lists. */
function LinkTester({
  check,
  pending,
  onTest,
}: {
  check: LinkCheck | null;
  pending: boolean;
  onTest: (path: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <form
        className="admin-fields"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const path = typed.trim();
          if (path === "") {
            setError("Type an address to test.");
            return;
          }
          setError(null);
          onTest(path);
        }}
      >
        <Field
          label="Address to test"
          hint="A path such as /summer, or an address copied from the site."
          {...(error === null ? {} : { error })}
        >
          {(control) => (
            <input
              {...control}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          )}
        </Field>
        <div className="admin-actions">
          <button type="submit" className="admin-button" disabled={pending}>
            Test link
          </button>
        </div>
      </form>
      {check === null ? null : (
        <div role="status">
          {check.steps.length === 0 ? (
            <p>{`No redirect: the site answers ${check.path} as it is.`}</p>
          ) : (
            <ol>
              {check.steps.map((step) => (
                <li key={step.from}>
                  {`${step.from} goes to ${step.to} (${String(step.status)}, ${
                    step.source === "redirect" ? "redirect" : "old property address"
                  }).`}
                </li>
              ))}
            </ol>
          )}
          {check.loop ? <p>These addresses lead in a circle.</p> : null}
        </div>
      )}
    </>
  );
}

const oldAddressColumns: Column<OldAddress>[] = [
  { key: "old", header: "Old address", render: (row) => `/property/${row.slug}` },
  {
    key: "now",
    header: "Leads to",
    render: (row) => `/property/${row.current_slug} (${row.title})`,
  },
  { key: "state", header: "Property", render: (row) => (row.live ? "Published" : "Not published") },
];

/**
 * Screen 24's redirects: the active rows, a form to add or edit one, and remove, which archives the row. Below them
 * the old addresses of renamed properties (read only) and a box that tests where a link leads.
 */
export function RedirectsSection() {
  const toast = useToast();
  const pages = useCursorPages();
  const oldPages = useCursorPages();
  const [tested, setTested] = useState<string | null>(null);
  const page = useRedirects({ cursor: pages.cursor, oldCursor: oldPages.cursor, path: tested });
  const save = useSaveRedirect();
  const archive = useArchiveRedirect();
  const [editing, setEditing] = useState<RedirectRow | null>(null);
  const [removing, setRemoving] = useState<RedirectRow | null>(null);
  const rows = page.data?.items ?? [];
  const nextCursor = page.data?.next_cursor ?? null;
  const oldAddresses = page.data?.old_addresses.items ?? [];
  const oldNextCursor = page.data?.old_addresses.next_cursor ?? null;
  const check = page.isPlaceholderData ? null : (page.data?.check ?? null);
  const loadError = page.error;
  const columns: Column<RedirectRow>[] = [
    { key: "from", header: "From", render: (row) => row.from_path },
    { key: "to", header: "To", render: (row) => row.to_path },
    { key: "status", header: "Status", render: (row) => String(row.status) },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <span className="admin-actions">
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => {
              setEditing(row);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => {
              setRemoving(row);
            }}
          >
            Remove
          </button>
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        caption="Redirects"
        columns={columns}
        rows={rows}
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
        empty={<EmptyState title="No redirects" />}
        pager={pages.pager(nextCursor)}
      />
      <RedirectForm
        key={editing?.id ?? "new"}
        row={editing}
        active={rows}
        pending={save.isPending}
        onSave={(input, refused) => {
          save.mutate(input, {
            onSuccess: () => {
              toast({ message: "Redirect saved." });
              setEditing(null);
            },
            onError: (error) => {
              refused(failure(error));
            },
          });
        }}
        onCancel={() => {
          setEditing(null);
        }}
      />
      <h3>Old property addresses</h3>
      <DataTable
        caption="Old property addresses"
        columns={oldAddressColumns}
        rows={oldAddresses}
        rowId={(row) => row.slug}
        loading={page.isPending}
        empty={<EmptyState title="No renamed properties" />}
        pager={oldPages.pager(oldNextCursor)}
      />
      <h3>Test a link</h3>
      <LinkTester check={check} pending={page.isFetching} onTest={setTested} />
      <ConfirmDialog
        open={removing !== null}
        title="Remove this redirect"
        confirmLabel="Remove"
        danger
        pending={archive.isPending}
        onConfirm={() => {
          if (removing === null) return;
          archive.mutate(removing.id, {
            onSuccess: () => {
              toast({ message: "Redirect removed." });
            },
            onError: (error) => {
              toast({ message: failure(error), tone: "danger" });
            },
            onSettled: () => {
              setRemoving(null);
            },
          });
        }}
        onCancel={() => {
          setRemoving(null);
        }}
      >
        <p>
          {removing === null
            ? null
            : `${removing.from_path} will no longer send visitors to ${removing.to_path}.`}
        </p>
      </ConfirmDialog>
    </>
  );
}
