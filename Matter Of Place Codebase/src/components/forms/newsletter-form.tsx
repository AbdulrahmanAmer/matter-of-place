import type { FormEvent } from "react";
import { subscriberSchema } from "../../domain/contracts";
import { useAsyncAction } from "../../hooks/use-async-action";
import { track } from "../../lib/analytics";
import { t } from "../../lib/strings";
import { isLive, services } from "../../services";
import { FormError } from "./form-notice";

export function NewsletterForm({ source }: { source: string }) {
  const { state, run, pending } = useAsyncAction((input: { email: string }) =>
    services.newsletter.subscribe(subscriberSchema.parse({ ...input, source })),
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email")?.toString() ?? "";
    const receipt = await run({ email });
    if (receipt) track("newsletter_signup", { source });
  };

  if (state.status === "success") {
    return (
      <p className="newsletter-sent" role="status">
        {isLive ? t.newsletter.liveSent : t.newsletter.localSent}
      </p>
    );
  }

  return (
    <form className="newsletter-form" onSubmit={onSubmit} aria-busy={pending}>
      <input
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder={t.common.emailAddress}
        aria-label={t.common.emailAddress}
      />
      <button type="submit" disabled={pending}>
        {pending ? t.common.sending : t.common.subscribe}
      </button>
      <FormError message={state.status === "error" ? state.message : null} />
    </form>
  );
}
