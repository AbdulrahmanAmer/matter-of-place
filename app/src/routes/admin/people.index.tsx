import { createFileRoute, useRouter } from "@tanstack/react-router";
import { PeopleTable } from "../../admin/people/PeopleTable";
import { peopleFilterNames, usePeople } from "../../admin/people/people-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { useUrlFilters } from "../../admin/ui/use-url-filters";
import { pageHead } from "../../lib/seo";

// Named here, not spread from `adminRouteOptions()` (see requests.index.tsx). The route has no loader, so the table
// draws its own loading rows.
export const Route = createFileRoute("/admin/people/")({
  errorComponent: AdminRouteError,
  head: () =>
    pageHead({
      title: "People",
      description: "Everyone who has sent a request.",
      path: "/admin/people",
      noindex: true,
    }),
  component: PeoplePage,
});

function PeoplePage() {
  const router = useRouter();
  const filters = useUrlFilters(peopleFilterNames);
  const list = usePeople({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const page = list.data;
  const failure = list.error;
  return (
    <>
      <h1>People</h1>
      <PeopleTable
        filters={{ values: filters.values, onChange: filters.setFilters }}
        rows={page?.items ?? []}
        loading={list.isPending}
        error={
          failure === null
            ? null
            : {
                message: failure.message,
                ...(failure instanceof AdminApiError && failure.requestId !== undefined
                  ? { requestId: failure.requestId }
                  : {}),
              }
        }
        onOpen={(row) => {
          void router.navigate({ href: `/admin/people/${row.id}` });
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: page?.next_cursor != null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (page?.next_cursor != null) filters.goNext(page.next_cursor);
          },
        }}
      />
    </>
  );
}
