// W1: the rules of the workforce that need no database: who a message wakes, how mentions read, what a hire accepts.
import { describe, expect, it } from "vitest";
import { hireInputSchema, mentionedSlugs, wakeTargets } from "../../src/domain/workforce";

const team = [
  { slug: "chief", state: "idle" },
  { slug: "editor", state: "working" },
  { slug: "social", state: "paused" },
  { slug: "newsletter", state: "off" },
];

describe("wakeTargets", () => {
  it("wakes the chief of staff for a team message that mentions nobody", () => {
    expect(wakeTargets("team", "What is waiting today?", team)).toEqual(["chief"]);
  });

  it("wakes each mentioned colleague once, in the order written, and nobody else", () => {
    expect(wakeTargets("team", "@editor look at this, @social too, thanks @editor", team)).toEqual([
      "editor",
      "social",
    ]);
  });

  it("never wakes a colleague who is off, and ignores a handle nobody has", () => {
    expect(wakeTargets("team", "@newsletter and @nobody", team)).toEqual(["chief"]);
    expect(wakeTargets("team", "@newsletter please", team)).toEqual(["chief"]);
  });

  it("wakes the colleague of a direct thread whatever the message mentions", () => {
    expect(wakeTargets("editor", "@social can you help", team)).toEqual(["editor"]);
    expect(wakeTargets("newsletter", "hello", team)).toEqual([]);
  });
});

describe("mentionedSlugs", () => {
  it("reads handles of lower-case letters, digits and dashes, not an email address's domain part", () => {
    expect(mentionedSlugs("@chief hire a @place-notes-editor")).toEqual([
      "chief",
      "place-notes-editor",
    ]);
    expect(mentionedSlugs("write to admin@matterofplace.com (or @editor)")).toEqual(["editor"]);
  });
});

describe("hireInputSchema", () => {
  it("accepts a colleague with a handle, a name and a role, and fills the defaults", () => {
    const hired = hireInputSchema.parse({
      slug: "concierge",
      name: "Concierge",
      role: "Answers inquiries",
    });
    expect(hired.model).toBe("sonnet");
    expect(hired.tools).toEqual(["read_business", "chat"]);
    expect(hired.wake_on).toEqual([]);
  });

  it("refuses a handle with capitals or spaces, an unknown event and an unknown tool", () => {
    expect(hireInputSchema.safeParse({ slug: "Bad Name", name: "x", role: "y" }).success).toBe(
      false,
    );
    expect(
      hireInputSchema.safeParse({ slug: "ok", name: "x", role: "y", wake_on: ["nope.event"] })
        .success,
    ).toBe(false);
    expect(
      hireInputSchema.safeParse({ slug: "ok", name: "x", role: "y", tools: ["send_anything"] })
        .success,
    ).toBe(false);
  });
});
