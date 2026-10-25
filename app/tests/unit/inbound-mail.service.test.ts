import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { listInboundMail } from "../../src/server/email/inbound/service";
import type { AdminActor } from "../../src/server/lib/admin-route";
import { AppError } from "../../src/server/lib/errors";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// W8 0h: the inbound mail list of the Sent emails screen: newest first, one source and one state, keyset pages, and the
// screen's own right.

const PERSON = "6a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f60";
const NOTICE = "6a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f61";
const SPAM = "6a1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f62";

const actor = (roles: AdminActor["roles"]): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind: "human",
  roles,
  scopes: [],
  requestId: "req-inbound",
});

const reader = actor(["chief_editor"]);

const row = (over: Record<string, unknown> = {}) => ({
  id: PERSON,
  provider_id: "zoho-1",
  folder: "Inbox",
  from_email: "dana@example.net",
  from_name: "Dana Reyes",
  alias: "hello",
  subject: "A house in Malibu",
  body: "Is it still available?",
  attachments: [],
  received_at: "2026-10-15T16:00:00.000Z",
  source: "email_inbound",
  service: null,
  summary: "a person writing to us",
  report: null,
  triage: {
    intent: "property_question",
    instructions_to_ai: false,
    gate: "answer",
    who: "never shown",
  },
  owner_slug: "concierge",
  state: "routed",
  created_at: "2026-10-15T16:00:05.000Z",
  ...over,
});

const mailbox = () =>
  withTables(fakeDb(), {
    inbound_mail: [
      row(),
      row({
        id: NOTICE,
        received_at: "2026-10-15T17:00:00.000Z",
        source: "service_notice",
        service: "Google",
        triage: null,
        owner_slug: "matter",
        state: "escalated",
      }),
      row({
        id: SPAM,
        received_at: "2026-10-14T08:00:00.000Z",
        triage: "not a triage",
        state: "spam",
      }),
    ],
  });

describe("the inbound mail list", () => {
  it("lists the newest first with each message's source, owner, state and the triage's labels only", async () => {
    const { items } = await listInboundMail(reader, mailbox(), { limit: 50 });
    expect(items.map((item) => item.id)).toEqual([NOTICE, PERSON, SPAM]);
    expect(items[1]).toMatchObject({
      source: "email_inbound",
      owner_slug: "concierge",
      state: "routed",
      triage: { intent: "property_question", instructions_to_ai: false, gate: "answer" },
    });
    expect(items[1]?.triage).not.toHaveProperty("who");
    // A triage the screen cannot read never fails the page.
    expect(items[2]?.triage).toBeNull();
  });

  it("keeps only the source and the state asked for", async () => {
    const notices = await listInboundMail(reader, mailbox(), {
      limit: 50,
      source: "service_notice",
    });
    expect(notices.items.map((item) => item.id)).toEqual([NOTICE]);
    const spam = await listInboundMail(reader, mailbox(), { limit: 50, state: "spam" });
    expect(spam.items.map((item) => item.id)).toEqual([SPAM]);
  });

  it("pages the newest first and goes on after the cursor, with no cursor on the last page", async () => {
    const first = await listInboundMail(reader, mailbox(), { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([NOTICE, PERSON]);
    expect(first.next_cursor).toBe(`2026-10-15T16:00:00.000Z~${PERSON}`);
    const last = await listInboundMail(reader, mailbox(), {
      limit: 2,
      cursor: first.next_cursor ?? "",
    });
    expect(last.items.map((item) => item.id)).toEqual([SPAM]);
    expect(last.next_cursor).toBeNull();
  });

  it("refuses a cursor it did not give and a caller without the screen's right", async () => {
    await expect(
      listInboundMail(reader, mailbox(), { limit: 2, cursor: "nonsense" }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(listInboundMail(actor([]), mailbox(), { limit: 2 })).rejects.toMatchObject({
      status: 403,
    });
  });
});
