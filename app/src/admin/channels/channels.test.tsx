import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SocialPost } from "../../domain/channels";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { channelHealth } from "../../../tests/fixtures/channel-health";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { ToastProvider } from "../ui/Toast";
import { ChannelCards } from "./ChannelCards";
import { ChannelsPage } from "./ChannelsPage";
import { MetricsCell } from "./MetricsCell";
import { PostsTable } from "./PostsTable";
import { WithdrawList } from "./WithdrawList";

const FAILED = "00000000-0000-4000-8000-0000000000a1";
const POSTED = "00000000-0000-4000-8000-0000000000a2";
const SCHEDULED = "00000000-0000-4000-8000-0000000000a3";
const TAKEN_DOWN = "00000000-0000-4000-8000-0000000000b1";
const TAKEN_DOWN_TOO = "00000000-0000-4000-8000-0000000000b2";
const ASSET = "00000000-0000-4000-8000-0000000000c1";
const PROPERTY = "00000000-0000-4000-8000-0000000000d1";

const post = (id: string, over: Partial<SocialPost> = {}): SocialPost => ({
  id,
  asset_id: ASSET,
  property_id: PROPERTY,
  channel: "x",
  status: "posted",
  scheduled_at: "2026-10-05T14:00:00Z",
  posted_at: "2026-10-05T14:00:05Z",
  remote_id: "1",
  permalink: "https://x.com/mop/status/1",
  metrics: {},
  error: null,
  withdraw_required_at: null,
  withdrawn_at: null,
  ...over,
});

const failed = post(FAILED, {
  status: "failed",
  posted_at: null,
  remote_id: null,
  permalink: null,
  error: "token_dead",
});
const scheduled = post(SCHEDULED, {
  status: "scheduled",
  posted_at: null,
  remote_id: null,
  permalink: null,
});
const posted = post(POSTED, { metrics: { reach: 1200, likes: 31 } });

const flagged = [
  post(TAKEN_DOWN, {
    channel: "instagram",
    permalink: "https://www.instagram.com/p/AAA/",
    withdraw_required_at: "2026-10-04T12:00:00Z",
  }),
  post(TAKEN_DOWN_TOO, {
    channel: "linkedin",
    permalink: "https://www.linkedin.com/feed/update/BBB/",
    withdraw_required_at: "2026-10-05T12:00:00Z",
  }),
];

const operatorActions = [
  "channels.posts_list",
  "channels.health",
  "channels.retry",
  "channels.cancel",
  "channels.metrics_refresh",
  "channels.mark_withdrawn",
  "channels.ids_put",
];
const commercialActions = ["channels.posts_list", "channels.health"];

const me = (actions: string[]): AdminMe => ({
  actor: { id: "u1" },
  kind: "human",
  roles: ["media_ops"],
  scopes: [],
  actions,
  environment: "production",
});

function providers(actions: string[], children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AdminMeContext value={me(actions)}>
        <ToastProvider>{children}</ToastProvider>
      </AdminMeContext>
    </QueryClientProvider>
  );
}

const mount = (actions: string[], page: ReactNode) => render(providers(actions, page));

const list = (items: SocialPost[]) => ({ items, total: items.length });

const POSTS = "/api/admin/channels/posts";

const healthRows = [
  channelHealth("instagram", {
    lastPost: { at: "2026-10-05T14:00:00Z", permalink: "https://www.instagram.com/p/AAA/" },
  }),
  channelHealth("x", {
    level: "amber",
    lastError: { at: "2026-10-06T09:00:00Z", error: "outcome_unknown" },
    token: { expiresAt: "2026-10-20T00:00:00.000Z", daysLeft: 14, level: "amber" },
    reads: { used: 80, allowance: 100, level: "amber" },
  }),
  channelHealth("linkedin", {
    connected: false,
    level: "red",
    token: { expiresAt: null, daysLeft: null, level: "red" },
  }),
];

const card = (name: string) => screen.getByRole("article", { name });

// jsdom has no showModal or close on <dialog>; these toggle `open` as the browser's do (as in dialogs.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChannelCards", () => {
  it("draws a card per live channel with its last post, last error and token", async () => {
    serve({ "GET /api/admin/channels/health": healthRows });
    mount(commercialActions, <ChannelCards />);
    await within(card("X")).findByText("14 days left");
    expect({
      instagram: within(card("Instagram"))
        .getByRole("link", { name: "View post" })
        .getAttribute("href"),
      xError: within(card("X")).getByText(/outcome_unknown/).tagName,
      xReads: within(card("X")).getByText("80 of 100").tagName,
      xState: within(card("X")).getByText("Attention").getAttribute("data-tone"),
      linkedin: within(card("LinkedIn")).getByText("Not connected").tagName,
      linkedinState: within(card("LinkedIn"))
        .getByText("Reconnect needed")
        .getAttribute("data-tone"),
    }).toEqual({
      instagram: "https://www.instagram.com/p/AAA/",
      xError: "DD",
      xReads: "DD",
      xState: "warning",
      linkedin: "DD",
      linkedinState: "danger",
    });
  });

  it("shows Facebook and YouTube as not enabled yet, with no form, no toggle and no state", async () => {
    serve({
      "GET /api/admin/channels/health": [
        ...healthRows,
        channelHealth("facebook", { level: "red" }),
      ],
    });
    mount(operatorActions, <ChannelCards />);
    await within(card("X")).findByText("14 days left");
    for (const name of ["Facebook", "YouTube"]) {
      expect(within(card(name)).getByText("Not enabled yet")).toBeTruthy();
      expect(within(card(name)).queryByText("Reconnect needed")).toBeNull();
      expect(within(card(name)).queryAllByRole("button")).toEqual([]);
      expect(within(card(name)).queryAllByRole("switch")).toEqual([]);
      expect(within(card(name)).queryAllByRole("checkbox")).toEqual([]);
    }
  });

  it("shows the Account ids form on each live card to channels.ids_put and to no one else", async () => {
    serve({ "GET /api/admin/channels/health": healthRows });
    const { unmount } = mount(operatorActions, <ChannelCards />);
    await within(card("X")).findByText("14 days left");
    expect(screen.getAllByRole("form", { name: "Account ids" })).toHaveLength(3);
    unmount();
    mount(commercialActions, <ChannelCards />);
    await within(card("X")).findByText("14 days left");
    expect(screen.queryAllByRole("form", { name: "Account ids" })).toEqual([]);
  });

  it("sends only the fields filled in, named by channelIdsSchema, and never asks for a token", async () => {
    const requested = serve({
      "GET /api/admin/channels/health": healthRows,
      "PUT /api/admin/channels/ids/x": { key: "x", value: { user_id: "12345" } },
    });
    mount(operatorActions, <ChannelCards />);
    const form = await within(card("X")).findByRole("form", { name: "Account ids" });
    expect(within(form).queryByLabelText(/token/i)).toBeNull();
    fireEvent.change(within(form).getByLabelText("X user id"), { target: { value: "12345" } });
    fireEvent.change(within(form).getByLabelText("Handle"), { target: { value: "mop_test" } });
    fireEvent.change(within(form).getByLabelText("Metrics days"), { target: { value: "7, 28" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save ids" }));
    await waitFor(() => {
      expect(requested.filter((line) => line.startsWith("PUT"))).toHaveLength(1);
    });
    expect(requested.filter((line) => line.startsWith("PUT"))).toEqual([
      'PUT /api/admin/channels/ids/x {"user_id":"12345","handle":"mop_test","metrics_days":[7,28]}',
    ]);
  });

  it("refuses a handle with an @ before any request is sent", async () => {
    const requested = serve({ "GET /api/admin/channels/health": healthRows });
    mount(operatorActions, <ChannelCards />);
    const form = await within(card("X")).findByRole("form", { name: "Account ids" });
    fireEvent.change(within(form).getByLabelText("Handle"), { target: { value: "@mop" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save ids" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "Use the handle without the @",
    );
    expect(requested.filter((line) => line.startsWith("PUT"))).toEqual([]);
  });
});

describe("PostsTable", () => {
  const filters = { values: {}, onChange: () => undefined };

  const retryRoute = `POST ${POSTS}/${FAILED}/retry`;
  const writes = (requested: string[]) => requested.filter((line) => line.startsWith("POST"));
  const retryDialog = () => within(screen.getByRole("dialog", { name: "Retry the X post" }));

  it("marks a failed row red and gives it a Retry that posts once to its retry route", async () => {
    const requested = serve({ [retryRoute]: { job_id: "j1" } });
    mount(operatorActions, <PostsTable rows={[failed]} filters={filters} />);
    expect(within(screen.getByRole("table")).getByText("Failed").getAttribute("data-tone")).toBe(
      "danger",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(retryDialog().getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(requested).toContain(`${retryRoute} {"force":false}`);
    });
    expect(writes(requested)).toEqual([`${retryRoute} {"force":false}`]);
  });

  it("asks before it retries and sends nothing when the person backs out", () => {
    const requested = serve({ [retryRoute]: { job_id: "j1" } });
    mount(operatorActions, <PostsTable rows={[failed]} filters={filters} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(writes(requested)).toEqual([]);
    fireEvent.click(retryDialog().getByRole("button", { name: "Cancel" }));
    expect(writes(requested)).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Retry the X post" })).toBeNull();
  });

  it("retries with force when the post-again box is ticked, and only then", async () => {
    const requested = serve({ [retryRoute]: { job_id: "j1" } });
    mount(operatorActions, <PostsTable rows={[failed]} filters={filters} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const box = retryDialog().getByLabelText(
      "Post again even if this property is already posted on this channel",
    );
    expect(box).toHaveProperty("checked", false);
    fireEvent.click(box);
    fireEvent.click(retryDialog().getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([`${retryRoute} {"force":true}`]);
    });
  });

  it("asks before it cancels a scheduled post, then posts once to its cancel route", async () => {
    const cancelRoute = `POST ${POSTS}/${SCHEDULED}/cancel`;
    const requested = serve({ [cancelRoute]: { cancelled: true } });
    mount(operatorActions, <PostsTable rows={[scheduled]} filters={filters} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(writes(requested)).toEqual([]);
    const dialog = within(screen.getByRole("dialog", { name: "Cancel the X post" }));
    fireEvent.click(dialog.getByRole("button", { name: "Cancel post" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([cancelRoute]);
    });
  });

  it("gives commercial no action at all", () => {
    mount(commercialActions, <PostsTable rows={[failed, scheduled, posted]} filters={filters} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  });

  it("offers each row only the action of its status", () => {
    mount(operatorActions, <PostsTable rows={[failed, scheduled, posted]} filters={filters} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .queryAllByRole("button")
          .map((button) => button.textContent),
      ),
    ).toEqual([["Retry"], ["Cancel"], ["Refresh metrics"]]);
  });

  it("shows the numbers a platform returned and None yet for a row without any", () => {
    mount(operatorActions, <PostsTable rows={[posted, scheduled]} filters={filters} />);
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toContain("Reach 1,200, Likes 31");
    expect(cells).toContain("None yet");
  });
});

describe("MetricsCell", () => {
  it("leaves out a field the platform did not return instead of showing 0", () => {
    render(<MetricsCell metrics={{ reach: 5, likes: null, raw: { likes: 9 } }} />);
    expect(screen.getByText("Reach 5")).toBeTruthy();
  });
});

describe("WithdrawList", () => {
  const answers = { [`GET ${POSTS}?withdraw=true`]: list(flagged) };

  it("lists the two flagged posts with their permalinks", async () => {
    serve(answers);
    mount(operatorActions, <WithdrawList />);
    const links = await screen.findAllByRole("link", { name: "View post" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://www.instagram.com/p/AAA/",
      "https://www.linkedin.com/feed/update/BBB/",
    ]);
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toContain("Instagram");
  });

  it("posts Done once to the withdrawn route of that row", async () => {
    const requested = serve({
      ...answers,
      [`POST ${POSTS}/${TAKEN_DOWN}/withdrawn`]: { withdrawn: true },
    });
    mount(operatorActions, <WithdrawList />);
    const done = await screen.findAllByRole("button", { name: "Done" });
    fireEvent.click(done[0] ?? document.body);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Mark as deleted" })).getByRole("button", {
        name: "Mark as deleted",
      }),
    );
    await waitFor(() => {
      expect(requested.filter((line) => line.startsWith("POST"))).toHaveLength(1);
    });
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
      `POST ${POSTS}/${TAKEN_DOWN}/withdrawn`,
    ]);
  });

  it("asks before it marks a post as withdrawn and sends nothing when the person backs out", async () => {
    const requested = serve(answers);
    mount(operatorActions, <WithdrawList />);
    const done = await screen.findAllByRole("button", { name: "Done" });
    fireEvent.click(done[0] ?? document.body);
    const dialog = within(screen.getByRole("dialog", { name: "Mark as deleted" }));
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Mark as deleted" })).toBeNull();
  });

  it("shows the request id when the list does not load", async () => {
    serve({
      [`GET ${POSTS}?withdraw=true`]: Response.json(
        { error: { code: "unavailable", message: "The database is not available." } },
        { status: 503, headers: { "x-request-id": "req-77" } },
      ),
    });
    mount(operatorActions, <WithdrawList />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The database is not available. Request req-77.",
    );
  });

  it("hides Done from commercial, who still see the list", async () => {
    serve(answers);
    mount(commercialActions, <WithdrawList />);
    await screen.findAllByRole("link", { name: "View post" });
    expect(screen.queryAllByRole("button", { name: "Done" })).toEqual([]);
  });

  it("says nothing is waiting when the list is empty", async () => {
    serve({ [`GET ${POSTS}?withdraw=true`]: list([]) });
    mount(operatorActions, <WithdrawList />);
    expect(await screen.findByText("Nothing to delete by hand")).toBeTruthy();
  });
});

describe("ChannelsPage", () => {
  const layout = () => providers(operatorActions, <Outlet />);

  function open(at: string, answers: Record<string, unknown>) {
    const requested = serve({
      "GET /api/admin/channels/health": healthRows,
      [`GET ${POSTS}?withdraw=true`]: list([]),
      ...answers,
    });
    mountRoutes(layout, at, (root) => [
      pageRoute(root, "/admin/channels/", () => <ChannelsPage />),
    ]);
    return requested;
  }

  it("loads one row, with its error and Retry, for the post of a failure mail's link", async () => {
    const requested = open(`/admin/channels/?post=${FAILED}`, {
      [`GET ${POSTS}?post_id=${FAILED}`]: list([failed]),
    });
    const table = await screen.findByRole("table", { name: "Posts" });
    expect(await within(table).findByText("token_dead")).toBeTruthy();
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(within(table).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(requested.filter((line) => line.includes(`${POSTS}?`))).toContain(
      `GET ${POSTS}?post_id=${FAILED}`,
    );
  });

  it("asks for the first page with the filters of the address", async () => {
    const requested = open("/admin/channels/?channel=x&status=failed", {
      [`GET ${POSTS}?channel=x&status=failed&page=1`]: list([failed]),
    });
    await screen.findByRole("table", { name: "Posts" });
    await act(() => Promise.resolve());
    expect(requested).toContain(`GET ${POSTS}?channel=x&status=failed&page=1`);
  });
});
