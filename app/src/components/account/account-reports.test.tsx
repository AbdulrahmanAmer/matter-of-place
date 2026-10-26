import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountReport } from "../../domain/account";
import { AccountReports } from "./account-reports";

// W6 item 8, Reports: campaign results, page views and inquiry counts, never an inquirer's details.

const report: AccountReport = {
  id: "00000000-0000-4000-8000-0000000000f1",
  title: "House on the Hill",
  city: "Malibu",
  live_path: "/property/house-on-the-hill",
  package: "The Reach",
  starts_on: "2026-10-01",
  ends_on: "2026-10-14",
  page_views: 1234,
  inquiries: 7,
  inquiries_30d: 3,
  weeks: [
    {
      period_start: "2026-10-08",
      period_end: "2026-10-14",
      impressions: 3400,
      reach: 900,
      clicks: 40,
      video_views: null,
      ctr: 0.0123,
    },
  ],
};

describe("AccountReports", () => {
  it("states the page views and the inquiry counts of a property", () => {
    render(<AccountReports properties={[report]} />);
    const figures = Array.from(document.querySelectorAll(".account-figures > div")).map(
      (figure) => figure.textContent,
    );
    expect(figures).toEqual(["Page views1,234", "Inquiries7", "Inquiries, last 30 days3"]);
    expect(screen.getByRole("link", { name: "See the live page" }).getAttribute("href")).toBe(
      "/property/house-on-the-hill",
    );
  });

  it("lists the weekly figures, and says a figure the platform did not report was not measured", () => {
    render(<AccountReports properties={[report]} />);
    const cells = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      );
    expect(cells).toEqual([
      ["Oct 8, 2026 to Oct 14, 2026", "3,400", "900", "40", "Not measured", "1.23%"],
    ]);
  });

  it("shows counts only: no name, address or message of anyone who wrote to us", () => {
    render(<AccountReports properties={[report]} />);
    expect(screen.getByText(/never who/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/@|Secret/);
  });

  it("says weekly figures appear once a campaign has run, for a property without any", () => {
    render(<AccountReports properties={[{ ...report, weeks: [], live_path: null }]} />);
    expect(screen.getByText("Weekly figures appear here once a campaign has run.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: "See the live page" })).toBeNull();
  });

  it("says so when there is no property yet", () => {
    render(<AccountReports properties={[]} />);
    expect(
      screen.getByText(
        "Nothing here yet. Results for a property appear here once it is on the site.",
      ),
    ).toBeTruthy();
  });
});
