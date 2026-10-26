import { Outlet } from "@tanstack/react-router";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { SentEmailsPage } from "./SentEmailsPage";

// The Sent emails screen mounted for a component test: every list answers empty unless the test names its answer.
export function openSentEmails(answers: Record<string, unknown>) {
  const requested = serve({
    "GET /api/admin/emails": { items: [], next_cursor: null, suppressions: [] },
    "GET /api/admin/emails/replies": { items: [], next_cursor: null },
    "GET /api/admin/emails/inbound": { items: [], next_cursor: null },
    ...answers,
  });
  mountRoutes(
    () => (
      <AdminProviders actions={["audit.list"]}>
        <Outlet />
      </AdminProviders>
    ),
    "/admin/emails/",
    (root) => [pageRoute(root, "/admin/emails/", () => <SentEmailsPage />)],
  );
  return requested;
}
