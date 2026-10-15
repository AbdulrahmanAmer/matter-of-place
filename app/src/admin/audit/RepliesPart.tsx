import { emailName, replyStates, type Reply } from "../../domain/admin-emails";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useMarkReply, useReplies } from "./sent-emails-queries";

// W7 item 2: the replies W4 reads from the mailbox, each beside the email it answers. A reply's words come from
// someone outside the company: they are shown as plain text for a person to read, and go nowhere else.

const OWNERS: Readonly<Record<string, string>> = {
  editor: "The Editor",
  concierge: "The Concierge",
  chief: "The chief of staff",
};

type Mark = "seen" | "answered" | "ignored";

/** "Dana Reyes <dana@example.com>", or whichever of the two the mail carried. */
function sender(reply: Reply): string {
  const { from_name: name, from_email: address } = reply;
  if (address === null) return name ?? "No address";
  return name === null ? address : `${name} <${address}>`;
}

export function RepliesPart({
  state,
  onState,
}: {
  state: string | undefined;
  onState: (next: string) => void;
}) {
  const replies = useReplies(state);
  const mark = useMarkReply();
  const toast = useToast();
  const canMark = useAdminMe().actions.includes("audit.reply_mark");
  const items = replies.data?.items;

  const send = (reply: Reply, next: Mark) => {
    mark.mutate(
      { id: reply.id, state: next },
      {
        onError: (error) => {
          toast({ message: error.message, tone: "danger" });
        },
      },
    );
  };

  return (
    <section aria-labelledby="replies-heading">
      <h2 id="replies-heading">Replies</h2>
      <p className="admin-lead">
        What people wrote back to our emails, newest first, beside the email each one answers.
      </p>
      <div className="admin-toolbar">
        <Field label="Reply state">
          {(control) => (
            <select
              {...control}
              value={state ?? ""}
              onChange={(event) => {
                onState(event.target.value);
              }}
            >
              <option value="">All</option>
              {replyStates.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {replies.error !== null ? (
        <p role="alert">{replies.error.message}</p>
      ) : items === undefined ? (
        <div className="admin-skeleton" />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>Replies ({items.length})</caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">From</th>
                <th scope="col">Reply</th>
                <th scope="col">The email it answers</th>
                <th scope="col">Owner</th>
                <th scope="col">State</th>
                {canMark ? <th scope="col">Mark</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((reply) => (
                <tr key={reply.id}>
                  <td>
                    <LocalTime value={reply.received_at} />
                  </td>
                  <td>{sender(reply)}</td>
                  <td>
                    <details
                      onToggle={(event) => {
                        if (event.currentTarget.open && canMark && reply.state === "new") {
                          send(reply, "seen");
                        }
                      }}
                    >
                      <summary>{reply.subject === "" ? "(no subject)" : reply.subject}</summary>
                      <p className="admin-preview__text">{reply.body}</p>
                    </details>
                  </td>
                  <td>
                    {reply.sent === null ? (
                      "The email is no longer on file."
                    ) : (
                      <>
                        {emailName(reply.sent.template_key)} to{" "}
                        {reply.sent.to_email ?? "no address"},{" "}
                        <LocalTime value={reply.sent.sent_at ?? reply.sent.created_at} />
                      </>
                    )}
                  </td>
                  <td>
                    {reply.owner_slug === null
                      ? "No one"
                      : (OWNERS[reply.owner_slug] ?? reply.owner_slug)}
                  </td>
                  <td>
                    <span
                      className="admin-pill"
                      data-tone={reply.state === "new" ? "warning" : undefined}
                    >
                      {reply.state}
                    </span>
                  </td>
                  {canMark ? (
                    <td>
                      <div className="admin-actions">
                        <button
                          type="button"
                          className="admin-button"
                          disabled={mark.isPending || reply.state === "answered"}
                          onClick={() => {
                            send(reply, "answered");
                          }}
                        >
                          Mark answered
                        </button>
                        <button
                          type="button"
                          className="admin-button admin-button--quiet"
                          disabled={mark.isPending || reply.state === "ignored"}
                          onClick={() => {
                            send(reply, "ignored");
                          }}
                        >
                          Ignore
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
