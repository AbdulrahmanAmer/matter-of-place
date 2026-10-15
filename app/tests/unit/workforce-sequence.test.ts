import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { submissionStates } from "../../src/domain/contracts";
import { requestSequence, SEQUENCE_FILE, sequenceSection } from "../../scripts/workforce/grounding";
import { fakeDb } from "../fixtures/fake-db";
import { withTables } from "../fixtures/table-stub";

// W9 item 5: the review sequence is written for every state of a submission, and a run about a request is handed the
// section for the state the request is in.

const REQUEST = "4a3c2563-c07a-481d-839b-ad0523827f69";
const sequence = readFileSync(SEQUENCE_FILE, "utf8");

describe("the review sequence", () => {
  it("names, for every state of a submission, what starts it, its owner and what moves it on", () => {
    const missing = submissionStates.filter((state) => {
      const section = sequenceSection(sequence, state) ?? "";
      return !(section.includes("**Starts it**") && section.includes("**Moves on**"));
    });
    expect(missing).toEqual([]);
  });

  it("cuts one state's section at the next heading", () => {
    const markdown = "# Title\n\n## Submitted\n\n- one\n\n## Under Review\n\n- two\n";
    expect(sequenceSection(markdown, "Submitted")).toBe(
      'The review sequence for a request in "Submitted" (workspace/05-plans/W9-review-sequence.md); follow it:\n- one',
    );
    expect(sequenceSection(markdown, "Published")).toBeNull();
  });
});

describe("a run about a request", () => {
  it("is handed the section for the state the request is in, and a run about anything else none", async () => {
    const db = withTables(fakeDb(), {
      submissions: [{ id: REQUEST, workflow_state: "Submitted" }],
    });
    const handed = await requestSequence(db, { entity: "submission", entity_id: REQUEST });
    expect(handed?.split("\n")[0]).toBe(
      'The review sequence for a request in "Submitted" (workspace/05-plans/W9-review-sequence.md); follow it:',
    );
    expect(handed).toContain("**Owner**: the Editor, woken by `submission.received`.");
    expect(await requestSequence(db, { entity: "inquiry", entity_id: REQUEST })).toBeNull();
  });
});
