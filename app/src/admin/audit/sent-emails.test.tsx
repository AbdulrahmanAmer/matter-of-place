import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { SentEmail } from "../../domain/admin-emails";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { SentEmailsPage } from "./SentEmailsPage";

// W7 item 1: the Emails we sent part of the Sent emails screen: every email, to whom, its template and what became of
// it (delivered, opened, bounced), the do-not-send list, and keyset pages.

const EMAILS = "/api/admin/emails";
const ADDRESS = "agent@brokerage.example";
const BOUNCED = "7a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f60";
const OPENED = "7a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f61";

const email = (over: Partial<SentEmail> = {}): SentEmail => ({
  id: BOUNCED,
  template_key: "received",
  to_email: ADDRESS,
  status: "bounced",
  error: null,
  bounce_type: "Permanent",
  entity: "submission",
  entity_id: "4a3c2563-c07a-481d-839b-ad0523827f69",
  created_at: "2026-10-15T04:10:03.019Z",
  sent_at: "2026-10-15T04:10:03.202Z",
  delivered_at: null,
  opened_at: null,
  suppressed: true,
  ...over,
});

const OPENED_ROW = email({
  id: OPENED,
  template_key: "accepted",
  to_email: "owner@example.com",
  status: "delivered",
  bounce_type: null,
  delivered_at: "2026-10-15T03:00:02.000Z",
  opened_at: "2026-10-15T03:05:00.000Z",
  suppressed: false,
});

const SUPPRESSIONS = [
  { email: ADDRESS, reason: "bounce" as const, at: "2026-10-15T04:10:07.215Z" },
];

function open(answers: Record<string, unknown>) {
  const requested = serve({
    "GET /api/admin/emails/replies": { items: [], next_cursor: null },
    "GET /api/admin/emails/inbound": { items: [], next_cursor: null },
    ...answers,
  });
  mountRoutes(
    () => (
      <AdminProviders actions={["audit.list"]}>
        <Outlet />
      </AdminProviders>
    ),
    "/admin/emails/",
    (root) => [pageRoute(root, "/admin/emails/", () => <SentEmailsPage />)],
  );
  return requested;
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the emails we sent on the Sent emails screen", () => {
  it("shows each email with its address, template and what became of it, and the do-not-send list", async () => {
    open({
      [`GET ${EMAILS}`]: {
        items: [email(), OPENED_ROW],
        next_cursor: null,
        suppressions: SUPPRESSIONS,
      },
    });
    const table = await screen.findByRole("table", { name: "Emails we sent (2)" });
    const [bounced, opened] = within(table).getAllByRole("row").slice(1);
    expect(bounced?.textContent).toContain(`${ADDRESS} (do not send)`);
    expect(bounced?.textContent).toContain("received");
    expect(bounced?.textContent).toContain(
      "The confirmation bounced: this mailbox does not exist.",
    );
    expect(bounced?.textContent).toContain("Open the submission");
    expect(opened?.textContent).toContain("accepted");
    expect(opened?.textContent).toContain("The acceptance was delivered and opened.");
    const list = await screen.findByRole("table", { name: "Do-not-send list (1)" });
    expect(list.textContent).toContain(`${ADDRESS}Bounced`);
  });

  it("asks for one state and one address when they are chosen", async () => {
    const requested = open({
      [`GET ${EMAILS}`]: { items: [email()], next_cursor: null, suppressions: [] },
      [`GET ${EMAILS}?status=delivered`]: {
        items: [OPENED_ROW],
        next_cursor: null,
        suppressions: [],
      },
    });
    await screen.findByRole("table", { name: "Emails we sent (1)" });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "delivered" } });
    await waitFor(() => {
      expect(requested).toContain(`GET ${EMAILS}?status=delivered`);
    });
    expect(await screen.findByText("The acceptance was delivered and opened.")).toBeTruthy();
  });

  it("pages with the cursor the list gives, and back", async () => {
    const cursor = `2026-10-15T04:10:03.019Z~${BOUNCED}`;
    // The page builds its query with URLSearchParams, which also encodes "~".
    const after = `GET ${EMAILS}?${new URLSearchParams({ cursor }).toString()}`;
    const requested = open({
      [`GET ${EMAILS}`]: { items: [email()], next_cursor: cursor, suppressions: [] },
      [after]: { items: [OPENED_ROW], next_cursor: null, suppressions: [] },
    });
    const part = within(
      (await screen.findByRole("heading", { name: "Emails we sent" })).closest("section") ??
        document.body,
    );
    fireEvent.click(await part.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("The acceptance was delivered and opened.")).toBeTruthy();
    expect(requested).toContain(after);
    fireEvent.click(part.getByRole("button", { name: "Previous" }));
    expect(
      await screen.findByText("The confirmation bounced: this mailbox does not exist."),
    ).toBeTruthy();
  });
});
