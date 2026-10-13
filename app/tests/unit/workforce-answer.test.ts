import { describe, expect, it } from "vitest";
import { readJsonAnswer } from "../../scripts/workforce/answer";

// P-3452 (2026-10-13, test 2): an answer whose prose holds braces still yields its closing JSON object.

describe("a colleague's answer", () => {
  it("is read from its closing object even when the prose before it holds braces", () => {
    const text = [
      "Proposed subject: We have received {{property_address}}.",
      'Note: {not json} and {"half": ',
      '{"reply": "Filed.", "task": "Subject proposal", "actions": [{"method": "PUT", "path": "/api/admin/x", "body": {"a": 1}, "why": "w"}]}',
    ].join("\n");
    const answer = readJsonAnswer(text);
    expect([answer.reply, answer.task, answer.actions.length]).toEqual([
      "Filed.",
      "Subject proposal",
      1,
    ]);
  });

  it("treats an answer with no object as a plain reply", () => {
    expect(readJsonAnswer("Just words {{x}}.")).toMatchObject({
      reply: "Just words {{x}}.",
      actions: [],
    });
  });
});
