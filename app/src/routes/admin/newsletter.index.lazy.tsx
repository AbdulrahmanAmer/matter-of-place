import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { IssuesTable } from "../../admin/newsletter/IssuesTable";
import { failureText } from "../../admin/newsletter/failure-text";
import { SUBSCRIBER_EXPORT_PATH } from "../../admin/newsletter/newsletter-api";
import {
  useBuildIssue,
  useIssues,
  useSubscriberCounts,
} from "../../admin/newsletter/newsletter-queries";
import { SubscribersTab } from "../../admin/newsletter/SubscribersTab";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { useAdminMe } from "../../admin/ui/admin-me";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { Tabs } from "../../admin/ui/Tabs";
import { useToast } from "../../admin/ui/use-toast";
import { useUrlFilters } from "../../admin/ui/use-url-filters";

// The page of the `newsletter.index.tsx` shell (ruling H66). The route has no loader: each tab reads its own data, and
// the tab lives in the address as `?tab=`.
export const Route = createLazyFileRoute("/admin/newsletter/")({
  errorComponent: AdminRouteError,
  component: NewsletterPage,
});

const TABS = [
  { id: "issues", label: "Issues" },
  { id: "subscribers", label: "Subscribers" },
] as const;

const failureOf = (error: Error | null) =>
  error === null
    ? null
    : {
        message: error.message,
        ...(error instanceof AdminApiError && error.requestId !== undefined
          ? { requestId: error.requestId }
          : {}),
      };

function NewsletterPage() {
  const router = useRouter();
  const toast = useToast();
  const { actions } = useAdminMe();
  const filters = useUrlFilters(["tab"] as const);
  const tab = filters.values.tab === "subscribers" ? "subscribers" : "issues";
  const issues = useIssues();
  const counts = useSubscriberCounts(tab === "subscribers");
  const build = useBuildIssue();

  return (
    <>
      <h1>Newsletter</h1>
      <Tabs
        label="Newsletter"
        tabs={TABS}
        active={tab}
        onChange={(id) => {
          filters.setFilters({ tab: id });
        }}
      >
        {tab === "issues" ? (
          <IssuesTable
            rows={issues.data ?? []}
            loading={issues.isPending}
            error={failureOf(issues.error)}
            onOpen={(row) => {
              void router.navigate({ href: `/admin/newsletter/${row.id}` });
            }}
            {...(actions.includes("newsletter.build")
              ? {
                  toolbar: (
                    <button
                      type="button"
                      className="admin-button"
                      disabled={build.isPending}
                      onClick={() => {
                        build.mutate(undefined, {
                          onSuccess: ({ number }) => {
                            toast({
                              message: `Place Notes No. ${String(number)} is ready to edit.`,
                            });
                          },
                          onError: (error) => {
                            toast({ message: error.message, tone: "danger" });
                          },
                        });
                      }}
                    >
                      Build the next issue
                    </button>
                  ),
                }
              : {})}
          />
        ) : (
          <SubscribersTab
            counts={counts.data}
            loading={counts.isPending}
            error={counts.error === null ? null : failureText(counts.error)}
            exportHref={
              actions.includes("newsletter.subscribers_export") ? SUBSCRIBER_EXPORT_PATH : null
            }
          />
        )}
      </Tabs>
    </>
  );
}
