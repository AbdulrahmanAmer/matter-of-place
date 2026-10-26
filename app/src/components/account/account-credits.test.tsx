import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInRouter } from "../../../tests/fixtures/router";
import type { AccountCreditEntry } from "../../domain/account";
import { AccountCredits } from "./account-credits";

// W6 item 8, Credits: the Five Features balance, the lines behind it, and "submit my next property" while a credit lasts.

const entries: AccountCreditEntry[] = [
  {
    id: "00000000-0000-4000-8000-0000000000e2",
    kind: "used",
    quantity: -1,
    created_at: "2026-10-05T10:00:00+00:00",
    address: "2 Next Way",
    city: "Malibu",
  },
  {
    id: "00000000-0000-4000-8000-0000000000e1",
    kind: "purchased",
    quantity: 5,
    created_at: "2026-10-01T10:00:00+00:00",
    address: null,
    city: null,
  },
];

describe("AccountCredits", () => {
  it("states the balance and the lines behind it, newest first", async () => {
    renderInRouter(<AccountCredits balance={3} purchased={5} entries={entries} />);
    expect(await screen.findByText("3 credits left.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Used for 2 Next Way, Malibu. Oct 5, 2026 ET.",
      "Five Features paid, 5 credits added. Oct 1, 2026 ET.",
    ]);
  });

  it("says one credit in the singular", async () => {
    renderInRouter(<AccountCredits balance={1} purchased={5} entries={entries} />);
    expect(await screen.findByText("1 credit left.")).toBeTruthy();
  });

  it("opens the form with Five Features chosen while a credit remains", async () => {
    renderInRouter(<AccountCredits balance={3} purchased={5} entries={entries} />);
    const link = await screen.findByRole("link", { name: "Submit my next property" });
    expect(link.getAttribute("href")).toBe("/submit?package=five-features");
  });

  it("offers no submission when the credits are used up", async () => {
    renderInRouter(<AccountCredits balance={0} purchased={5} entries={entries} />);
    expect(await screen.findByText("No credits left.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Submit my next property" })).toBeNull();
  });

  it("explains Five Features to a client who holds none", async () => {
    renderInRouter(<AccountCredits balance={0} purchased={0} entries={[]} />);
    expect(await screen.findByText(/You hold no Five Features credits/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "exposure page" }).getAttribute("href")).toBe(
      "/exposure",
    );
    expect(screen.queryByRole("link", { name: "Submit my next property" })).toBeNull();
  });
});
