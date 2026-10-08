import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Report } from "../../domain/admin-reports";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { ToastProvider } from "../ui/Toast";
import { ReportsPage } from "./ReportsPage";

const COMPLETE = "00000000-0000-4000-8000-0000000000a1";
const PARTIAL = "00000000-0000-4000-8000-0000000000a2";
const EMPTY = "00000000-0000-4000-8000-0000000000a3";
const CAMPAIGN = "00000000-0000-4000-8000-0000000000c1";

const report = (id: string, over: Partial<Report> = {}): Report => ({
  id,
  campaign_id: CAMPAIGN,
  property_name: "Oak Hill",
  period_start: "2026-10-05",
  period_end: "2026-10-11",
  media_spend: 0,
  impressions: 3500,
  reach: 1000,
  clicks: 42,
  video_views: 1200,
  ctr: 0.012,
  geography: {},
  channel_mix: { instagram: { posts: 1, reach: 1000, views: 3500, clicks: 42 } },
  owned_distribution: { newsletter_issues: 0, newsletter_clicks: 0 },
  top_creative: null,
  ...over,
});

const complete = report(COMPLETE);
const partial = report(PARTIAL, {
  property_name: "Elm Court",
  video_views: null,
  channel_mix: {
    instagram: { posts: 1, reach: 1000, views: 3500, clicks: 40 },
    x: { posts: 1, clicks: 2 },
  },
});
const empty = report(EMPTY, {
  property_name: "Birch Lane",
  impressions: 0,
  reach: 0,
  clicks: 0,
  video_views: null,
  ctr: null,
  channel_mix: {},
});

const allRoles = ["reports.list", "reports.get", "reports.export"];
const editors = [...allRoles, "reports.email"];

const me = (actions: string[]): AdminMe => ({
  actor: { id: "u1" },
  kind: "human",
  roles: ["chief_editor"],
  scopes: [],
  actions,
  environment: "production",
});

const REPORTS = "/api/admin/reports";

const list = (items: Report[]) => ({ items, total: items.length });

function open(actions: string[], answers: Record<string, unknown>) {
  const requested = serve({
    [`GET ${REPORTS}?page=1`]: list([complete, partial, empty]),
    ...answers,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const layout = (): ReactNode => (
    <QueryClientProvider client={client}>
      <AdminMeContext value={me(actions)}>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </AdminMeContext>
    </QueryClientProvider>
  );
  mountRoutes(layout, "/admin/reports/", (root) => [
    pageRoute(root, "/admin/reports/", () => <ReportsPage />),
  ]);
  return requested;
}

const openRow = async (name: string) => {
  const table = await screen.findByRole("table", { name: "Reports" });
  fireEvent.click(await within(table).findByText(name));
  return screen.findByRole("region", { name: "Report" });
};

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
  vi.restoreAllMocks();
});

describe("the reports table", () => {
  it("lists each week with its figures, Not measured for a figure that is null, and its state", async () => {
    open(allRoles, {});
    const table = await screen.findByRole("table", { name: "Reports" });
    await within(table).findByText("Oak Hill");
    const rows = within(table).getAllByRole("row");
    const cells = (row: HTMLElement | undefined) =>
      within(row ?? document.body)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells(rows[1])).toEqual([
      "Oak Hill",
      "Oct 5, 2026 to Oct 11, 2026",
      "Complete",
      "3,500",
      "1,000",
      "42",
      "1,200",
      "1.2%",
    ]);
    expect(cells(rows[2])).toContain("Partial");
    expect(cells(rows[3])).toEqual([
      "Birch Lane",
      "Oct 5, 2026 to Oct 11, 2026",
      "No data",
      "0",
      "0",
      "0",
      "Not measured",
      "Not measured",
    ]);
  });

  it("says no report exists yet when the list is empty", async () => {
    open(allRoles, { [`GET ${REPORTS}?page=1`]: list([]) });
    expect(await screen.findByText("No reports yet")).toBeTruthy();
  });

  it("narrows to a campaign from the address", async () => {
    const requested = serve({
      [`GET ${REPORTS}?campaign_id=${CAMPAIGN}&page=1`]: list([complete]),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mountRoutes(
      () => (
        <QueryClientProvider client={client}>
          <AdminMeContext value={me(allRoles)}>
            <Outlet />
          </AdminMeContext>
        </QueryClientProvider>
      ),
      `/admin/reports/?campaign=${CAMPAIGN}`,
      (root) => [pageRoute(root, "/admin/reports/", () => <ReportsPage />)],
    );
    await screen.findByText("Oak Hill");
    expect(requested).toContain(`GET ${REPORTS}?campaign_id=${CAMPAIGN}&page=1`);
  });
});

describe("the open report", () => {
  it("shows what is not measured as such and never as 0", async () => {
    open(allRoles, { [`GET ${REPORTS}/${PARTIAL}`]: partial });
    const detail = await openRow("Elm Court");
    const facts = within(detail);
    expect(facts.getByText("Media spend").nextElementSibling?.textContent).toBe("Not tracked");
    expect(facts.getByText("Geography").nextElementSibling?.textContent).toBe("Not measured");
    expect(facts.getByText("Video views").nextElementSibling?.textContent).toBe("Not measured");
    const x = facts.getByRole("row", { name: /^X/ });
    expect(
      within(x)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["1", "Not measured", "Not measured", "2"]);
  });
});

describe("Export and Email to submitter", () => {
  it("calls window.print once from Export, and shows Export to every role", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    open(allRoles, { [`GET ${REPORTS}/${COMPLETE}`]: complete });
    const detail = await openRow("Oak Hill");
    fireEvent.click(within(detail).getByRole("button", { name: "Export" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("hides Email to submitter from a role the matrix does not allow", async () => {
    open(allRoles, { [`GET ${REPORTS}/${COMPLETE}`]: complete });
    const detail = await openRow("Oak Hill");
    expect(within(detail).queryAllByRole("button", { name: "Email to submitter" })).toEqual([]);
  });

  it("posts once from Email to submitter and says Queued", async () => {
    const requested = open(editors, {
      [`GET ${REPORTS}/${COMPLETE}`]: complete,
      [`POST ${REPORTS}/${COMPLETE}/email`]: { job_id: "job-1" },
    });
    const detail = await openRow("Oak Hill");
    fireEvent.click(within(detail).getByRole("button", { name: "Email to submitter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send report" }));
    expect(await within(detail).findByText("Queued")).toBeTruthy();
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
      `POST ${REPORTS}/${COMPLETE}/email`,
    ]);
  });

  it("asks first and posts nothing when the person cancels", async () => {
    const requested = open(editors, { [`GET ${REPORTS}/${COMPLETE}`]: complete });
    const detail = await openRow("Oak Hill");
    fireEvent.click(within(detail).getByRole("button", { name: "Email to submitter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([]);
  });

  it("says Already queued for a second click in the minute and shows an error when the send is refused", async () => {
    open(editors, {
      [`GET ${REPORTS}/${COMPLETE}`]: complete,
      [`POST ${REPORTS}/${COMPLETE}/email`]: { job_id: null, duplicate: true },
    });
    const detail = await openRow("Oak Hill");
    fireEvent.click(within(detail).getByRole("button", { name: "Email to submitter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send report" }));
    expect(await within(detail).findByText("Already queued")).toBeTruthy();
  });

  it("shows the refusal when the campaign has no submitter", async () => {
    open(editors, {
      [`GET ${REPORTS}/${COMPLETE}`]: complete,
      [`POST ${REPORTS}/${COMPLETE}/email`]: Response.json(
        {
          error: { code: "recipient_missing", message: "This campaign has no submitter to email." },
        },
        { status: 422 },
      ),
    });
    const detail = await openRow("Oak Hill");
    fireEvent.click(within(detail).getByRole("button", { name: "Email to submitter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send report" }));
    await waitFor(() => {
      expect(within(detail).getByRole("status").textContent).toContain("no submitter");
    });
  });
});
