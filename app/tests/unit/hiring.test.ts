import { describe, expect, it } from "vitest";
import { hireInputSchema } from "../../src/domain/workforce";
import {
  MATTER_DAILY_HIRES,
  TEAM_CEILING,
  hireProposal,
  hireRoute,
} from "../../scripts/workforce/hiring";

// Gap audit item 5 (ruling H97): who may add a colleague directly, and what waits for a person.

const hire = (extra: Record<string, unknown> = {}) =>
  hireInputSchema.parse({
    slug: "scout",
    name: "Scout",
    role: "Finds listings",
    tools: ["read_business", "chat", "hire"],
    ...extra,
  });
const quiet = { hiredToday: 0, team: 6 };

describe("hiring", () => {
  it("lets Matter hire directly within the limits, and never hands on the hire tool", () => {
    const route = hireRoute("matter", hire(), quiet);
    expect([route.kind, route.hire.tools]).toEqual(["direct", ["read_business", "chat"]]);
  });

  it("sends every other hire to Approvals: another hirer, Opus, past the daily cap, a full team", () => {
    expect([
      hireRoute("chief", hire(), quiet).kind,
      hireRoute("matter", hire({ model: "opus" }), quiet).kind,
      hireRoute("matter", hire(), { hiredToday: MATTER_DAILY_HIRES, team: 6 }).kind,
      hireRoute("matter", hire(), { hiredToday: 0, team: TEAM_CEILING }).kind,
    ]).toEqual(["approval", "approval", "approval", "approval"]);
  });

  it("writes the proposal a person reads, with the hire the database applies", () => {
    const route = hireRoute("chief", hire({ instructions: "Read the new listings daily." }), quiet);
    if (route.kind !== "approval") throw new Error("expected an approval");
    const proposal = hireProposal(route);
    expect({
      action: proposal.action,
      summary: proposal.summary,
      tools: proposal.content.hire.tools,
      body: proposal.content.body.split("\n")[0],
    }).toEqual({
      action: "hire",
      summary: "Hire Scout as Finds listings (proposed by @chief)",
      tools: ["read_business", "chat"],
      body: "Scout, Finds listings.",
    });
  });
});
