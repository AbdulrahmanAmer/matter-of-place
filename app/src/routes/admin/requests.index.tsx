import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { RequestFilters } from "../../admin/requests/RequestFilters";
import { RequestsTable } from "../../admin/requests/RequestsTable";
import {
  requestFilterNames,
  useStartReview,
  useSubmissions,
} from "../../admin/requests/requests-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { useAdminMe } from "../../admin/ui/admin-me";
import { EmptyState } from "../../admin/ui/EmptyState";
import { useToast } from "../../admin/ui/use-toast";
import { useUrlFilters } from "../../admin/ui/use-url-filters";
import { savedViews } from "../../domain/admin-submissions";
import { pageHead } from "../../lib/seo";

// Named here, not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports stay in the route tree, which
// the public entry loads, and bundle-check refuses the admin chunks they make. The router splits `errorComponent`
// into this route's own chunk. The route has no loader, so the table draws its own loading rows.
export const Route = createFileRoute("/admin/requests/")({
  errorComponent: AdminRouteError,
  head: () =>
    pageHead({
      title: "Requests",
      description: "Requests waiting for a decision.",
      path: "/admin/requests",
      noindex: true,
    }),
  component: RequestsPage,
});

const viewItems = Object.entries(savedViews).map(([id, view]) => ({ id, label: view.label }));

const plural = (count: number) => `${String(count)} ${count === 1 ? "request" : "requests"}`;

function RequestsPage() {
  const router = useRouter();
  const toast = useToast();
  const { actions } = useAdminMe();
  const filters = useUrlFilters(requestFilterNames);
  const list = useSubmissions({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const start = useStartReview();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(() => Date.now());
  const page = list.data;
  const failure = list.error;

  const startSelected = () => {
    start.mutate([...selected], {
      onSuccess: ({ started }) => {
        setSelected(new Set());
        toast({ message: `Review started on ${plural(started)}.` });
      },
      onError: (error) => {
        toast({ message: error.message, tone: "danger" });
      },
    });
  };

  return (
    <>
      <h1>Requests</h1>
      <RequestFilters
        key={filters.values.search ?? ""}
        values={filters.values}
        onChange={filters.setFilters}
      />
      <RequestsTable
        rows={page?.items ?? []}
        now={now}
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
        empty={<EmptyState title="No requests">Nothing matches these filters.</EmptyState>}
        onOpen={(row) => {
          void router.navigate({ href: `/admin/requests/${row.id}` });
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: page?.next_cursor != null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (page?.next_cursor != null) filters.goNext(page.next_cursor);
          },
        }}
        views={{
          items: viewItems,
          active: filters.values.view ?? null,
          onSelect: (id) => {
            const { view: _view, ...rest } = filters.values;
            filters.setFilters(id === null ? rest : { ...rest, view: id });
          },
        }}
        {...(actions.includes("submissions.start_review")
          ? {
              selection: {
                ids: selected,
                onToggle: (id: string) => {
                  const next = new Set(selected);
                  if (!next.delete(id)) next.add(id);
                  setSelected(next);
                },
              },
              toolbar: (
                <button
                  type="button"
                  className="admin-button"
                  disabled={selected.size === 0 || start.isPending}
                  onClick={startSelected}
                >
                  Start review{selected.size === 0 ? "" : ` (${String(selected.size)})`}
                </button>
              ),
            }
          : {})}
      />
    </>
  );
}
