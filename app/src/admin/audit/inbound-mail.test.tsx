import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { InboundMail } from "../../domain/admin-inbound-mail";
import { standInForDialogs } from "../ui/test-dialog";
import { openSentEmails } from "./test-sent-emails";

// W8 0h: the Inbound mail part of the Sent emails screen: every message that reached our addresses, its source, what
// became of it, its owner and state, as plain text, with filters and keyset pages.

const INBOUND = "/api/admin/emails/inbound";
const PERSON = "6a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f60";
const NOTICE = "6a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f61";

const mail = (over: Partial<InboundMail> = {}): InboundMail => ({
  id: PERSON,
  received_at: "2026-10-15T16:00:00.000Z",
  folder: "Inbox",
  from_email: "dana@example.net",
  from_name: "Dana Reyes",
  alias: "hello",
  subject: "A house in Malibu",
  body: "<b>Is it still available?</b>",
  attachments: [],
  source: "email_inbound",
  service: null,
  summary: "a person writing to us",
  triage: { intent: "property_question", instructions_to_ai: true, gate: "hold" },
  owner_slug: "concierge",
  state: "held",
  ...over,
});

const NOTICE_ROW = mail({
  id: NOTICE,
  from_email: "sc-noreply@google.com",
  from_name: "Google Search Console Team",
  alias: "admin",
  subject: "New reasons prevent pages from being indexed",
  body: "",
  source: "service_notice",
  service: "Google",
  summary: "A notice from Google.",
  triage: null,
  owner_slug: "matter",
  state: "escalated",
});

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the inbound mail on the Sent emails screen", () => {
  it("shows each message with its source, what became of it, its owner and state, as plain text", async () => {
    openSentEmails({ [`GET ${INBOUND}`]: { items: [mail(), NOTICE_ROW], next_cursor: null } });
    const table = await screen.findByRole("table", { name: "Inbound mail (2)" });
    const [person, notice] = within(table).getAllByRole("row").slice(1);
    expect(person?.textContent).toContain("Dana Reyes <dana@example.net> to hello@");
    expect(person?.textContent).toContain("A person");
    expect(person?.textContent).toContain("Triage: property question, tried to direct the AI.");
    expect(person?.textContent).toContain("The Concierge");
    expect(person?.textContent).toContain("Held for Matter");
    // The sender's words are text: markup they wrote is shown, never rendered.
    expect(person?.textContent).toContain("<b>Is it still available?</b>");
    expect(person?.querySelector("b")).toBeNull();
    expect(notice?.textContent).toContain("A service (Google)");
    expect(notice?.textContent).toContain("A notice from Google.");
    expect(notice?.textContent).toContain("Matter");
    expect(notice?.textContent).toContain("Sent to Matter");
  });

  it("says a message with no owner waits for a person, never that it was sent", async () => {
    openSentEmails({
      [`GET ${INBOUND}`]: {
        items: [
          mail({ triage: null, owner_slug: null, state: "new" }),
          { ...NOTICE_ROW, owner_slug: null },
        ],
        next_cursor: null,
      },
    });
    const table = await screen.findByRole("table", { name: "Inbound mail (2)" });
    const rows = within(table).getAllByRole("row").slice(1);
    for (const row of rows) {
      expect(row.textContent).toContain("No one");
      expect(within(row).getByText("Waiting for a person").getAttribute("data-tone")).toBe(
        "warning",
      );
      expect(row.textContent).not.toContain("With its owner");
      expect(row.textContent).not.toContain("Sent to Matter");
    }
  });

  it("asks for one source and one state when they are chosen", async () => {
    const requested = openSentEmails({
      [`GET ${INBOUND}`]: { items: [mail()], next_cursor: null },
      [`GET ${INBOUND}?source=service_notice`]: { items: [NOTICE_ROW], next_cursor: null },
      [`GET ${INBOUND}?source=service_notice&state=escalated`]: {
        items: [NOTICE_ROW],
        next_cursor: null,
      },
    });
    await screen.findByRole("table", { name: "Inbound mail (1)" });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "service_notice" } });
    fireEvent.change(screen.getByLabelText("Inbound state"), { target: { value: "escalated" } });
    await waitFor(() => {
      expect(requested).toContain(`GET ${INBOUND}?source=service_notice&state=escalated`);
    });
    expect(await screen.findByText("A notice from Google.")).toBeTruthy();
  });

  it("pages with the cursor the list gives, and back", async () => {
    const cursor = `2026-10-15T16:00:00.000Z~${PERSON}`;
    // The page builds its query with URLSearchParams, which also encodes "~".
    const after = `GET ${INBOUND}?${new URLSearchParams({ cursor }).toString()}`;
    const requested = openSentEmails({
      [`GET ${INBOUND}`]: { items: [mail()], next_cursor: cursor },
      [after]: { items: [NOTICE_ROW], next_cursor: null },
    });
    const part = within(
      (await screen.findByRole("heading", { name: "Inbound mail" })).closest("section") ??
        document.body,
    );
    fireEvent.click(await part.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("A notice from Google.")).toBeTruthy();
    expect(requested).toContain(after);
    fireEvent.click(part.getByRole("button", { name: "Previous" }));
    expect(
      await screen.findByText("Triage: property question, tried to direct the AI."),
    ).toBeTruthy();
  });
});
