import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { staffCharter } from "../../scripts/workforce/charter";
import { knowledgeBlock, remember, subjectFile } from "../../scripts/workforce/knowledge";
import { projectName, scriptText } from "../../scripts/workforce/media";
import { cairoDate, keptDecisions, lastJson } from "../../scripts/workforce/meeting";
import { asIsPercent, scorecardText } from "../../scripts/workforce/scorecard";

// W2 steps 5 and 7: the core brain. The knowledge base every run reads, the scorecard the meeting opens with, the staff
// charter that waits for the operator's yes, the meeting's decision rules, and the voice-over script.

describe("the knowledge base", () => {
  it("keeps dated entries per subject and shows the most relevant subjects to a run", () => {
    const dir = mkdtempSync(join(tmpdir(), "mop-knowledge-"));
    const day = new Date("2026-10-12T15:00:00Z");
    expect(
      remember(
        [
          { subject: "Competitors", text: "Mansion Global added a Malibu section this week." },
          { subject: "Posts", text: "Carousel posts with the garden first got twice the saves." },
          { subject: "Posts", text: "too short" },
        ],
        dir,
        day,
      ),
    ).toBe(2);
    expect(readFileSync(join(dir, subjectFile("Posts")), "utf8")).toBe(
      "# Posts\n- 2026-10-12 Carousel posts with the garden first got twice the saves.\n",
    );
    const block = knowledgeBlock("Draft a carousel post for the garden of the Pasadena home", dir);
    expect([
      block.includes("Subjects: "),
      block.includes("twice the saves"),
      block.includes("Malibu"),
    ]).toEqual([true, true, false]);
  });
});

describe("the scorecard", () => {
  it("says each number against last week, and not measured when it is missing", () => {
    expect(
      scorecardText([
        { name: "Visits (page views)", now: 151, before: 40 },
        { name: "Revenue paid", now: 0, before: 1500, unit: "usd" },
        { name: "Team drafts approved as is", now: null, before: 50, unit: "percent" },
      ]),
    ).toBe(
      "Visits (page views): 151 (last week 40, up 111)\nRevenue paid: $0 (last week $1,500, down $1,500)\nTeam drafts approved as is: not measured",
    );
    expect([
      asIsPercent([
        { state: "approved", edited_content: null },
        { state: "approved", edited_content: { body: "x" } },
        { state: "rejected", edited_content: null },
        { state: "pending", edited_content: null },
      ]),
      asIsPercent([]),
    ]).toEqual([100 / 3, null]);
  });
});

describe("the staff charter", () => {
  const plan = (approved: string) =>
    `## The operator's words\n- "x"\n\n## The staff charter (distilled)\nApproved by the operator: ${approved}\nEvery employee's prompt opens...\n1. We are Matter of Place.\n   A second line.\n2. We grow.\n\n## Goal\n`;
  it("opens an employee's prompt only once the operator has approved it", () => {
    expect(staffCharter(plan("not yet"))).toBe("");
    expect(staffCharter(plan("yes"))).toBe(
      "Our charter (the operator's words, distilled):\n1. We are Matter of Place.\n   A second line.\n2. We grow.",
    );
  });
});

describe("the meeting", () => {
  it("keeps at most five decisions, each owned by a colleague and due today or later", () => {
    const item = (owner: string, due_on: string) => ({ owner, due_on, decision: "x", metric: "y" });
    const kept = keptDecisions(
      [
        item("social", "2026-10-13"),
        item("nobody", "2026-10-13"),
        item("analyst", "2026-10-11"),
        ...Array.from({ length: 6 }, () => item("editor", "2026-10-12")),
      ],
      ["social", "analyst", "editor"],
      "2026-10-12",
    );
    expect([
      kept.length,
      kept[0]?.owner,
      kept.some((row) => row.owner === "nobody"),
      kept.some((row) => row.owner === "analyst"),
    ]).toEqual([5, "social", false, false]);
  });

  it("reads the JSON at the end of an answer and falls back to the defaults", () => {
    const schema = z.object({ digest: z.string().default("") });
    expect([
      lastJson('Thinking...\n{"digest": "Ten lines."}', schema),
      lastJson("no json here", schema),
    ]).toEqual([{ digest: "Ten lines." }, { digest: "" }]);
  });

  it("dates the meeting in Cairo, so 23:30 UTC is already tomorrow there", () => {
    expect(cairoDate(new Date("2026-10-12T23:30:00Z"))).toBe("2026-10-13");
  });
});

describe("the voice-over", () => {
  it("names the project by date and writes one spoken line per row", () => {
    expect(projectName("Brand film, 20 seconds!", new Date("2026-10-12T10:00:00Z"))).toBe(
      "2026-10-12-brand-film-20-seconds",
    );
    expect(scriptText(["  Matter of Place. ", "", "Exceptional   homes."])).toBe(
      "Matter of Place.\nExceptional homes.\n",
    );
  });
});
