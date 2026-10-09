import { useState } from "react";
import { declineReasonSchema } from "../../domain/automation";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import {
  useReorderReasons,
  useSaveReason,
  type ReasonDraft,
  type ReasonRow,
} from "./automation-queries";
import { RequestFailure } from "./RequestFailure";

type Problems = Partial<Record<"code" | "label" | "email_paragraph", string>>;

const blank: ReasonDraft = { code: "", label: "", email_paragraph: "", enabled: true };

/** What the form can tell before the server is asked: a blank label or code, then the domain schema's own limits. */
function problemsOf(draft: ReasonDraft): Problems {
  const found: Problems = {};
  if (draft.code === "") found.code = "Required";
  if (draft.label.trim() === "") found.label = "Required";
  const parsed = declineReasonSchema.safeParse(draft);
  if (parsed.success) return found;
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "code" || field === "label" || field === "email_paragraph") {
      found[field] ??= issue.message;
    }
  }
  return found;
}

/** The form for a new reason (`reason` is null) or for the edit of one; a reason's code never changes. */
function ReasonForm({ reason, onDone }: { reason: ReasonRow | null; onDone: () => void }) {
  const toast = useToast();
  const save = useSaveReason();
  const [draft, setDraft] = useState<ReasonDraft>(
    reason === null
      ? blank
      : {
          code: reason.code,
          label: reason.label,
          email_paragraph: reason.email_paragraph,
          enabled: reason.enabled,
        },
  );
  const [checked, setChecked] = useState(false);
  const shown = checked ? problemsOf(draft) : {};

  const submit = () => {
    setChecked(true);
    if (Object.keys(problemsOf(draft)).length > 0) return;
    save.mutate(
      {
        id: reason?.id ?? null,
        draft,
        patch: {
          label: draft.label,
          email_paragraph: draft.email_paragraph,
          enabled: draft.enabled,
        },
      },
      {
        onSuccess: () => {
          toast({ message: reason === null ? "Reason added." : "Reason saved." });
          onDone();
        },
      },
    );
  };

  return (
    <form
      noValidate
      className="admin-reason-form"
      aria-label={reason === null ? "New reason" : `Edit ${reason.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="admin-reason-form__fields" disabled={save.isPending}>
        <Field
          label="Code"
          hint={reason === null ? "Stays the same once saved." : "The code does not change."}
          {...(shown.code === undefined ? {} : { error: shown.code })}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              value={draft.code}
              disabled={reason !== null}
              onChange={(event) => {
                setDraft({ ...draft, code: event.target.value });
              }}
            />
          )}
        </Field>
        <Field label="Label" {...(shown.label === undefined ? {} : { error: shown.label })}>
          {(control) => (
            <input
              {...control}
              type="text"
              value={draft.label}
              onChange={(event) => {
                setDraft({ ...draft, label: event.target.value });
              }}
            />
          )}
        </Field>
        <Field
          label="Email paragraph"
          hint="The paragraph the decline email carries. Leave it empty when the editor's note is the message."
          {...(shown.email_paragraph === undefined ? {} : { error: shown.email_paragraph })}
        >
          {(control) => (
            <textarea
              {...control}
              rows={4}
              value={draft.email_paragraph}
              onChange={(event) => {
                setDraft({ ...draft, email_paragraph: event.target.value });
              }}
            />
          )}
        </Field>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => {
              setDraft({ ...draft, enabled: event.target.checked });
            }}
          />
          Reason on
        </label>
      </fieldset>
      <div className="admin-actions">
        <button type="submit" className="admin-button" disabled={save.isPending}>
          {reason === null ? "Add reason" : "Save reason"}
        </button>
        <button type="button" className="admin-button admin-button--quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
      {save.isError ? <RequestFailure error={save.error} className="admin-field__error" /> : null}
    </form>
  );
}

/** The ids with the one at `from` swapped with its neighbour `step` places away. */
function moved(items: readonly ReasonRow[], from: number, step: -1 | 1): string[] {
  const ids = items.map((item) => item.id);
  const mine = ids[from];
  const neighbour = ids[from + step];
  if (mine === undefined || neighbour === undefined) return ids;
  
  ids[from + step] = mine;
  return ids;
}

/**
 * Screen 19. The rows are in the order of the decline menu; Move up and Move down send the whole new order in one
 * request. The controls show only to a role the matrix allows, and the server checks again.
 */
export function ReasonsTable({ items }: { items: readonly ReasonRow[] }) {
  const reorder = useReorderReasons();
  const [open, setOpen] = useState<string | null>(null);
  const editing = items.find((item) => item.id === open) ?? null;

  return (
    <>
      {items.length === 0 ? (
        <EmptyState title="No decline reasons">
          A declined submission has no reason to choose from until one is added.
        </EmptyState>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>Decline reasons, in the order of the decline menu</caption>
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col">Email paragraph</th>
                <th scope="col">State</th>
                <RoleGate action="automation.reasons_put">
                  <th scope="col">Change</th>
                </RoleGate>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id}>
                  <td>
                    <span className="admin-recipes__name">{item.label}</span>
                    <br />
                    <code>{item.code}</code>
                  </td>
                  <td className="admin-reasons__paragraph">
                    {item.email_paragraph === "" ? (
                      <span className="admin-field__hint">The editor's note is the message.</span>
                    ) : (
                      item.email_paragraph
                    )}
                  </td>
                  <td>
                    <StatusPill
                      label={item.enabled ? "On" : "Off"}
                      tone={item.enabled ? "ok" : "neutral"}
                    />
                  </td>
                  <RoleGate action="automation.reasons_put">
                    <td>
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="admin-button admin-button--quiet"
                          aria-label={`Move ${item.label} up`}
                          disabled={index === 0 || reorder.isPending}
                          onClick={() => {
                            reorder.mutate(moved(items, index, -1));
                          }}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button--quiet"
                          aria-label={`Move ${item.label} down`}
                          disabled={index === items.length - 1 || reorder.isPending}
                          onClick={() => {
                            reorder.mutate(moved(items, index, 1));
                          }}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button--quiet"
                          aria-label={`Edit ${item.label}`}
                          onClick={() => {
                            setOpen(item.id);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </RoleGate>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reorder.isError ? (
        <RequestFailure error={reorder.error} className="admin-field__error" />
      ) : null}
      <RoleGate action="automation.reasons_put">
        <section className="admin-reasons__form" aria-label="Reason form">
          {open === "new" || editing !== null ? (
            <ReasonForm
              key={editing?.id ?? "new"}
              reason={editing}
              onDone={() => {
                setOpen(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                setOpen("new");
              }}
            >
              Add a reason
            </button>
          )}
        </section>
      </RoleGate>
    </>
  );
}
