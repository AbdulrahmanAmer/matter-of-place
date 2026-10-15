import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { FormError } from "../components/forms/form-notice";
import { useAsyncAction } from "../hooks/use-async-action";
import { confirmAccountLinkFn } from "../lib/account.functions";
import { pageHead } from "../lib/seo";

// W6 item 7, ruling H113 (4): the email link opens this page and the button spends the token, so a mail scanner that
// opens the link first cannot use it up. The token is in the address, so the page is never rendered on the server nor
// kept by the edge.
export const Route = createFileRoute("/_site/account/confirm")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
  validateSearch: (search: Record<string, unknown>): { token_hash: string } => ({
    token_hash: typeof search["token_hash"] === "string" ? search["token_hash"] : "",
  }),
  head: () =>
    pageHead({
      title: "Sign in",
      description: "Finish signing in to your Matter of Place account.",
      path: "/account/confirm",
      noindex: true,
    }),
  component: AccountConfirmPage,
});

function AccountConfirmPage() {
  const { token_hash: tokenHash } = Route.useSearch();
  const navigate = useNavigate();
  const { state, run, pending } = useAsyncAction(() =>
    confirmAccountLinkFn({ data: { token_hash: tokenHash } }),
  );
  const confirm = () => {
    void run(undefined).then((result) => {
      if (result === undefined) return;
      void navigate({
        to: "/account",
        search: result.status === "expired" ? { state: "expired" } : {},
      });
    });
  };
  return (
    <main>
      <PageIntro eyebrow="Account" title="Sign in" text="One step, and you are in." />
      <div className="copy-page">
        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={confirm}
            disabled={pending || tokenHash === ""}
          >
            {pending ? "Signing in" : "Sign in"}
          </button>
        </div>
        <FormError message={state.status === "error" ? state.message : null} />
      </div>
    </main>
  );
}
