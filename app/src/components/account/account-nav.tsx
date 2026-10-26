import { Link } from "@tanstack/react-router";
import { accountPages } from "../../domain/account";

/**
 * The pages of the client room (W6 item 8), in the order the plan lists them. The router marks the page the visitor is
 * on `aria-current="page"`. The sign-out button is offered where the page has none of its own.
 */
export function AccountNav({
  onSignOut,
  signingOut = false,
}: {
  onSignOut?: () => void;
  signingOut?: boolean;
}) {
  return (
    <nav className="account-nav" aria-label="Your account">
      <ul>
        {accountPages.map((page) => (
          <li key={page.path}>
            <Link to={page.path}>{page.label}</Link>
          </li>
        ))}
      </ul>
      {onSignOut === undefined ? null : (
        <button type="button" className="account-nav-out" onClick={onSignOut} disabled={signingOut}>
          Sign out
        </button>
      )}
    </nav>
  );
}
