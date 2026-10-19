import { describe, expect, it } from "vitest";
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import { answerPlan } from "../../scripts/workforce/daemon.ts";
import { runShape } from "../../scripts/workforce/triage.ts";

// W8 item 0f: "only runs started by a person or Matter write". A decision on a studio draft is a `media` entry, and the
// runner keeps media for Matter at full power alone.

const decision = { skill: "studio", piece: "2026-10-16-the-door", decision: "approve" };
const answer = readJsonAnswer(JSON.stringify({ reply: "Reviewed.", media: [decision] }));
const matter = { slug: "matter", tools: [] as string[] };
const social = { slug: "social", tools: ["draft_post", "request_reel"] };

const mediaOf = (
  agent: { slug: string; tools: string[] },
  power: "full" | "read",
  request = false,
) =>
  answerPlan({
    agent,
    answer,
    shape: runShape(agent, "matter", null, false),
    triage: null,
    power,
    cause: "message",
    request,
  }).media;

describe("who may decide a draft in the studio (W8 0f)", () => {
  it("keeps a studio decision for Matter at full power, and for no other run", () => {
    expect(mediaOf(matter, "full")).toEqual([decision]);
    // Matter's read run (woken by a system line, not by a person's) decides nothing
    expect(mediaOf(matter, "read")).toEqual([]);
    // a colleague, even one allowed to ask for a reel, cannot decide
    expect(mediaOf(social, "read")).toEqual([]);
    // and a run shown a request's words asks for no media at all, Matter's own included
    expect(mediaOf(matter, "full", true)).toEqual([]);
    expect(mediaOf(social, "read", true)).toEqual([]);
    // importing the runner's daemon cold took 10.2 s on this laptop (2026-10-19, transform 75%), past the 5 s default (P-3450)
  }, 30_000);
});
