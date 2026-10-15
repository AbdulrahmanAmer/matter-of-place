import { useState } from "react";
import { deliveryLine, emailStates } from "../../domain/admin-emails";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { useUrlFilters } from "../ui/use-url-filters";
import { RepliesPart } from "./RepliesPart";
import { useSentEmails } from "./sent-emails-queries";

// W9 item 2 and W7 item 1 (operator, 2026-10-15: "we need to be able to see from the admin dashboard if an email is
// wrong or bounced"): every email we sent, to whom and what became of it, and the addresses nothing more goes to.
// W7 item 2: the replies people wrote back, beside the emails they answer.

const filterNames = ["status", "search", "reply"] as const;

const ENTITY_PATH: Readonly<Record<string, string>> = { submission: "/admin/requests/" };

const REASON = {
  bounce: "Bounced",
  complaint: "Marked as spam",
  manual: "Put there by a person",
  refused: "Refused by its mail server",
};

export function SentEmailsPage() {
  const filters = useUrlFilters(filterNames);
  // The reply filter belongs to the Replies part: it is not part of what the emails are asked for.
  const { status, search: address } = filters.values;
  const emails = useSentEmails({
    ...(status === undefined ? {} : { status }),
    ...(address === undefined ? {} : { search: address }),
  });
  const [search, setSearch] = useState(filters.values.search ?? "");
  const view = emails.data;
  return (
    <>
      <h1>Sent emails</h1>
      <p className="admin-lead">
        Replies people wrote back come first; every email we sent follows, newest first, with what
        became of it. An address that bounced or complained is on the do-not-send list below.
      </p>
      <RepliesPart
        state={filters.values.reply}
        onState={(next) => {
          filters.setFilters({ ...filters.values, reply: next });
        }}
        cursor={filters.cursor}
        pager={{
          hasPrevious: filters.hasPrevious,
          onPrevious: filters.goPrevious,
          onNext: filters.goNext,
        }}
      />
      <h2>Emails we sent</h2>
      <form
        className="admin-toolbar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          filters.setFilters({ ...filters.values, search: search.trim() });
        }}
      >
        <Field label="State">
          {(control) => (
            <select
              {...control}
              value={filters.values.status ?? ""}
              onChange={(event) => {
                filters.setFilters({ ...filters.values, status: event.target.value });
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
              <caption>The newest {view.items.length} emails</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">To</th>
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
    </>
  );
}
