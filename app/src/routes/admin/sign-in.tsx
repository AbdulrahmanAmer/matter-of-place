import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { requestSignInLink } from "../../admin/team/team-api";
import { FormError } from "../../components/forms/form-notice";
import { useAsyncAction } from "../../hooks/use-async-action";
import { pageHead } from "../../lib/seo";

interface SignInSearch {
  next?: string;
  state?: "disabled" | "expired";
}

const STATES = {
  disabled: "This account is not active. Ask an administrator if that is unexpected.",
  expired: "That link has expired or was already used. Ask for a new one below.",
} as const;

export const Route = createFileRoute("/admin/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => {
    const { next, state } = search;
    return {
      ...(typeof next === "string" && next !== "" ? { next } : {}),
      ...(state === "disabled" || state === "expired" ? { state } : {}),
    };
  },
  head: () =>
    pageHead({
      title: "Sign in",
      description: "Sign in to the Matter of Place admin.",
      path: "/admin/sign-in",
      noindex: true,
    }),
  component: SignInPage,
});

function SignInPage() {
  const { state } = Route.useSearch();
  const [email, setEmail] = useState("");
  const send = useAsyncAction(requestSignInLink);

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
