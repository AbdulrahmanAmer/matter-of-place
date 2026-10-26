import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { UsageAnswer } from "../../domain/admin-usage";
import { AdminProviders } from "../ui/test-providers";
import { UsageSection } from "./UsageSection";

// Settings, Service usage (W7 item 7): one gauge per vendor line with what was used, its free-plan limit, the share,
// its note and when it was measured; a line never measured says so. Read only. Names, limits and levels are the
// dashboard tile's (`domain/usage-gauges.ts`); the Claude week's note is the ISO time the runner records.

const USAGE = "/api/admin/settings/usage";

const AT = "2026-10-15T04:00:00Z";
const empty = { used: null, limit: null, percent: null, note: null, measured_at: null };

const answer: UsageAnswer = {
  lines: [
    {
      line: "workers_requests_day",
      used: 25_000,
      limit: 100_000,
      percent: 25,
      // the daily push writes no note for this line (`scripts/usage-push.ts`)
      note: null,
      measured_at: AT,
    },
    {
      line: "storage_egress",
      used: 2.5 * 1024 ** 3,
      limit: 5 * 1024 ** 3,
      percent: 50,
      note: null,
      measured_at: AT,
    },
    // a line that records no limit reads against the free-plan one (`getUsage`: 5,000 a month)
    { line: "sentry_errors", used: 12, limit: 5000, percent: 0, note: null, measured_at: AT },
    { line: "actions_minutes", ...empty },
    {
      line: "claude_week",
      used: 42,
      limit: 100,
      percent: 42,
      note: "2026-10-21T16:00:00.000Z",
      measured_at: AT,
    },
  ],
};

function mount(answers: Record<string, unknown>) {
  const requested = serve(answers);
  render(
    <AdminProviders actions={[]}>
      <UsageSection />
    </AdminProviders>,
  );
  return requested;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settings, service usage", () => {
  it("shows each line with what was used, its limit, the share, its note and when it was measured", async () => {
    const requested = mount({ [`GET ${USAGE}`]: answer });
    const workers = await screen.findByRole("listitem", {
      name: "Workers requests, last measured day",
    });
    expect(workers.textContent).toBe(
      "Workers requests, last measured day25,000 of 100,000Within limit25% of the free planMeasured Thu, Oct 15, 07:00 Cairo time",
    );
    const egress = screen.getByRole("listitem", { name: "Storage egress" });
    expect(egress.textContent).toContain("2.5 GB of 5.0 GB");
    expect(within(egress).getByRole("progressbar").getAttribute("value")).toBe("50");
    const claude = screen.getByRole("listitem", { name: "Claude week" });
    expect(claude.textContent).toBe(
      "Claude week42% of the week usedWithin limitResets Wed, Oct 21, 19:00 Cairo timeMeasured Thu, Oct 15, 07:00 Cairo time",
    );
    expect(requested).toEqual([`GET ${USAGE}`]);
  });

  it("says a line was never measured", async () => {
    mount({ [`GET ${USAGE}`]: answer });
    const minutes = await screen.findByRole("listitem", { name: "GitHub Actions minutes" });
    expect(minutes.textContent).toBe("GitHub Actions minutesNot measured yet.");
  });

  it("shows a measured line the plan does not limit as its figure and its note alone", async () => {
    // the push of a public repository's Actions minutes: no limit, the note says why (`scripts/usage-push.ts`)
    mount({
      [`GET ${USAGE}`]: {
        lines: [
          {
            line: "actions_minutes",
            used: 140,
            limit: null,
            percent: null,
            note: "public repository, not limited",
            measured_at: AT,
          },
        ],
      },
    });
    const minutes = await screen.findByRole("listitem", { name: "GitHub Actions minutes" });
    expect(minutes.textContent).toBe(
      "GitHub Actions minutes140public repository, not limitedMeasured Thu, Oct 15, 07:00 Cairo time",
    );
    expect(within(minutes).queryByRole("progressbar")).toBeNull();
  });

  it("fills the bar to the end, never past it, when a limit is passed", async () => {
    mount({
      [`GET ${USAGE}`]: {
        lines: [
          {
            line: "actions_minutes",
            used: 2500,
            limit: 2000,
            percent: 125,
            note: null,
            measured_at: AT,
          },
        ],
      },
    });
    const gauge = await screen.findByRole("listitem", { name: "GitHub Actions minutes" });
    expect({
      bar: within(gauge).getByRole("progressbar").getAttribute("value"),
      words: gauge.textContent,
    }).toEqual({
      bar: "100",
      words:
        "GitHub Actions minutes2,500 of 2,000Alert125% of the free planMeasured Thu, Oct 15, 07:00 Cairo time",
    });
  });

  it("shows the same level as the dashboard tile: warning from 70 percent, alert from 90", async () => {
    const at = (
      line: "workers_requests_day" | "sentry_errors" | "actions_minutes",
      used: number,
    ) => ({
      line,
      used,
      limit: 100,
      percent: used,
      note: null,
      measured_at: AT,
    });
    mount({
      [`GET ${USAGE}`]: {
        lines: [at("workers_requests_day", 69), at("sentry_errors", 70), at("actions_minutes", 90)],
      },
    });
    await screen.findByRole("listitem", { name: "Sentry errors" });
    const pills = screen
      .getAllByRole("listitem")
      .map((item) => within(item).getByText(/limit|Warning|Alert/).textContent);
    expect(pills).toEqual(["Within limit", "Warning", "Alert"]);
  });

  it("shows no reset for a Claude week whose note is not a time, never the raw note", async () => {
    mount({
      [`GET ${USAGE}`]: {
        lines: [
          { line: "claude_week", used: 42, limit: 100, percent: 42, note: "soon", measured_at: AT },
        ],
      },
    });
    const claude = await screen.findByRole("listitem", { name: "Claude week" });
    expect(claude.textContent).toBe(
      "Claude week42% of the week usedWithin limitMeasured Thu, Oct 15, 07:00 Cairo time",
    );
  });

  it("shows the refusal of the read, and no gauge", async () => {
    mount({
      [`GET ${USAGE}`]: new Response(
        JSON.stringify({ error: { code: "unavailable", message: "Usage could not be read." } }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Usage could not be read.");
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });
});
