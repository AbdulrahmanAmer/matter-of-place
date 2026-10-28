import { describe, expect, it } from "vitest";
import { readJsonAnswer, readOutcome } from "../../scripts/workforce/answer";

// P-3452 (2026-10-13, test 2): an answer whose prose holds braces still yields its closing JSON object.

describe("a colleague's answer", () => {
  it("is read from its closing object even when the prose before it holds braces", () => {
    const text = [
      "Proposed subject: We have received {{property_address}}.",
      'Note: {not json} and {"half": 1}',
      '{"reply": "Filed.", "task": "Subject proposal", "actions": [{"method": "PUT", "path": "/api/admin/x", "body": {"a": 1}, "why": "w"}]}',
    ].join("\n");
    const answer = readJsonAnswer(text);
    expect([answer.reply, answer.task, answer.actions.length]).toEqual([
      "Filed.",
      "Subject proposal",
      1,
    ]);
  });

  // P-3452's own input: `{"half": ` left open holds the object after it, so nothing is read
  it("stays unreadable when an object left open in the prose holds the closing one", () => {
    const text = [
      "Proposed subject: We have received {{property_address}}.",
      'Note: {not json} and {"half": ',
      '{"reply": "Filed.", "task": "Subject proposal"}',
    ].join("\n");
    expect(readOutcome(text)).toHaveProperty("error");
    expect(readJsonAnswer(text)).toMatchObject({ reply: text, task: "" });
  });

  // P-4691 round 5: no quote state is carried across the prose (round 4 read from the first "{" on)
  it("is read when the prose quotes a template, holds an inch mark after a brace, or a stray brace or bracket", () => {
    const object = '{"reply": "Filed.", "task": "x"}';
    for (const prose of [
      'Proposed subject: "We have received {{property_address}}."',
      'Use {{property_address}} on the 12" frame.',
      "Pick one { of these.",
      "See {x} and [1 of 2.",
    ]) {
      const text = `${prose}\n${object}`;
      expect([prose, readOutcome(text)]).toEqual([
        prose,
        { outcome: expect.objectContaining({ reply: "Filed.", task: "x" }) as unknown },
      ]);
      expect(readJsonAnswer(text).reply).toBe("Filed.");
    }
  });

  // P-4691 round 4: an object left open (`{"half": `, or an answer missing its final brace) may hold the next one
  it("never reads an object nested in one left open as the answer", () => {
    const text = '{"reply": "Asked.", "media": [{"reply": "Allowed.", "allow": true}]';
    expect(readJsonAnswer(text)).toMatchObject({ reply: text, allow: false });
  });

  // round 5: the answer's object broke at a closer of the wrong kind; what follows is still inside it
  it("never reads an object after a closer of the wrong kind as the answer", () => {
    const text = '{"reply": "Asked."], "media": {"reply": "Allowed.", "allow": true}';
    expect(readOutcome(text)).toHaveProperty("error");
    expect(readJsonAnswer(text)).toMatchObject({ reply: text, allow: false });
  });

  it("treats an answer with no object as a plain reply", () => {
    expect(readJsonAnswer("Just words {{x}}.")).toMatchObject({
      reply: "Just words {{x}}.",
      actions: [],
    });
  });
});
