import { createLazyFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { IssueEditor } from "../../admin/newsletter/IssueEditor";
import {
  useApproveIssue,
  useIssue,
  useIssuePreview,
  useSaveIssue,
  useSendTest,
  useUnapproveIssue,
} from "../../admin/newsletter/newsletter-queries";
import { PreviewFrame } from "../../admin/newsletter/PreviewFrame";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { useAdminMe } from "../../admin/ui/admin-me";
import { AdminPending } from "../../admin/ui/AdminPending";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";
import { useToast } from "../../admin/ui/use-toast";
import type { viewports } from "../../domain/admin-newsletter";

// The page of the `newsletter.$id.tsx` shell (ruling H66). The route has no loader: the page reads its own issue, and
// an issue that is not there throws `notFound`.
export const Route = createLazyFileRoute("/admin/newsletter/$id")({
  errorComponent: AdminRouteError,
  notFoundComponent: () => (
    <EmptyState title="Issue not found">
      This issue does not exist, or the link is no longer valid.
    </EmptyState>
  ),
  component: IssuePage,
});

function IssuePage() {
  const { id } = Route.useParams();
  const toast = useToast();
  const { actions } = useAdminMe();
  const [viewport, setViewport] = useState<(typeof viewports)[number]>("desktop");
  const issue = useIssue(id);
  const preview = useIssuePreview(id, viewport);
  const save = useSaveIssue(id);
  const approve = useApproveIssue(id);
  const unapprove = useUnapproveIssue(id);
  const sendTest = useSendTest(id);
  const found = issue.data;
  if (found === undefined) {
    if (issue.error === null) return <AdminPending />;
    if (issue.error instanceof AdminApiError && issue.error.status === 404) throw notFound();
    throw issue.error;
  }
  return (
    <>
      <div className="admin-page-head">
        <h1>Place Notes No. {found.number}</h1>
        <a href="/admin/newsletter">All issues</a>
      </div>
      <div className="admin-newsletter">
        <IssueEditor
          key={`${found.id}:${found.status}:${String(found.approval_count)}`}
          issue={found}
          can={{
            update: actions.includes("newsletter.update"),
            approve: actions.includes("newsletter.approve"),
            unapprove: actions.includes("newsletter.unapprove"),
            sendTest: actions.includes("newsletter.send_test"),
          }}
          onSave={(draft) =>
            save.mutateAsync(draft).then(() => {
              toast({ message: "Saved." });
            })
          }
          onApprove={(sendAt) =>
            approve.mutateAsync(sendAt).then(() => {
              toast({ message: "Approved. The send and its preview are queued." });
            })
          }
          onUnapprove={() =>
            unapprove.mutateAsync().then(() => {
              toast({ message: "Back to draft. The queued send and preview are cancelled." });
            })
          }
          onSendTest={() =>
            sendTest.mutateAsync().then(() => {
              toast({ message: "Test queued for your address." });
            })
          }
        />
        <PreviewFrame
          html={preview.data?.html}
          width={preview.data?.width ?? 0}
          viewport={viewport}
          onViewport={setViewport}
          loading={preview.isFetching}
          error={preview.error?.message ?? null}
        />
      </div>
    </>
  );
}
