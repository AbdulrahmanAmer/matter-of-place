import { useState } from "react";
import { FormError } from "../../components/forms/form-notice";
import { AdminApiError } from "../ui/admin-fetch";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { useSetOwnPassword } from "./team-queries";

/**
 * Sets the signed-in person's own password (operator, 2026-10-12). Only that person ever types it; it goes straight
 * to Supabase Auth and is never stored or shown by Matter of Place. The server asks for a sign-in in the last
 * 15 minutes first, so a session left open on another desk cannot change it.
 */
export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const set = useSetOwnPassword((error) => {
    setRefusal(error instanceof AdminApiError ? error.message : null);
  });
  const mismatch = again !== "" && again !== password;
  const close = () => {
    setPassword("");
    setAgain("");
    setRefusal(null);
    set.reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} label="Your password">
      {set.state.status === "success" ? (
        <div className="admin-dialog__body">
          <h2>Password set</h2>
          <p role="status">Next time, sign in with your email and this password.</p>
          <button type="button" className="admin-button" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="admin-dialog__body"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (mismatch || password.length < 12) return;
            setRefusal(null);
            void set.run(password);
          }}
        >
          <h2>Your password</h2>
          <p>Only you know it; nobody at Matter of Place can read it.</p>
          <p>
            For your safety this needs a sign-in in the last 15 minutes. If it sends you to sign in,
            use the email link; you come back here and can set it straight away.
          </p>
          <Field label="New password" hint="Twelve characters or more.">
            {(control) => (
              <input
                {...control}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="The same again" {...(mismatch ? { error: "The two do not match." } : {})}>
            {(control) => (
              <input
                {...control}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(event) => {
                  setAgain(event.target.value);
                }}
              />
            )}
          </Field>
          <FormError
            message={set.state.status === "error" ? (refusal ?? set.state.message) : null}
          />
          <div className="admin-actions">
            <button type="button" className="admin-button admin-button--quiet" onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className="admin-button"
              disabled={set.pending || mismatch || password.length < 12}
            >
              Set password
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
