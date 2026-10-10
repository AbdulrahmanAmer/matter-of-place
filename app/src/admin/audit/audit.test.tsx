import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { AuditRow } from "../../domain/admin-audit";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { AuditPage } from "./AuditPage";

// Screen 25 (B7 step 15): the audit log newest first, its filters in the address, and a row's before and after.

const LIST = "/api/admin/audit";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";

const row = (id: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id,
  at: "2026-10-09T14:00:00.123456+00:00",
  actor_id: ADMIN,
  actor_kind: "human",
  action: "settings.notifications_put",
  entity: "settings.notifications",
  entity_id: null,
  before: { recipients: ["a@example.invalid"] },
  after: { recipients: ["b@example.invalid"] },
  request_id: "req-1",
  note: null,
  ...over,
});

function open(at: string, answers: Record<string, unknown>) {
  const requested = serve(answers);
  mountRoutes(
    () => (
      <AdminProviders actions={["audit.list"]}>
        <Outlet />
      </AdminProviders>
    ),
    at,
    (root) => [pageRoute(root, "/admin/audit/", () => <AuditPage />)],
  );
  return requested;
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("screen 25", () => {
  it("opens a row's before and after, and shows only the fields that changed", async () => {
    open("/admin/audit/", {
      [`GET ${LIST}`]: {
        items: [
          row(2, {
            action: "properties.update",
            entity: "property",
            before: { price: 100, title: "Same" },
            after: { price: 120, title: "Same" },
          }),
        ],
        next_cursor: null,
      },
    });
    fireEvent.click(await screen.findByText("properties.update"));
    const drawer = await screen.findByRole("dialog", { name: "properties.update" });
    const diff = within(drawer).getByRole("table");
    expect(
      within(diff)
        .getAllByRole("row")
        .map((line) => line.textContent),
    ).toEqual(["FieldBeforeAfter", "price100120"]);
  });

  it("shows a stored value that is not an object, such as the coming-soon switch, as one field", async () => {
    open("/admin/audit/", {
      [`GET ${LIST}`]: {
        items: [
          row(3, {
            action: "settings.coming_soon_put",
            entity: "settings.coming_soon_global",
            before: false,
            after: true,
          }),
        ],
        next_cursor: null,
      },
    });
    fireEvent.click(await screen.findByText("settings.coming_soon_put"));
    const drawer = await screen.findByRole("dialog", { name: "settings.coming_soon_put" });
    expect(
      within(within(drawer).getByRole("table"))
        .getAllByRole("row")
        .map((line) => line.textContent),
    ).toEqual(["FieldBeforeAfter", "valuefalsetrue"]);
  });

  it("asks the API for one request's rows when the request id filter is applied, and pages on with the cursor", async () => {
    const requested = open("/admin/audit/", {
      [`GET ${LIST}`]: {
        items: [row(5), row(4)],
        next_cursor: "2026-10-09T14:00:00.123456+00:00~4",
      },
      [`GET ${LIST}?request_id=req-9`]: {
        items: [row(9, { request_id: "req-9" })],
        next_cursor: null,
      },
      [`GET ${LIST}?cursor=2026-10-09T14%3A00%3A00.123456%2B00%3A00%7E4`]: {
        items: [row(1)],
        next_cursor: null,
      },
    });
    await screen.findAllByText("req-1");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => {
      expect(requested.at(-1)).toBe(
        `GET ${LIST}?cursor=2026-10-09T14%3A00%3A00.123456%2B00%3A00%7E4`,
      );
    });
    fireEvent.change(screen.getByLabelText("Request id"), { target: { value: "req-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("req-9");
    expect(requested).toEqual([
      `GET ${LIST}`,
      `GET ${LIST}?cursor=2026-10-09T14%3A00%3A00.123456%2B00%3A00%7E4`,
      `GET ${LIST}?request_id=req-9`,
    ]);
  });
});
