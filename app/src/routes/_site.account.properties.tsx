import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AccountProperties } from "../components/account/account-properties";
import { AccountPageView } from "../components/account/account-page";
import { PageIntro } from "../components/site/page-intro";
import { readAccountPropertiesFn } from "../lib/account.functions";
import { pageHead } from "../lib/seo";

// W6 item 8, ruling H137: a page of the client room. Rendered only in the person's browser and never kept by the edge,
// as the front page of the room is (ruling H119 (4)).
export const Route = createFileRoute("/_site/account/properties")({
  ssr: false,
  headers: () => ({ "cache-control": "private, no-store" }),
  head: () =>
    pageHead({
      title: "My properties",
      description: "Where each property you submitted to Matter of Place stands.",
      path: "/account/properties",
      noindex: true,
    }),
  loader: ({ context: { queryClient } }) =>
    queryClient.query({
      queryKey: ["account", "properties"],
      queryFn: () => readAccountPropertiesFn(),
      staleTime: 0,
    }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const view = Route.useLoaderData();
  const router = useRouter();
  return (
    <main>
      <PageIntro eyebrow="Account" title="My properties" />
      <AccountPageView view={view}>
        {(data) => (
          <AccountProperties
            properties={data.properties}
            onPhotosSent={() => void router.invalidate()}
          />
        )}
      </AccountPageView>
    </main>
  );
}
