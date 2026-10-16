import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AccountConfirm } from "../components/account/account-confirm";
import { PageIntro } from "../components/site/page-intro";
import { pageHead } from "../lib/seo";

// W6 item 7, ruling H119 (4): the email link opens this page with the token in its fragment, and the page takes it out
// of the address before anything else runs. The page is never rendered on the server nor kept by the edge, and the
// layout loads no analytics on it (`Ga4Loader`).
export const Route = createFileRoute("/_site/account/confirm")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
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
  const navigate = useNavigate();
  return (
    <main>
      <PageIntro eyebrow="Account" title="Sign in" text="One step, and you are in." />
      <AccountConfirm
        onDone={(status) => {
          void navigate({
            to: "/account",
            search: status === "expired" ? { state: "expired" } : {},
          });
        }}
      />
    </main>
  );
}
