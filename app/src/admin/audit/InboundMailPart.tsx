import { useState } from "react";
import { inboundSources, inboundStates, type InboundMail } from "../../domain/admin-inbound-mail";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { useInboundMail } from "./sent-emails-queries";

// W8 0h (operator, 2026-10-16: "the company and Matter should be able to see all emails"): every message that reached
// our addresses and is not a reply to our own email, as the laptop runner recorded it. Its words come from outside the
// company: plain text for a person to read, and nowhere else.

const SOURCE: Readonly<Record<InboundMail["source"], string>> = {
  email_inbound: "A person",
  service_notice: "A service",
  our_mail: "Our own mail",
};

const STATE: Readonly<Record<InboundMail["state"], string>> = {
  new: "With its owner",
  routed: "Its owner may answer",
  held: "Held for Matter",
  escalated: "Sent to Matter",
  recorded: "Recorded",
  ignored: "Ignored",
  spam: "Spam",
  capped: "Waiting for a person",
};

const OWNERS: Readonly<Record<string, string>> = {
  editor: "The Editor",
  concierge: "The Concierge",
  chief: "The chief of staff",
  matter: "Matter",
};

/** "Dana Reyes <dana@example.com>", or whichever of the two the mail carried. */
function sender(mail: InboundMail): string {
  const { from_name: name, from_email: address } = mail;
  if (address === null) return name ?? "No address";
  return name === null ? address : `${name} <${address}>`;
}

/** What became of it: the triage's labels for a person's message, else the runner's own words. */
function result(mail: InboundMail): string {
  if (mail.triage === null) return mail.summary;
  const tried = mail.triage.instructions_to_ai ? ", tried to direct the AI" : "";
  return `Triage: ${mail.triage.intent.replaceAll("_", " ")}${tried}.`;
}

export function InboundMailPart() {
  const [filters, setFilters] = useState<{
    source: string | undefined;
    state: string | undefined;
  }>({ source: undefined, state: undefined });
  // The cursors of the pages before this one; the last is the page shown.
  const [trail, setTrail] = useState<(string | null)[]>([null]);
  const cursor = trail.at(-1) ?? null;
  const mail = useInboundMail(filters, cursor);
  const items = mail.data?.items;
  const nextCursor = mail.data?.next_cursor ?? null;

  const choose = (name: "source" | "state", value: string) => {
    setTrail([null]);
    setFilters((now) => ({ ...now, [name]: value === "" ? undefined : value }));
  };

  return (
    <section aria-labelledby="inbound-heading">
      <h2 id="inbound-heading">Inbound mail</h2>
      <p className="admin-lead">
        Every other message that reached our addresses, newest first: from people, from the services
        we use, and spam. A person&apos;s message goes to its owner only as a triage; a
        service&apos;s goes to Matter.
      </p>
      <div className="admin-toolbar">
        <Field label="Source">
          {(control) => (
            <select
              {...control}
              value={filters.source ?? ""}
              onChange={(event) => {
                choose("source", event.target.value);
              }}
            >
              <option value="">All</option>
              {inboundSources.map((value) => (
                <option key={value} value={value}>
                  {SOURCE[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Inbound state">
          {(control) => (
            <select
              {...control}
              value={filters.state ?? ""}
              onChange={(event) => {
                choose("state", event.target.value);
              }}
            >
              <option value="">All</option>
              {inboundStates.map((value) => (
                <option key={value} value={value}>
                  {STATE[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {mail.error !== null ? (
        <p role="alert">{mail.error.message}</p>
      ) : items === undefined ? (
        <div className="admin-skeleton" />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>Inbound mail ({items.length})</caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">From</th>
                <th scope="col">Message</th>
                <th scope="col">Source</th>
                <th scope="col">What became of it</th>
                <th scope="col">Owner</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <LocalTime value={row.received_at} />
                  </td>
                  <td>
                    {sender(row)}
                    {row.alias === null ? "" : ` to ${row.alias}@`}
                  </td>
                  <td>
                    <details>
                      <summary>{row.subject === "" ? "(no subject)" : row.subject}</summary>
                      <p className="admin-preview__text">{row.body}</p>
                      {row.attachments.length === 0 ? null : (
                        <p>Attachments: {row.attachments.join(", ")}</p>
                      )}
                      <p>Folder: {row.folder}</p>
                    </details>
                  </td>
                  <td>
                    {SOURCE[row.source]}
                    {row.service === null ? "" : ` (${row.service})`}
                  </td>
                  <td>{result(row)}</td>
                  <td>
                    {row.owner_slug === null
                      ? "No one"
                      : (OWNERS[row.owner_slug] ?? row.owner_slug)}
                  </td>
                  <td>
                    <span
                      className="admin-pill"
                      data-tone={
                        row.state === "held" || row.state === "capped" ? "warning" : undefined
                      }
                    >
                      {STATE[row.state]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    </section>
  );
}
