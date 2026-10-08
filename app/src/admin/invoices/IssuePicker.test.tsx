import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssuePicker } from "./IssuePicker";

const ID = "00000000-0000-4000-8000-0000000000c1";

const accepted = {
  id: ID,
  received_at: "2026-10-01T12:00:00Z",
  address: "12 Fixture Lane",
  city: "Montecito",
  state: "California",
  submitter_kind: "agent",
  submitter_name: "Ana Fixture",
  brokerage: "Fixture Brokerage",
  package: "The Feature",
  workflow_state: "Accepted",
  accepted_at: "2026-10-02T12:00:00Z",
  duplicate_of: null,
  turnstile_ok: true,
  property_id: null,
};

function mount(items: unknown[]) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string) => {
    requested.push(path);
    return Promise.resolve(Response.json({ items, next_cursor: null }));
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <IssuePicker />
    </QueryClientProvider>,
  );
  return requested;
}

describe("IssuePicker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the request list for the accepted requests and links each to its draft", async () => {
    const requested = mount([accepted]);
    const link = await screen.findByRole("link", { name: "Issue invoice" });
    expect({ requested, href: link.getAttribute("href") }).toEqual({
      requested: ["/api/admin/submissions?workflow_state=Accepted"],
      href: `/admin/invoices/new?submission_id=${ID}`,
    });
  });

  it("says so when no accepted request is waiting", async () => {
    mount([]);
    expect(
      await screen.findByRole("heading", { name: "No request is waiting for an invoice" }),
    ).toBeTruthy();
  });
});
