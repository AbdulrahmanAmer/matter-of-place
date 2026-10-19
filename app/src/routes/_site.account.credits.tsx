import { createFileRoute } from "@tanstack/react-router";
import { AccountCredits } from "../components/account/account-credits";
import { AccountPageView } from "../components/account/account-page";
import { PageIntro } from "../components/site/page-intro";
import { readAccountCreditsFn } from "../lib/account.functions";
import { pageHead } from "../lib/seo";

// W6 item 8, ruling H137: a page of the client room. Rendered only in the person's browser and never kept by the edge,
// as the front page of the room is (ruling H119 (4)).
export const Route = createFileRoute("/_site/account/credits")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
  head: () =>
    pageHead({
      title: "Credits",
      description: "Your Five Features credits.",
      path: "/account/credits",
      noindex: true,
    }),
  loader: ({ context: { queryClient } }) =>
    queryClient.query({
      queryKey: ["account", "credits"],
      queryFn: () => readAccountCreditsFn(),
      staleTime: 0,
    }),
  component: CreditsPage,
});

function CreditsPage() {
  const view = Route.useLoaderData();
  return (
    <main>
      <PageIntro eyebrow="Account" title="Credits" />
      <AccountPageView view={view}>
        {(data) => (
          <AccountCredits
            balance={data.balance}
            purchased={data.purchased}
            entries={data.entries}
          />
        )}
      </AccountPageView>
    </main>
  );
}
