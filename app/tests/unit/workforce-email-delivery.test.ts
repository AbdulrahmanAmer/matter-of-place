import { beforeEach, describe, expect, it } from "vitest";
import { context } from "../../scripts/workforce/daemon.ts";
import {
  deliveryBlock,
  emailDeliveryLines,
  type DeliveryRow,
} from "../../scripts/workforce/email-delivery.ts";
import { forgetNewWork } from "../../scripts/workforce/new-work.ts";
import type { Db } from "../../src/server/lib/db.ts";
import { fakeDb } from "../fixtures/fake-db.ts";

// W7 item 12 (the item's own text): whether the Concierge's replies were delivered, opened or bounced, from item 1's
// data. The database picks the emails about inquiries and decides "opened" (`concierge_email_delivery`,
// tests/db/concierge-email-delivery.db.test.ts); this file tests who is shown the block, the call, and the block.

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";

const rows = (): DeliveryRow[] => [
  {
    inquiry_id: A,
    template_key: "inquiry_ack",
    status: "delivered",
    sent_at: "2026-10-27T09:00:00Z",
    opened: true,
  },
  {
    inquiry_id: B,
    template_key: "inquiry_ack",
    status: "bounced",
    sent_at: "2026-10-26T09:00:00Z",
    opened: false,
  },
  {
    inquiry_id: C,
    template_key: "standalone",
    status: "sent",
    sent_at: "2026-10-25T09:00:00Z",
    opened: false,
  },
];

// Approving a reply sends nothing yet (workforce_decide), so the header says these are the site's own emails.
const HEADER =
  "Email delivery (the 10 newest emails about inquiries, newest first; \"opened\" only when the reader's mail reported it). Approving a reply does not send an email yet; these are the site's own emails to the people of inquiries:";

const BLOCK = [
  HEADER,
  `- 2026-10-27, inquiry ${A}, the acknowledgement: delivered, opened`,
  `- 2026-10-26, inquiry ${B}, the acknowledgement: bounced`,
  `- 2026-10-25, inquiry ${C}, standalone: sent, no delivery report yet`,
].join("\n");

const FAILED =
  "The email delivery could not be read for this run; say so if a reply depends on it.";

const world = (answer: () => DeliveryRow[] | Error = rows) =>
  fakeDb({
    rpc: { concierge_email_delivery: answer },
    tables: {
      agent_messages: [],
      agent_approvals: [],
      agent_decisions: [],
      submissions: [],
      inquiries: [],
      properties: [],
    },
  });

const run = {
  id: "r0000000-0000-4000-8000-000000000712",
  agent_id: "id-colleague",
  cause: "message",
  event_id: null,
  message_id: null,
};
const noTriage = () => Promise.reject(new Error("no triage for an inside run"));

// Owning no source keeps the run off the request desk and the new-work read (P-4672); the block follows the slug.
async function situationOf(slug: string) {
  const db = world();
  const { situation } = await context(db, run, slug, noTriage, false, () => false, false, slug);
  return { situation, read: db.calls.some((call) => call.name === "concierge_email_delivery") };
}

describe("email delivery in the Concierge's briefing (W7 item 12)", () => {
  beforeEach(() => {
    forgetNewWork();
  });

  it("reaches the Concierge and no other colleague", async () => {
    const concierge = await situationOf("concierge");
    expect(concierge.situation).toContain(BLOCK);
    expect(concierge.read).toBe(true);
    for (const slug of ["matter", "chief", "editor", "analyst", "social", "campaigns"]) {
      const { situation, read } = await situationOf(slug);
      expect(situation).not.toContain("Email delivery");
      expect(read).toBe(false);
    }
  });

  it("says delivered, opened, bounced or sent for each email, by the inquiry it answers", async () => {
    expect(deliveryBlock(rows())).toBe(BLOCK);
    const db = world();
    expect(await emailDeliveryLines(db, "concierge")).toEqual([BLOCK]);
    expect(db.calls.map((call) => [call.name, call.args[0]])).toEqual([
      ["concierge_email_delivery", { p_limit: 10 }],
    ]);
  });

  it("names no address and no subject line", async () => {
    // a function that returned more than its columns: the block still shows only the inquiry, template and state
    const leaky = () =>
      rows().map((row) => ({ ...row, to_email: "sam@example.com", subject: "Dear Sam Rivera" }));
    const [block = ""] = await emailDeliveryLines(world(leaky), "concierge");
    expect(block).toBe(BLOCK);
    expect(block).not.toContain("@");
    expect(block).not.toContain("Rivera");
  });

  it("says none sent yet when no email went out", () => {
    expect(deliveryBlock([])).toBe(`${HEADER}\n- none sent yet`);
  });

  it("gives one plain line when the read fails, and the run goes on", async () => {
    expect(
      await emailDeliveryLines(
        world(() => new Error("email_messages is down")),
        "concierge",
      ),
    ).toEqual([FAILED]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client that cannot connect
    const broken = {
      rpc: () => {
        throw new Error("no connection");
      },
    } as unknown as Db;
    expect(await emailDeliveryLines(broken, "concierge")).toEqual([FAILED]);
    const { situation } = await context(
      world(() => new Error("down")),
      run,
      "concierge",
      noTriage,
      false,
      () => false,
      false,
      "concierge",
    );
    expect(situation).toContain(FAILED);
    expect(situation).toContain("What happened to your proposals");
  });
});
