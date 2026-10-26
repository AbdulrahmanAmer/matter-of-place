import { useState } from "react";
import { deliveryLine, emailStates } from "../../domain/admin-emails";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { useSentEmails } from "./sent-emails-queries";

// W9 item 2 and W7 item 1: every email we sent, to whom, its template and what became of it, and the addresses nothing
// more goes to. The state and the address live in the page's address; the page of emails is this part's own, and the
// page remounts it (a `key`) when a filter changes, so a new filter always starts on the first page.

const ENTITY_PATH: Readonly<Record<string, string>> = { submission: "/admin/requests/" };

const REASON = {
  bounce: "Bounced",
  complaint: "Marked as spam",
  manual: "Put there by a person",
  refused: "Refused by its mail server",
};

export function SentEmailsPart({
  status,
  address,
  onFilters,
}: {
  status: string | undefined;
  address: string | undefined;
  onFilters: (next: { status?: string; search?: string }) => void;
}) {
  // The cursors of the pages before this one; the last is the page shown.
  const [trail, setTrail] = useState<(string | null)[]>([null]);
  const cursor = trail.at(-1) ?? null;
  const emails = useSentEmails({
    ...(status === undefined ? {} : { status }),
    ...(address === undefined ? {} : { search: address }),
    ...(cursor === null ? {} : { cursor }),
  });
  const [search, setSearch] = useState(address ?? "");
  const view = emails.data;
  const nextCursor = view?.next_cursor ?? null;
  return (
    <section aria-labelledby="sent-heading">
      <h2 id="sent-heading">Emails we sent</h2>
      <form
        className="admin-toolbar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onFilters({ ...(status === undefined ? {} : { status }), search: search.trim() });
        }}
      >
        <Field label="State">
          {(control) => (
            <select
              {...control}
              value={status ?? ""}
              onChange={(event) => {
                onFilters({
                  status: event.target.value,
                  ...(address === undefined ? {} : { search: address }),
                });
              }}
            >
              <option value="">All</option>
              {emailStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Address" hint="The whole address, then Enter">
          {(control) => (
            <input
              {...control}
              type="search"
              value={search}
              maxLength={254}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          )}
        </Field>
      </form>
      {emails.error !== null ? (
        <p role="alert">{emails.error.message}</p>
      ) : view === undefined ? (
        <div className="admin-skeleton" />
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption>Emails we sent ({view.items.length})</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">To</th>
                  <th scope="col">Template</th>
                  <th scope="col">What became of it</th>
                  <th scope="col">About</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((email) => {
                  const path = email.entity === null ? undefined : ENTITY_PATH[email.entity];
                  return (
                    <tr key={email.id}>
                      <td>
                        <LocalTime value={email.sent_at ?? email.created_at} />
                      </td>
                      <td>
                        {email.to_email ?? "No address"}
                        {email.suppressed ? " (do not send)" : ""}
                      </td>
                      <td>{email.template_key}</td>
                      <td>{deliveryLine(email)}</td>
                      <td>
                        {path === undefined || email.entity_id === null ? (
                          (email.entity ?? "")
                        ) : (
                          <a href={`${path}${email.entity_id}`}>Open the {email.entity}</a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {trail.length > 1 || nextCursor !== null ? (
            <div className="admin-pager" data-print="hide">
              <button
                type="button"
                className="admin-button admin-button--quiet"
                disabled={trail.length <= 1}
                onClick={() => {
                  setTrail((now) => now.slice(0, -1));
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="admin-button admin-button--quiet"
                disabled={nextCursor === null}
                onClick={() => {
                  if (nextCursor !== null) setTrail((now) => [...now, nextCursor]);
                }}
              >
                Next
              </button>
            </div>
          ) : null}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption>Do-not-send list ({view.suppressions.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">Why</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {view.suppressions.map((row) => (
                  <tr key={row.email}>
                    <td>{row.email}</td>
                    <td>{REASON[row.reason]}</td>
                    <td>
                      <LocalTime value={row.at} style="date" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
