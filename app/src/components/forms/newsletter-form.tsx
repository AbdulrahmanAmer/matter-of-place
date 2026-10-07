import type { SyntheticEvent } from "react";
import { honeypotFieldName, subscriberSchema } from "../../domain/contracts";
import { useAsyncAction } from "../../hooks/use-async-action";
import { useFieldErrors } from "../../hooks/use-field-errors";
import { track } from "../../lib/analytics";
import { formText, withHoneypot } from "../../lib/form-data";
import { t } from "../../lib/strings";
import { isLive, services } from "../../services";
import { FormError } from "./form-notice";
import { Honeypot } from "./honeypot";

export function NewsletterForm({ source }: { source: string }) {
  const { state, run, pending } = useAsyncAction((input: { email: string; trap: string }) =>
    services.newsletter.subscribe(
      withHoneypot(subscriberSchema.parse({ email: input.email, source }), input.trap),
    ),
  );

  const { validate, clear, field, control } = useFieldErrors();

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate(event.currentTarget)) return;
    const data = new FormData(event.currentTarget);
    const email = formText(data, "email");
    void run({ email, trap: formText(data, honeypotFieldName) }).then((receipt) => {
      if (receipt) track("newsletter_signup", { source });
    });
  };

  if (state.status === "success") {
    return (
      <p className="newsletter-sent" role="status">
        {isLive ? t.newsletter.liveSent : t.newsletter.localSent}
      </p>
    );
  }

  return (
    <form
      className="newsletter-form"
      onSubmit={onSubmit}
      onInput={clear}
      aria-busy={pending}
      noValidate
    >
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder={t.common.emailAddress}
        aria-label={t.common.emailAddress}
        {...control("email")}
      />
      <Honeypot />
      <button type="submit" disabled={pending}>
        {pending ? t.common.sending : t.common.subscribe}
      </button>
      <FormError
        id={field("email").errorId}
        message={field("email").error ?? (state.status === "error" ? state.message : null)}
      />
    </form>
  );
}
