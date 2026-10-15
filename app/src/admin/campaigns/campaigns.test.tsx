import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignListLimit, type Campaign } from "../../domain/admin-campaigns";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { adminKeys } from "../query";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { CampaignsPage } from "./CampaignsPage";
import { CampaignsTable } from "./CampaignsTable";
import { campaignState } from "./figures";

const OAK = "00000000-0000-4000-8000-0000000000c1";
const ELM = "00000000-0000-4000-8000-0000000000c2";
const BIRCH = "00000000-0000-4000-8000-0000000000c3";
const API = "/api/admin/campaigns";

const campaign = (id: string, over: Partial<Campaign> = {}): Campaign => ({
  id,
  property_id: "00000000-0000-4000-8000-0000000000b1",
  property_title: "Oak Hill",
  market_slug: "california",
  package: "The Campaign",
  media_budget: 5000,
  management_fee: 750,
  starts_on: "2026-10-05",
  ends_on: "2026-11-05",
  channels: {
    homepage: "active",
    featured: "planned",
    newsletter: "none",
    social: "active",
    programmatic: "none",
  },
  report_count: 2,
  ...over,
});

const oak = campaign(OAK);
const elm = campaign(ELM, {
  property_title: "Elm Court",
  market_slug: "new-york",
  package: "The Feature",
  media_budget: 0,
  management_fee: 0,
  starts_on: null,
  ends_on: null,
  report_count: 0,
});
const birch = campaign(BIRCH, {
  property_title: "Birch Lane",
  market_slug: "florida",
  starts_on: "2020-01-01",
  ends_on: null,
  report_count: 1,
});

function open(items: Campaign[], total = items.length) {
  const requested = serve({ [`GET ${API}`]: { items, total } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mountRoutes(
    () => (
      <QueryClientProvider client={client}>
        <Outlet />
      </QueryClientProvider>
    ),
    "/admin/campaigns/",
    (root) => [pageRoute(root, "/admin/campaigns/", () => <CampaignsPage />)],
  );
  return { client, requested };
}

const cells = (row: HTMLElement | undefined) =>
  within(row ?? document.body)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the campaigns table", () => {
  it("lists each campaign with its property, market, package, money, dates, state, channels and report link", async () => {
    open([oak, elm, birch]);
    const table = await screen.findByRole("table", { name: "Campaigns" });
    await within(table).findByText("Oak Hill");
    const rows = within(table).getAllByRole("row");
    // The state column (index 3) follows the clock; the next tests fix the day.
    expect(cells(rows[1]).filter((_, index) => index !== 3)).toEqual([
      "Oak Hill",
      "California",
      "The Campaign",
      "Oct 5, 2026 to Nov 5, 2026",
      "$5,000",
      "$750",
      "Homepage: Active Featured: Planned Newsletter: Not used Social: Active Programmatic: Not used ",
      "2 weekly reports",
    ]);
    expect(cells(rows[2])).toEqual([
      "Elm Court",
      "New York",
      "The Feature",
      "Not scheduled",
      "Not scheduled",
      "$0",
      "$0",
      "Homepage: Active Featured: Planned Newsletter: Not used Social: Active Programmatic: Not used ",
      "None yet",
    ]);
    expect(cells(rows[3])).toContain("From Jan 1, 2020");
    expect(cells(rows[3])).toContain("Running");
  });

  it("links a campaign to its weekly reports and does not link one that has none", async () => {
    open([oak, elm]);
    const table = await screen.findByRole("table", { name: "Campaigns" });
    const link = await within(table).findByRole("link", { name: "2 weekly reports" });
    expect(link.getAttribute("href")).toBe(`/admin/reports?campaign=${OAK}`);
    expect(within(table).getAllByRole("link", { name: /weekly report/ })).toHaveLength(1);
  });

  it("says no campaign exists yet when the list is empty", async () => {
    open([]);
    expect(await screen.findByText("No campaigns yet")).toBeTruthy();
  });

  it("reads the state from the dates against the day it is given", () => {
    const rows = [oak, elm, birch];
    const stateOf = (today: string) => rows.map((row) => campaignState(row, today));
    expect(stateOf("2026-10-04")).toEqual(["upcoming", "unscheduled", "running"]);
    expect(stateOf("2026-10-05")).toEqual(["running", "unscheduled", "running"]);
    expect(stateOf("2026-11-05")).toEqual(["running", "unscheduled", "running"]);
    expect(stateOf("2026-11-06")).toEqual(["ended", "unscheduled", "running"]);
  });

  it("shows the state word of each row against the day it is given", () => {
    render(<CampaignsTable now={new Date("2026-11-06T12:00:00Z")} rows={[oak, elm, birch]} />);
    const states = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => cells(row)[3]);
    expect(states).toEqual(["Ended", "Not scheduled", "Running"]);
  });

  // Oak Hill (California) ends on Nov 5 and Elm Row (New York) starts on Oct 5: a state flips at midnight in the
  // market's own zone, not at midnight UTC.
  const evening = (market: string, starts: string | null, ends: string | null) =>
    campaign(OAK, { market_slug: market, starts_on: starts, ends_on: ends });
  const stateAt = (row: Campaign, instant: string) => {
    render(<CampaignsTable now={new Date(instant)} rows={[row]} />);
    return cells(screen.getAllByRole("row")[1])[3];
  };

  it("keeps a California campaign running through the evening of its last day, Pacific time", () => {
    // 2026-11-06T01:00Z is 5:00 PM on Nov 5 in California (PST): the UTC day is already Nov 6.
    expect(stateAt(evening("california", "2026-10-05", "2026-11-05"), "2026-11-06T01:00:00Z")).toBe(
      "Running",
    );
  });

  it("ends a California campaign when its own day has passed", () => {
    // 2026-11-06T09:00Z is 1:00 AM on Nov 6 in California.
    expect(stateAt(evening("california", "2026-10-05", "2026-11-05"), "2026-11-06T09:00:00Z")).toBe(
      "Ended",
    );
  });

  it("keeps a New York campaign upcoming through the evening before its first day, Eastern time", () => {
    // 2026-10-05T01:00Z is 9:00 PM on Oct 4 in New York (EDT).
    expect(stateAt(evening("new-york", "2026-10-05", null), "2026-10-05T01:00:00Z")).toBe(
      "Upcoming",
    );
  });

  it("says when only the newest campaigns are shown", async () => {
    open([oak], campaignListLimit + 50);
    expect(
      await screen.findByText(
        `Showing the newest ${String(campaignListLimit)} of ${String(campaignListLimit + 50)} campaigns.`,
      ),
    ).toBeTruthy();
  });

  it("says nothing about a limit when every campaign is shown", async () => {
    open([oak]);
    await screen.findByText("Oak Hill");
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it("is refreshed when the campaigns feature key is invalidated", async () => {
    const { client, requested } = open([oak]);
    await screen.findByText("Oak Hill");
    expect(requested).toEqual([`GET ${API}`]);
    await act(() => client.invalidateQueries({ queryKey: adminKeys.campaigns.all() }));
    await waitFor(() => {
      expect(requested).toEqual([`GET ${API}`, `GET ${API}`]);
    });
  });
});
