import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminKeys } from "../query";
import { AdminApiError } from "../ui/admin-fetch";
import { missingSettings, useMarkPaid, usePayments } from "./payments-queries";

const ID = "00000000-0000-4000-8000-0000000000a1";
const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";

function setup() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${path}`);
    return Promise.resolve(
      Response.json(
        init.method === "POST"
          ? { payment_id: ID, event_id: "event-1", jobs: [] }
          : { items: [], next_cursor: null },
      ),
    );
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { calls, client, wrapper };
}

const paid = { paidAt: "2026-10-01T16:00:00.000Z", method: "Wire" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("payments-queries", () => {
  it("refetches the invoices list once the mark-paid mutation settles", async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(
      () => ({ list: usePayments({ status: "due" }), mark: useMarkPaid(ID, SUBMISSION) }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
    });
    await act(() => result.current.mark.mutateAsync(paid));
    await waitFor(() => {
      expect(calls.filter((call) => call.startsWith("GET /api/admin/payments"))).toHaveLength(2);
    });
    expect(calls[0]).toBe("GET /api/admin/payments?status=due");
  });

  it("also invalidates the dashboard and the request's timeline and detail", async () => {
    const { client, wrapper } = setup();
    const keys = [
      adminKeys.dashboard(),
      adminKeys.submissions.timeline(SUBMISSION),
      adminKeys.submissions.detail(SUBMISSION),
    ];
    for (const key of keys) client.setQueryData(key, {});
    const { result } = renderHook(() => useMarkPaid(ID, SUBMISSION), { wrapper });
    await act(() => result.current.mutateAsync(paid));
    await waitFor(() => {
      expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
        true,
        true,
        true,
      ]);
    });
  });

  it("reads the missing settings from a 409 invoice_not_ready and from nothing else", () => {
    const refused = new AdminApiError(
      409,
      "invoice_not_ready",
      "Invoice settings are missing: legal.entity, tax_line.",
    );
    expect({
      refused: missingSettings(refused),
      other: missingSettings(new AdminApiError(409, "wrong_state", "Not now.")),
      plain: missingSettings(new Error("offline")),
      none: missingSettings(null),
    }).toEqual({ refused: ["legal.entity", "tax_line"], other: [], plain: [], none: [] });
  });
});
