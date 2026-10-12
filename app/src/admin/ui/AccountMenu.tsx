import { useEffect, useRef, useState } from "react";
import { roleLabels } from "../../domain/contracts";
import { useSignOut } from "../team/team-queries";
import { PasswordDialog } from "../team/PasswordDialog";
import { ActorBadge } from "./ActorBadge";
import { useAdminMe } from "./admin-me";

/**
 * Who is signed in, as one button at the end of the bar (W3): it opens a short list with the roles, Change password
 * and Sign out, and closes on Escape or a click elsewhere. An agent key sees its badge and no menu.
 */
export function AccountMenu() {
  const me = useAdminMe();
  const roles = me.roles.map((role) => roleLabels[role]).join(", ");
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leave = useSignOut();
  const root = useRef<HTMLDivElement>(null);
  // `?password=1` keeps the dialog open across the email-link sign-in that setting a password may ask for: the
  // sign-in returns to this address, and the dialog opens again by itself.
  const [passwordOpen, setPasswordOpenState] = useState(
    () =>
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("password"),
  );
  const setPasswordOpen = (value: boolean) => {
    setPasswordOpenState(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("password", "1");
    else url.searchParams.delete("password");
    window.history.replaceState(window.history.state, "", url);
  };

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (
        root.current !== null &&
        event.target instanceof Node &&
        !root.current.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (me.kind !== "human") return <ActorBadge name={roles} kind={me.kind} />;

  return (
    <div className="admin-account" ref={root}>
      <button
        type="button"
        className="admin-account__button"
        aria-expanded={open}
        aria-controls="admin-account-menu"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Account
      </button>
      {open ? (
        <div id="admin-account-menu" className="admin-account__menu">
          <p className="admin-account__who">
            <span className="admin-eyebrow">Signed in as</span>
            {roles}
          </p>
          {me.actions.includes("dashboard.password") ? (
            <button
              type="button"
              className="admin-account__item"
              onClick={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
            >
              Change password
            </button>
          ) : null}
          <button
            type="button"
            className="admin-account__item"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              // A failed sign-out still leaves for the sign-in page; the run never throws.
              void leave.run(undefined).finally(() => {
                window.location.assign("/admin/sign-in");
              });
            }}
          >
            {leaving ? "Signing out" : "Sign out"}
          </button>
        </div>
      ) : null}
      <PasswordDialog
        open={passwordOpen}
        onClose={() => {
          setPasswordOpen(false);
        }}
      />
    </div>
  );
}
