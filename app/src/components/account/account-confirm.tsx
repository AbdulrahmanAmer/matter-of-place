import { useLayoutEffect, useState } from "react";
import type { AccountConfirmStatus } from "../../domain/account";
import { useAsyncAction } from "../../hooks/use-async-action";
import { confirmAccountLinkFn } from "../../lib/account.functions";
import { FormError } from "../forms/form-notice";

/**
 * The token the email link carried, in its fragment (`#token_hash=`), taken out of the address at once: no script,
 * report or copied address of this page ever holds it. Null when the address has none. A token in the query is not
 * read: every client link is built with the fragment, and a query reaches the Worker and the edge logs.
 */
function takeLinkToken(location: Location, history: History): string | null {
  const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token_hash");
  if (token === null) return null;
  history.replaceState(history.state, "", location.pathname);
  return token;
}

/**
 * The confirm page (W6 item 7, ruling H119 (4)): the button spends the token, so a mail scanner that opens the link
 * first cannot use it up. A person on the team is sent to the admin sign-in instead.
 */
export function AccountConfirm({ onDone }: { onDone: (status: AccountConfirmStatus) => void }) {
  const [token, setToken] = useState("");
  // Before any effect of the layout runs, so the address is clean before anything else reads it.
  useLayoutEffect(() => {
    const taken = takeLinkToken(window.location, window.history);
    if (taken !== null) setToken(taken);
  }, []);
  const { state, run, pending } = useAsyncAction((tokenHash: string) =>
    confirmAccountLinkFn({ data: { token_hash: tokenHash } }),
  );
  if (state.status === "success" && state.result.status === "staff") {
    return (
      <div className="copy-page">
        <p>This address signs in to the admin. Please use the admin sign-in.</p>
        <div className="form-actions">
          <a className="button" href="/admin/sign-in">
            Go to the admin sign-in
          </a>
        </div>
      </div>
    );
  }
  const confirm = () => {
    void run(token).then((result) => {
      if (result !== undefined && result.status !== "staff") onDone(result.status);
    });
  };
  return (
    <div className="copy-page">
      <div className="form-actions">
        <button
          type="button"
          className="button"
          onClick={confirm}
          disabled={pending || token === ""}
        >
          {pending ? "Signing in" : "Sign in"}
        </button>
      </div>
      <FormError message={state.status === "error" ? state.message : null} />
    </div>
  );
}
