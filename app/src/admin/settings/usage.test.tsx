import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { UsageAnswer } from "../../domain/admin-usage";
import { AdminProviders } from "../ui/test-providers";
import { UsageSection } from "./UsageSection";

// Settings, Service usage (W7 item 7): one gauge per vendor line with what was used, its free-plan limit, the share,
// its note and when it was measured; a line never measured says so. Read only.

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
      note: "Yesterday",
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
    { line: "sentry_errors", used: 12, limit: null, percent: null, note: null, measured_at: AT },
    { line: "actions_minutes", ...empty },
    {
      line: "claude_week",
      used: 42,
      limit: 100,
      percent: 42,
      note: "Resets Sat, Oct 17",
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
    const workers = await screen.findByRole("listitem", { name: "Workers requests today" });
    expect(workers.textContent).toBe(
      "Workers requests today25,000 of 100,00025% of the free planYesterdayMeasured Thu, Oct 15, 07:00 Cairo time",
    );
    const egress = screen.getByRole("listitem", { name: "Storage egress this month" });
    expect(egress.textContent).toContain("2.5 GB of 5.0 GB");
    expect(within(egress).getByRole("progressbar").getAttribute("value")).toBe("50");
    const claude = screen.getByRole("listitem", { name: "Claude week" });
    expect(claude.textContent).toContain("42% of the week used");
    expect(claude.textContent).toContain("Resets Sat, Oct 17");
    expect(requested).toEqual([`GET ${USAGE}`]);
  });

  it("says a line was never measured, and shows a measured line without a limit as its figure alone", async () => {
    mount({ [`GET ${USAGE}`]: answer });
    const minutes = await screen.findByRole("listitem", { name: "Actions minutes this month" });
    expect(minutes.textContent).toBe("Actions minutes this monthNot measured yet.");
    const sentry = screen.getByRole("listitem", { name: "Sentry errors this month" });
    expect(sentry.textContent).toContain("Sentry errors this month12");
    expect(within(sentry).queryByRole("progressbar")).toBeNull();
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
    const gauge = await screen.findByRole("listitem", { name: "Actions minutes this month" });
    expect({
      bar: within(gauge).getByRole("progressbar").getAttribute("value"),
      words: gauge.textContent,
    }).toEqual({
      bar: "100",
      words:
        "Actions minutes this month2,500 of 2,000125% of the free planMeasured Thu, Oct 15, 07:00 Cairo time",
    });
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
