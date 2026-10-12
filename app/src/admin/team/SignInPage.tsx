import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { FormError } from "../../components/forms/form-notice";
import { AdminApiError } from "../ui/admin-fetch";
import { usePasswordSignIn, useSendSignInLink } from "./team-queries";

const signIn = getRouteApi("/admin/sign-in");

const STATES = {
  disabled: "This account is not active. Ask an administrator if that is unexpected.",
  expired: "That link has expired or was already used. Ask for a new one below.",
  // Team changes and other sensitive actions ask for a sign-in in the last 15 minutes (session-policy.ts).
  recent:
    "This page changes who can sign in, so it asks you to confirm it is you. Sign in again below and you return to it.",
} as const;

/**
 * The component of `src/routes/admin/sign-in.tsx`: the address and the password its owner chose (operator,
 * 2026-10-12), or, for someone without a password yet, a link by email. A password is never chosen for anyone: each
 * person sets their own from the top bar once signed in.
 */
export function SignInPage() {
  const { state, next } = signIn.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = useSendSignInLink();
  const signInWithPassword = usePasswordSignIn((error) => {
    setRefusal(error instanceof AdminApiError ? error.message : null);
  });

  if (send.state.status === "success") {
    return (
      <main className="admin-auth">
        <div className="admin-signin">
          <h1>Check your inbox</h1>
          <p role="status">
            If this address belongs to the team, a sign-in link is on its way. It works once.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-auth">
      <form
        className="admin-signin"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setRefusal(null);
          void signInWithPassword.run({ email, password, next }).then((to) => {
            if (to !== undefined) window.location.assign(to);
          });
        }}
      >
        <h1>Sign in</h1>
        {state === undefined ? null : <p role="status">{STATES[state]}</p>}
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <button type="submit" disabled={signInWithPassword.pending || password === ""}>
          Sign in
        </button>
        <FormError
          message={
            signInWithPassword.state.status === "error"
              ? (refusal ?? signInWithPassword.state.message)
              : null
          }
        />
        <p className="admin-signin__or">No password yet, or forgotten it?</p>
        <button
          type="button"
          className="admin-signin__link"
          disabled={send.pending}
          onClick={() => {
            void send.run(email);
          }}
        >
          Send a sign-in link
        </button>
        <FormError message={send.state.status === "error" ? send.state.message : null} />
      </form>
    </main>
  );
}
