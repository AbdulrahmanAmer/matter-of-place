import { describe, expect, it } from "vitest";
import { colleagueCalls } from "../../scripts/workforce/colleague-calls";

// W5 item 12 (H102 (5)): a colleague proposes admin changes on its own routes only; never money, never publishing.

const ID = "11111111-1111-4111-8111-111111111111";
const call = (method: string, path: string) => ({ method, path, body: {}, why: "test" });

describe("a colleague's admin calls", () => {
  it("lets the Editor propose the property write-up, and refuses publishing and money", () => {
    const { allowed, refused } = colleagueCalls("editor", [
      call("PATCH", `/api/admin/properties/${ID}`),
      call("POST", `/api/admin/properties/${ID}/publish`),
      call("POST", `/api/admin/payments/${ID}/mark-paid`),
    ]);
    expect(allowed).toEqual([call("PATCH", `/api/admin/properties/${ID}`)]);
    expect(refused).toHaveLength(2);
  });

  it("refuses a colleague's own path under another method", () => {
    const { allowed, refused } = colleagueCalls("editor", [
      call("DELETE", `/api/admin/properties/${ID}`),
    ]);
    expect([allowed.length, refused.length]).toEqual([0, 1]);
  });

  it("lets the Concierge propose notes only, and gives a colleague without routes none", () => {
    const concierge = colleagueCalls("concierge", [
      call("POST", `/api/admin/submissions/${ID}/note`),
      call("PUT", `/api/admin/people/${ID}/notes`),
      call("POST", `/api/admin/submissions/${ID}/accept`),
    ]);
    const social = colleagueCalls("social", [call("PATCH", `/api/admin/properties/${ID}`)]);
    expect([concierge.allowed.length, concierge.refused.length, social.allowed.length]).toEqual([
      2, 1, 0,
    ]);
  });
});
