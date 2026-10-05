import { describe, expect, it } from "vitest";
import { auditContext } from "../../src/server/lib/audit";

describe("auditContext", () => {
  it("hands write functions the actor's user id, its kind and the request id", () => {
    const actor = {
      userId: "00000000-0000-4000-8000-000000000007",
      kind: "agent" as const,
      roles: ["managing_editor" as const],
      scopes: ["submissions"],
      requestId: "req-abcdef12",
    };
    expect(auditContext(actor)).toEqual({
      p_actor: "00000000-0000-4000-8000-000000000007",
      p_actor_kind: "agent",
      p_request_id: "req-abcdef12",
    });
  });
});
