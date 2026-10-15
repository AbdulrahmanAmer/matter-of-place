import { useState, type SyntheticEvent } from "react";
import { useAsyncAction } from "../../hooks/use-async-action";
import { sendAccountLinkFn } from "../../lib/account.functions";
import { getTurnstileToken } from "../../lib/turnstile";
import { Field } from "../forms/field";
import { FormError, SentNotice } from "../forms/form-notice";

/**
 * The client room's sign-in (W6 item 7): an address, then a link by email. The answer is the same for every address,
 * so the form never says who is a client.
 */
export function AccountSignIn({ expired }: { expired: boolean }) {
  const [email, setEmail] = useState("");
  const { state, run, pending } = useAsyncAction(async (address: string) => {
    const turnstile = await getTurnstileToken("account-send-link");
    return sendAccountLinkFn({ data: { email: address, turnstile } });
  });
  if (state.status === "success") {
    return (
      <SentNotice
        title="Check your email"
        text="If we hold a request from this address, a sign-in link is on its way. It works once and for one hour."
      />
    );
  }
  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(email);
  };
  return (
    <form onSubmit={onSubmit} aria-busy={pending} noValidate>
      {expired ? (
        <p className="form-note">
          That link has expired or was already used. Ask for a new one below.
        </p>
      ) : null}
      <Field label="Email">
        <input
          required
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Field>
      <FormError message={state.status === "error" ? state.message : null} />
      <div className="form-actions">
        <button type="submit" className="button" disabled={pending || email === ""}>
          {pending ? "Sending" : "Send me a link"}
        </button>
      </div>
    </form>
  );
}
