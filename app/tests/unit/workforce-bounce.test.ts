import { describe, expect, it } from "vitest";
import { bounceFacts, wakes } from "../../scripts/workforce/bounce";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// W9 item 3: a bounce wakes the colleague who owns the request or inquiry it is about, with the failed address and
// the phone. The colleagues as seeded on mop-dev, with `email.bounced` added to the Editor and the Concierge.

const REQUEST = "4a3c2563-c07a-481d-839b-ad0523827f69";
const editor = {
  wake_on: ["submission.activated", "submission.received", "email.bounced"],
  state: "idle",
};
const concierge = { wake_on: ["inquiry.received", "email.bounced"], state: "idle" };
const social = { wake_on: ["property.published"], state: "idle" };

describe("who a bounce wakes", () => {
  it("wakes the Editor for a request and the Concierge for an inquiry, and no one else", () => {
    const request = { type: "email.bounced", entity: "submission" };
    const inquiry = { type: "email.bounced", entity: "inquiry" };
    expect([wakes(editor, request), wakes(concierge, request), wakes(social, request)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([wakes(editor, inquiry), wakes(concierge, inquiry)]).toEqual([false, true]);
  });

  it("wakes on any other event by its type alone, and never a paused or off colleague", () => {
    expect(wakes(editor, { type: "submission.received", entity: "submission" })).toBe(true);
    expect(
      wakes({ ...editor, state: "paused" }, { type: "email.bounced", entity: "submission" }),
    ).toBe(false);
    expect(wakes({ ...editor, state: "off" }, { type: "submission.received", entity: null })).toBe(
      false,
    );
  });
});

describe("what the owner is told", () => {
  it("names the request, the failed address, the phone and the page, and asks for the next step", async () => {
    const db = withTables(fakeDb(), {
      submissions: [
        {
          id: REQUEST,
          submitter_name: "Dana Reyes",
          submitter_email: "dana@brokerage.example",
          submitter_phone: "+1 707 555 0100",
          address: "1 Vine Street",
          city: "Fairfield",
          state: "California",
          workflow_state: "Submitted",
        },
      ],
    });
    const facts = await bounceFacts(db, {
      entity: "submission",
      entity_id: REQUEST,
      payload: { template: "received", reason: "bounce" },
    });
    expect(facts?.split("\n")).toEqual([
      `The received email about request ${REQUEST} (1 Vine Street, Fairfield, California; Submitted) bounced.`,
      "The failed address: dana@brokerage.example. Dana Reyes's phone: +1 707 555 0100.",
      `The request page: https://matterofplace.com/admin/requests/${REQUEST}`,
      "Propose the next step in Approvals: a call to the person if there is a phone, or a way to ask for the right address. Matter decides; nothing more is sent to the failed address.",
    ]);
  });

  it("says when no phone was given, and that a complaint was marked as spam", async () => {
    const db = withTables(fakeDb(), {
      inquiries: [{ id: REQUEST, name: "Ann", email: "ann@example.com", phone: "" }],
    });
    const facts = await bounceFacts(db, {
      entity: "inquiry",
      entity_id: REQUEST,
      payload: { template: "inquiry_ack", reason: "complaint" },
    });
    expect(facts).toContain("was marked as spam.");
    expect(facts).toContain("Ann's phone: none given.");
  });
});
