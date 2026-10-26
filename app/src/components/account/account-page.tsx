import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { AccountPage } from "../../domain/account";
import { useAccountSignOut } from "../../hooks/use-account-sign-out";
import { AccountNav } from "./account-nav";
import { AccountNotFound } from "./account-not-found";

/**
 * One page of the client room (W6 item 8): the sign-in form is the front page's, so a visitor without a session goes
 * there; an address that holds no request gets the calm "not found" page; the rest is the page's own, under the nav and
 * the line that says whose room this is (a person signed in by someone else's link sees it, ruling H119 (4)).
 */
export function AccountPageView<T extends { name: string; email: string }>({
  view,
  children,
}: {
  view: AccountPage<T>;
  children: (data: T) => ReactNode;
}) {
  const { signOut, signingOut } = useAccountSignOut();
  if (view.state === "signed-out") return <Navigate to="/account" replace />;
  if (view.state === "unknown") {
    return <AccountNotFound onSignOut={signOut} signingOut={signingOut} />;
  }
  return (
    <>
      <AccountNav onSignOut={signOut} signingOut={signingOut} />
      <div className="copy-page">
        <p>
          Signed in as {view.name}, {view.email}.
        </p>
        {children(view)}
      </div>
    </>
  );
}
