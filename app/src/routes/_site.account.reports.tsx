import { createFileRoute } from "@tanstack/react-router";
import { AccountReports } from "../components/account/account-reports";
import { AccountPageView } from "../components/account/account-page";
import { PageIntro } from "../components/site/page-intro";
import { readAccountReportsFn } from "../lib/account.functions";
import { pageHead } from "../lib/seo";

// W6 item 8, ruling H142: a page of the client room. Rendered only in the person's browser and never kept by the edge,
// as the front page of the room is (ruling H119 (4)).
export const Route = createFileRoute("/_site/account/reports")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
  head: () =>
    pageHead({
      title: "Reports",
      description: "Campaign results, page views and inquiry counts for your properties.",
      path: "/account/reports",
      noindex: true,
    }),
  loader: ({ context: { queryClient } }) =>
    queryClient.query({
      queryKey: ["account", "reports"],
      queryFn: () => readAccountReportsFn(),
      staleTime: 0,
    }),
  component: ReportsPage,
});

function ReportsPage() {
  const view = Route.useLoaderData();
  return (
    <main>
      <PageIntro eyebrow="Account" title="Reports" />
      <AccountPageView view={view}>
        {(data) => <AccountReports properties={data.properties} />}
      </AccountPageView>
    </main>
  );
}
