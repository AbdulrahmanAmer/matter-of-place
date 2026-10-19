import { createFileRoute } from "@tanstack/react-router";
import { AccountInvoices } from "../components/account/account-invoices";
import { AccountPageView } from "../components/account/account-page";
import { PageIntro } from "../components/site/page-intro";
import { readAccountInvoicesFn } from "../lib/account.functions";
import { pageHead } from "../lib/seo";

// W6 item 8, ruling H137: a page of the client room. Rendered only in the person's browser and never kept by the edge,
// as the front page of the room is (ruling H119 (4)).
export const Route = createFileRoute("/_site/account/invoices")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
  head: () =>
    pageHead({
      title: "Invoices",
      description: "The invoices Matter of Place has sent you, owed and paid.",
      path: "/account/invoices",
      noindex: true,
    }),
  loader: ({ context: { queryClient } }) =>
    queryClient.query({
      queryKey: ["account", "invoices"],
      queryFn: () => readAccountInvoicesFn(),
      staleTime: 0,
    }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const view = Route.useLoaderData();
  return (
    <main>
      <PageIntro eyebrow="Account" title="Invoices" />
      <AccountPageView view={view}>
        {(data) => <AccountInvoices invoices={data.invoices} />}
      </AccountPageView>
    </main>
  );
}
