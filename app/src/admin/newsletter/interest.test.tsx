import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminProviders } from "../ui/test-providers";
import { InterestPage } from "./InterestPage";
import { marketName } from "../../lib/market-names";
import { sourceName } from "./interest-names";

// The Interest screen (operator, 2026-10-15): a partner's California signup was saved and confirmed, but nothing in
// the admin showed who asked about which market.

const view = {
  signups: [
    {
      email: "partner@example.test",
      markets: ["california"],
      source: "interest:properties",
      status: "confirmed",
      confirmed_at: "2026-10-14T08:49:00Z",
    },
    {
      email: "reader@example.test",
      markets: [],
      source: "newsletter",
      status: "pending",
      confirmed_at: null,
    },
  ],
  markets: [
    { market: "california", confirmed: 1, pending: 0 },
    { market: "place-notes", confirmed: 0, pending: 1 },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Interest screen", () => {
  it("lists each signup with its market, the page it came from and its state, and the totals per market", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json(view)));
    render(
      <AdminProviders actions={["newsletter.subscribers_export"]}>
        <InterestPage />
      </AdminProviders>,
    );
    const signups = await screen.findByRole("table", { name: /Every signup/ });
    const totals = screen.getByRole("table", { name: "By market" });
    const rows = within(signups).getAllByRole("row").slice(1);
    expect({
      rows: rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
      totals: within(totals)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    }).toEqual({
      rows: [
        [
          "Wed, Oct 14, 01:49 PT",
          "partner@example.test",
          "California",
          "Properties page",
          "Confirmed",
        ],
        [
          "Not yet",
          "reader@example.test",
          "Place Notes only",
          "Newsletter",
          "Waiting for confirmation",
        ],
      ],
      totals: ["California10", "Place Notes only01"],
    });
  });

  it("says plainly when no one has signed up yet", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ signups: [], markets: [] })));
    render(
      <AdminProviders actions={["newsletter.subscribers_export"]}>
        <InterestPage />
      </AdminProviders>,
    );
    expect(await screen.findByText("No one has signed up yet.")).toBeTruthy();
  });

  it("names markets and pages in words", () => {
    expect([
      marketName("new-york"),
      marketName("place-notes"),
      sourceName("interest:market:california"),
      sourceName("interest:properties"),
    ]).toEqual(["New York", "Place Notes only", "Market page: california", "Properties page"]);
  });
});
