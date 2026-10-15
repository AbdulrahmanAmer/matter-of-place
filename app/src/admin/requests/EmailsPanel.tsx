import { useState } from "react";
import {
  deliveryLine,
  resendableStates,
  type SentEmail,
  type SubmissionEmails,
} from "../../domain/admin-emails";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";

const SUPPRESSED: Record<NonNullable<SubmissionEmails["suppression"]>["reason"], string> = {
  bounce: "it bounced",
  complaint: "the person marked our email as spam",
  manual: "a person put it there",
  refused: "its mail server refused it",
};

/**
 * W9 item 2: each email sent about the request and what became of it, read plainly ("The confirmation bounced: this
 * mailbox does not exist."), and for one that bounced or was not sent a field to correct the address and send it again.
 */
export function EmailsPanel({
  emails,
  marketSlug,
  canResend,
  pending,
  error,
  onResend,
}: {
  emails: SubmissionEmails | undefined;
  marketSlug: string;
  canResend: boolean;
  pending: boolean;
  error: string | null;
  /** Resolves true when the email was queued again. */
  onResend: (messageId: string, email: string) => Promise<boolean>;
}) {
  return (
    <section className="admin-emails" aria-label="Emails">
      <h2>Emails</h2>
      {emails === undefined ? (
        <p className="admin-emails__none">Loading the emails.</p>
      ) : (
        <>
          {emails.suppression === null ? null : (
            <p className="admin-emails__warning" role="status">
              Nothing more is sent to {emails.address}: {SUPPRESSED[emails.suppression.reason]} on{" "}
              <LocalTime value={emails.suppression.at} marketSlug={marketSlug} style="date" />.
            </p>
          )}
          {emails.items.length === 0 ? (
            <p className="admin-emails__none">No email has been sent about this request.</p>
          ) : (
            <ul>
              {emails.items.map((email) => (
                <EmailItem
                  key={email.id}
                  email={email}
                  address={emails.address}
                  marketSlug={marketSlug}
                  canResend={canResend && resendableStates.includes(email.status)}
                  pending={pending}
                  error={error}
                  onResend={onResend}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function EmailItem({
  email,
  address,
  marketSlug,
  canResend,
  pending,
  error,
  onResend,
}: {
  email: SentEmail;
  address: string;
  marketSlug: string;
  canResend: boolean;
  pending: boolean;
  error: string | null;
  onResend: (messageId: string, email: string) => Promise<boolean>;
}) {
  const [corrected, setCorrected] = useState(address);
  const [sent, setSent] = useState(false);
  const failed = resendableStates.includes(email.status);
  return (
    <li className={failed ? "admin-emails__item admin-emails__item--failed" : "admin-emails__item"}>
      <p>{deliveryLine(email)}</p>
      <p className="admin-emails__meta">
        To {email.to_email ?? "no address"},{" "}
        <LocalTime value={email.sent_at ?? email.created_at} marketSlug={marketSlug} />
      </p>
      {!canResend ? null : sent ? (
        <p className="admin-emails__meta" role="status">
          Queued again to {corrected}.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onResend(email.id, corrected.trim()).then((queued) => {
              if (queued) setSent(true);
            });
          }}
        >
          <Field
            label="Correct the address and send it again"
            {...(error === null ? {} : { error })}
          >
            {(control) => (
              <input
                {...control}
                type="email"
                autoComplete="off"
                value={corrected}
                onChange={(event) => {
                  setCorrected(event.target.value);
                }}
              />
            )}
          </Field>
          <button
            type="submit"
            className="admin-button admin-button--quiet"
            disabled={pending || corrected.trim() === ""}
          >
            Send again
          </button>
        </form>
      )}
    </li>
  );
}
