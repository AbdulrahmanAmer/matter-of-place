// W8 item 4: the Instagram comments and messages under the posts of screen 12. They are read through the admin route
// only (`GET /api/admin/channels/inbox`), a post's link narrows them to that post, and each shows its state and what
// became of its reply. The words are shown as text, never as markup.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxItem } from "../../domain/channels";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { ToastProvider } from "../ui/Toast";
import { ChannelsPage } from "./ChannelsPage";
import { InboxTable } from "./InboxTable";

const POST = "00000000-0000-4000-8000-0000000000a2";
const INBOX = "/api/admin/channels/inbox";

const item = (n: number, over: Partial<InboxItem> = {}): InboxItem => ({
  id: `00000000-0000-4000-8000-00000000010${String(n)}`,
  kind: "comment",
  social_post_id: POST,
  author_handle: "reader",
  body: "Which architect designed it?",
  received_at: "2026-10-27T10:00:00Z",
  state: "new",
  reply_state: null,
  reply_error: null,
  replied_at: null,
  ...over,
});

const me: AdminMe = {
  actor: { id: "u1" },
  kind: "human",
  roles: ["commercial"],
  scopes: [],
  actions: ["channels.posts_list", "channels.health", "channels.inbox_list"],
  environment: "production",
};

function providers(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AdminMeContext value={me}>
        <ToastProvider>{children}</ToastProvider>
      </AdminMeContext>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InboxTable", () => {
  it("lists each comment and message with its author, words, state and reply", async () => {
    const requested = serve({
      [`GET ${INBOX}`]: {
        items: [
          item(1),
          item(2, {
            kind: "message",
            social_post_id: null,
            author_handle: "buyer",
            body: "<b>Is it still for sale?</b>",
            state: "answered",
            reply_state: "sent",
            replied_at: "2026-10-27T11:00:00Z",
          }),
          item(3, { state: "proposed" }),
          item(4, { state: "proposed", reply_state: "refused", reply_error: "Posting is off" }),
        ],
      },
    });
    render(providers(<InboxTable post={undefined} />));
    const table = await screen.findByRole("table", { name: "Comments and messages" });
    await within(table).findByText("@buyer");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0] ?? table).getByText("@reader")).toBeTruthy();
    expect(within(rows[0] ?? table).getByText("New")).toBeTruthy();
    expect(within(rows[0] ?? table).getByRole("link", { name: "Show this post" })).toBeTruthy();
    expect(within(rows[1] ?? table).getByText("<b>Is it still for sale?</b>")).toBeTruthy();
    expect(within(rows[1] ?? table).getByText("Conversation")).toBeTruthy();
    expect(within(rows[1] ?? table).getByText("Answered")).toBeTruthy();
    expect(within(rows[2] ?? table).getByText("Waits in Approvals")).toBeTruthy();
    expect(within(rows[3] ?? table).getByText("Not sent: posting is off here")).toBeTruthy();
    expect(requested).toEqual([`GET ${INBOX}`]);
  });

  it("says when nothing has been read yet", async () => {
    serve({ [`GET ${INBOX}`]: { items: [] } });
    render(providers(<InboxTable post={undefined} />));
    expect(await screen.findByText("No comments or messages yet")).toBeTruthy();
  });
});

describe("ChannelsPage with a post in the address", () => {
  it("asks the admin route for that post's comments only and shows them under the posts", async () => {
    const requested = serve({
      "GET /api/admin/channels/health": [],
      "GET /api/admin/channels/posts?withdraw=true": { items: [], total: 0 },
      [`GET /api/admin/channels/posts?post_id=${POST}`]: { items: [], total: 0 },
      [`GET ${INBOX}?post_id=${POST}`]: { items: [item(1)] },
    });
    mountRoutes(
      () => providers(<Outlet />),
      `/admin/channels/?post=${POST}`,
      (root) => [pageRoute(root, "/admin/channels/", () => <ChannelsPage />)],
    );
    const table = await screen.findByRole("table", { name: "Comments on this post" });
    expect(await within(table).findByText("Which architect designed it?")).toBeTruthy();
    expect(requested).toContain(`GET ${INBOX}?post_id=${POST}`);
    expect(requested).not.toContain(`GET ${INBOX}`);
  });
});
