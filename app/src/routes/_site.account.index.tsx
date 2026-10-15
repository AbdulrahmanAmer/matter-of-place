import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AccountNotFound } from "../components/account/account-not-found";
import { AccountRoom } from "../components/account/account-room";
import { AccountSignIn } from "../components/account/account-sign-in";
import { PageIntro } from "../components/site/page-intro";
import type { AccountView } from "../domain/account";
import { readAccountFn, signOutAccountFn } from "../lib/account.functions";
import { pageHead } from "../lib/seo";

const TITLES: Record<AccountView["state"], string> = {
  "signed-out": "Sign in to your account",
  unknown: "Your account",
  room: "Your account",
};

// W6 item 7, ruling H114 (4): a person's room is rendered only in their browser and never kept by the edge.
export const Route = createFileRoute("/_site/account/")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
  validateSearch: (search: Record<string, unknown>): { state?: "expired" } =>
    search["state"] === "expired" ? { state: "expired" } : {},
  head: () =>
    pageHead({
      title: "Your account",
      description: "Sign in to see the requests you have made to Matter of Place.",
      path: "/account",
      noindex: true,
    }),
  loader: ({ context: { queryClient } }) =>
    queryClient.query({ queryKey: ["account"], queryFn: () => readAccountFn(), staleTime: 0 }),
  component: AccountPage,
});

function AccountPage() {
  const view = Route.useLoaderData();
  const { state } = Route.useSearch();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = () => {
    setSigningOut(true);
    void signOutAccountFn().finally(() => {
      setSigningOut(false);
      void router.invalidate();
    });
  };
  return (
    <main>
      <PageIntro
        eyebrow="Account"
        title={TITLES[view.state]}
        {...(view.state === "signed-out"
          ? { text: "We send a sign-in link to the address you wrote to us from." }
          : {})}
      />
      {view.state === "signed-out" ? (
        <div className="copy-page">
          <AccountSignIn expired={state === "expired"} />
        </div>
      ) : view.state === "unknown" ? (
        <AccountNotFound onSignOut={signOut} signingOut={signingOut} />
      ) : (
        <AccountRoom
          name={view.name}
          requests={view.requests}
          onSignOut={signOut}
          signingOut={signingOut}
        />
      )}
    </main>
  );
}
