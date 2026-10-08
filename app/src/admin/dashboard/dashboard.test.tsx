import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Dashboard, TodayEntry } from "../../domain/admin-dashboard";
import { DashboardTiles } from "./DashboardTiles";
import { AUDIT_REPORTS_URL, GaugesTile } from "./GaugesTile";
import { TodayFeed } from "./TodayFeed";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const HOUR_MS = 3_600_000;

/** An empty day; each case overrides what it is about. */
function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    counts: {},
    jobs: { failed_24h: 0, dead: 0 },
    assets_pending: 0,
    digest_next_at: null,
    health: null,
    email: { sent_today: 0, sent_month: 0, sent_7d: 0, bounced_7d: 0 },
    database_bytes: 0,
    storage: { bytes: 0 },
    withdraw: { open: 0, oldest_at: null },
    today: [],
    ...overrides,
  };
}

function tiles(data: Dashboard, hasRoute: (routeId: string) => boolean = () => true) {
  render(<DashboardTiles data={data} now={NOW} hasRoute={hasRoute} />);
}

const tile = (name: string) => screen.getByRole("listitem", { name });

describe("DashboardTiles", () => {
  it("an empty day shows Quiet day", () => {
    tiles(dashboard());
    expect(screen.getByRole("heading", { name: "Quiet day" })).toBeTruthy();
  });

  it("a request waiting is not a quiet day, and its tile opens the filtered list", () => {
    tiles(dashboard({ counts: { Submitted: 3 } }));
    expect({
      quiet: screen.queryByRole("heading", { name: "Quiet day" }),
      count: within(tile("Submitted")).getByText("3").textContent,
      href: within(tile("Submitted")).getByRole("link").getAttribute("href"),
    }).toEqual({ quiet: null, count: "3", href: "/admin/requests?workflow_state=Submitted" });
  });

  it("a tile whose list is not built yet has no link", () => {
    tiles(dashboard({ jobs: { failed_24h: 1, dead: 0 } }), (routeId) => routeId !== "/admin/jobs/");
    expect({
      jobs: within(tile("Jobs failed in 24 hours")).queryByRole("link"),
      requests: within(tile("Submitted")).queryByRole("link") === null,
    }).toEqual({ jobs: null, requests: false });
  });

  it("a failed health run shows the red banner", () => {
    tiles(
      dashboard({
        health: { at: "2026-10-08T11:00:00Z", failed: true, failed_checks: ["dead_jobs_24h"] },
      }),
    );
    const banner = screen.getByRole("alert");
    expect({
      text: banner.textContent.includes("dead_jobs_24h"),
      red: banner.classList.contains("admin-banner--danger"),
    }).toEqual({ text: true, red: true });
  });

  it("a passing health run shows no banner", () => {
    tiles(dashboard({ health: { at: "2026-10-08T11:00:00Z", failed: false, failed_checks: [] } }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("2 bounced of 50 sent shows 4%", () => {
    tiles(dashboard({ email: { sent_today: 0, sent_month: 50, sent_7d: 50, bounced_7d: 2 } }));
    const bounce = tile("Bounce rate, 7 days");
    expect({
      rate: within(bounce).getByText("4%").textContent,
      detail: within(bounce).getByText("2 of 50 sent").textContent,
    }).toEqual({ rate: "4%", detail: "2 of 50 sent" });
  });

  it("none sent shows no mail yet", () => {
    tiles(dashboard());
    expect(within(tile("Bounce rate, 7 days")).getByText(/no mail yet/i)).toBeTruthy();
  });

  it("the Withdraw by hand tile is hidden at 0", () => {
    tiles(dashboard());
    expect(screen.queryByRole("listitem", { name: "Withdraw by hand" })).toBeNull();
  });

  it("the Withdraw by hand tile shows 2 and the age of the oldest", () => {
    const oldest = new Date(NOW - 5 * HOUR_MS).toISOString();
    tiles(dashboard({ withdraw: { open: 2, oldest_at: oldest } }));
    const withdraw = tile("Withdraw by hand");
    expect({
      count: within(withdraw).getByText("2").textContent,
      age: within(withdraw)
        .getByText(/Oldest 5 hours/)
        .textContent.includes("Oldest 5 hours"),
      rule: within(withdraw).getByText("Within 24 hours").textContent,
      href: within(withdraw).getByRole("link").getAttribute("href"),
    }).toEqual({ count: "2", age: true, rule: "Within 24 hours", href: "/admin/channels" });
  });

  it("a post flagged 30 hours ago is past the 24 hour rule", () => {
    const oldest = new Date(NOW - 30 * HOUR_MS).toISOString();
    tiles(dashboard({ withdraw: { open: 1, oldest_at: oldest } }));
    expect(within(tile("Withdraw by hand")).getByText("Past 24 hours")).toBeTruthy();
  });
});

describe("GaugesTile", () => {
  it("renders without the B14 route: four vendor lines read Not measured and link to the audit reports", () => {
    render(<GaugesTile data={dashboard()} />);
    const lines = [
      "Workers requests",
      "Storage egress",
      "Sentry errors",
      "GitHub Actions minutes",
    ].map((name) => within(tile(name)).queryByText(/Not measured/) !== null);
    expect({
      lines,
      href: screen.getByRole("link", { name: "Weekly audit reports" }).getAttribute("href"),
    }).toEqual({ lines: [true, true, true, true], href: AUDIT_REPORTS_URL });
  });

  it("805306368 bytes of Storage is 75 percent of 1 GB, in the warning state", () => {
    render(<GaugesTile data={dashboard({ storage: { bytes: 805306368 } })} />);
    const storage = tile("Storage");
    expect({
      share: within(storage).queryByText("75% of 1 GB") !== null,
      state: within(storage).queryByText("Warning") !== null,
      level: storage.getAttribute("data-level"),
    }).toEqual({ share: true, state: true, level: "warning" });
  });

  it("a share of 92 percent is in the alert state, and 60 percent within the limit", () => {
    render(
      <GaugesTile
        data={dashboard({
          email: { sent_today: 92, sent_month: 1800, sent_7d: 0, bounced_7d: 0 },
        })}
      />,
    );
    expect({
      today: within(tile("Mail today")).queryByText("Alert") !== null,
      month: within(tile("Mail this month")).queryByText("Within limit") !== null,
    }).toEqual({ today: true, month: true });
  });
});

describe("TodayFeed", () => {
  const entry = (overrides: Partial<TodayEntry>): TodayEntry => ({
    id: 1,
    at: "2026-10-08T10:00:00Z",
    action: "submissions.start_review",
    entity: "submissions",
    entity_id: null,
    actor_id: "00000000-0000-4000-8000-0000000000a1",
    actor_kind: "human",
    actor_name: "Seed Managing Editor",
    ...overrides,
  });

  it("names who did what, and an agent carries its pill", () => {
    render(
      <TodayFeed
        entries={[
          entry({}),
          entry({ id: 2, action: "submissions.decline", actor_kind: "agent", actor_name: null }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "submissions: start reviewSeed Managing EditorOct 8, 2026, 6:00 AM ET",
      "submissions: declineAgentAgentOct 8, 2026, 6:00 AM ET",
    ]);
  });

  it("an empty day says nothing is recorded yet", () => {
    render(<TodayFeed entries={[]} />);
    expect(screen.getByRole("heading", { name: "Nothing recorded yet today" })).toBeTruthy();
  });
});
