import { describe, expect, it } from "vitest";
import {
  MAX_CALLS,
  adminRoutes,
  callProposal,
  checkCall,
  makeCall,
} from "../../scripts/matter/actions";

// Gap audit item 31 (ruling H99): Matter changes the admin with its own key, each call checked against the admin's own
// routes and its key's permissions, and made only after a person approves it.

const routes = adminRoutes();
const STORY = "/api/admin/stories/0b2f3c1e-0000-4000-8000-000000000001";
const ASSET = "3f2a9c1d-0000-4000-8000-0000000000c1";
const story = {
  method: "PATCH",
  path: STORY,
  body: { title: "The long view" },
  why: "Fix the title.",
};

describe("Matter's admin calls", () => {
  it("reads every write route of the admin with its permission, $ids as one path segment", () => {
    const flow = routes.find((route) => route.path === "/api/admin/automation/recipes/$trigger");
    expect({
      flow: [
        flow?.method,
        flow?.action,
        flow?.pattern.test("/api/admin/automation/recipes/property.published"),
      ],
      noReads: routes.every((route) => route.method !== "GET"),
      many: routes.length > 40,
    }).toEqual({
      flow: ["PUT", "automation.recipes_put", true],
      noReads: true,
      many: true,
    });
  });

  it("accepts a call to a real route the key may make, and refuses the rest with a reason", () => {
    const allowed = ["stories.write"];
    const check = (raw: unknown) => {
      const result = checkCall(raw, routes, allowed);
      return result.ok ? result.route.action : result.reason;
    };
    expect([
      check(story),
      check({ ...story, method: "GET" }),
      check({ ...story, path: "/api/admin/nowhere" }),
      check({ ...story, method: "DELETE" }),
      check({ method: "PUT", path: "/api/admin/automation/recipes/x", body: {}, why: "x" }),
      check({ ...story, path: "https://evil.example/api/admin/stories/1" }),
    ]).toEqual([
      "stories.write",
      "not a call the runner can read",
      "no admin route answers PATCH /api/admin/nowhere",
      `no admin route answers DELETE ${STORY}`,
      "Matter's key may not do automation.recipes_put",
      "not a call the runner can read",
    ]);
    expect(MAX_CALLS).toBe(10);
  });

  it("turns Matter's assets.reject and assets.re_render into the asset's own routes (W8 item 9)", () => {
    const allowed = ["assets.reject", "assets.re_render"];
    const made = (raw: unknown) => {
      const result = checkCall(raw, routes, allowed);
      if (!result.ok) throw new Error(result.reason);
      return [result.route.action, result.call.method, result.call.path, result.call.body];
    };
    expect([
      made({ action: "assets.reject", id: ASSET, note: "The stair is cut off at the top." }),
      made({ action: "assets.re_render", id: ASSET }),
    ]).toEqual([
      [
        "assets.reject",
        "POST",
        `/api/admin/assets/${ASSET}/reject`,
        { note: "The stair is cut off at the top." },
      ],
      ["assets.re_render", "POST", `/api/admin/assets/${ASSET}/rerender`, {}],
    ]);
  });

  it("refuses an approve, an unknown action, a bad id, an empty note and a key without the permission, with the reason (W8 item 9)", () => {
    const reason = (raw: unknown, allowed = ["assets.reject", "assets.re_render"]) => {
      const result = checkCall(raw, routes, allowed);
      return result.ok ? "made" : result.reason;
    };
    expect([
      reason({ action: "assets.approve", id: ASSET }),
      reason({ action: "assets.delete", id: ASSET }),
      reason({ action: "assets.reject", id: "the-stair-reel", note: "Too dark." }),
      reason({ action: "assets.re_render", id: `${ASSET}/../../workforce/messages` }),
      reason({ action: "assets.reject", id: ASSET, note: "   " }),
      reason({ action: "assets.reject", id: ASSET, note: "Too dark." }, ["assets.re_render"]),
    ]).toEqual([
      "assets.approve stays a person's (manual_approval)",
      "assets.delete is not an action the runner knows",
      "assets.reject needs the id of an asset",
      "assets.re_render needs the id of an asset",
      "assets.reject needs a note for the record",
      "Matter's key may not do assets.reject",
    ]);
  });

  it("puts the call in words for Approvals, with the call itself for the runner", () => {
    const result = checkCall(story, routes, ["stories.write"]);
    if (!result.ok) throw new Error(result.reason);
    const proposal = callProposal(result);
    expect({
      action: proposal.action,
      summary: proposal.summary,
      first: proposal.content.body.split("\n")[0],
      call: proposal.content.call.path,
    }).toEqual({
      action: "admin_call",
      summary: "Fix the title. (stories.write)",
      first: "Fix the title.",
      call: STORY,
    });
  });

  it("makes an approved call with Matter's key and turns any answer into an outcome", async () => {
    const result = checkCall(story, routes, ["stories.write"]);
    if (!result.ok) throw new Error(result.reason);
    const seen: string[] = [];
    const answer = (status: number, body: string) => (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      seen.push(`${init.method ?? "GET"} ${url} ${headers.get("authorization") ?? ""}`);
      return Promise.resolve(new Response(body, { status }));
    };
    const done = await makeCall(result.call, "mopk_test", "https://site.test", answer(200, "{}"));
    const refused = await makeCall(
      result.call,
      "mopk_test",
      "https://site.test",
      answer(409, '{"error":{"code":"stale","message":"This changed since you opened it."}}'),
    );
    const down = await makeCall(result.call, "mopk_test", "https://site.test", () =>
      Promise.reject(new Error("offline")),
    );
    expect({ done, refused, down, seen: seen[0] }).toEqual({
      done: { status: 200, ok: true, message: "" },
      refused: { status: 409, ok: false, message: "This changed since you opened it." },
      down: { status: 0, ok: false, message: "offline" },
      seen: `PATCH https://site.test${STORY} Bearer mopk_test`,
    });
  });
});
