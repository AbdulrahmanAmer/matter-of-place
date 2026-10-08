import { getRouteApi } from "@tanstack/react-router";
import { ConfirmForm } from "./ConfirmForm";

const confirm = getRouteApi("/admin/auth/confirm");

/** The component of `src/routes/admin/auth.confirm.tsx`. */
export function ConfirmPage() {
  const search = confirm.useSearch();
  return (
    <main className="admin-auth">
      {search.token_hash === "" ? (
        <p>This sign-in link is incomplete. Please ask for a new one.</p>
      ) : (
        <ConfirmForm tokenHash={search.token_hash} type={search.type} next={search.next} />
      )}
    </main>
  );
}
