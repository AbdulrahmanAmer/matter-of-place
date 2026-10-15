import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../../domain/admin-campaigns";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
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

function open(items: Campaign[]) {
  serve({ [`GET ${API}`]: { items, total: items.length } });
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
    render(<CampaignsTable today="2026-11-06" rows={[oak, elm, birch]} />);
    const states = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => cells(row)[3]);
    expect(states).toEqual(["Ended", "Not scheduled", "Running"]);
  });
});
