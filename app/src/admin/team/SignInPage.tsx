import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { FormError } from "../../components/forms/form-notice";
import { useSendSignInLink } from "./team-queries";

const signIn = getRouteApi("/admin/sign-in");

const STATES = {
  disabled: "This account is not active. Ask an administrator if that is unexpected.",
  expired: "That link has expired or was already used. Ask for a new one below.",
} as const;

/** The component of `src/routes/admin/sign-in.tsx`. */
export function SignInPage() {
  const { state } = signIn.useSearch();
  const [email, setEmail] = useState("");
  const send = useSendSignInLink();

  return (
    <main className="admin-auth">
      <form
        className="admin-signin"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send.run(email);
        }}
      >
        <h1>Sign in</h1>
        {state === undefined ? null : <p role="status">{STATES[state]}</p>}
        {send.state.status === "success" ? (
          <p role="status">
            If this address belongs to the team, a sign-in link is on its way. It works once.
          </p>
        ) : (
          <>
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
            <button type="submit" disabled={send.pending}>
              Send a sign-in link
            </button>
            <FormError message={send.state.status === "error" ? send.state.message : null} />
          </>
        )}
      </form>
    </main>
  );
}
