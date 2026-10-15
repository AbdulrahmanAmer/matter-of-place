// Tests for task-gate.mjs: a step passes only on its own check, a person step never blocks, the stop is refused while
// one of ours is open, and plan boxes marked PERSON are not ours.
import assert from "node:assert/strict";
import { evaluate, openItems, review, stopVerdict, waitActive } from "./task-gate.mjs";

const run = (results) => (cmd) => results[cmd] ?? { status: 1, tail: "unknown" };
const list = {
  goal: "Matter runs on his own",
  steps: [
    { id: "1", title: "prompt says he decides", check: { cmd: "a" } },
    { id: "2", title: "Meta app", person: true, check: { cmd: "b" } },
    { id: "3", title: "merged", check: { cmd: "c" } },
  ],
};

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("a step passes only when its check exits 0", () => {
  assert.equal(evaluate({ check: { cmd: "a" } }, ".", run({ a: { status: 0, tail: "" } })).pass, true);
  assert.equal(evaluate({ check: { cmd: "a" } }, ".", run({ a: { status: 1, tail: "no" } })).pass, false);
});

test("a step without a check never passes", () => {
  assert.equal(evaluate({ title: "trust me" }, ".").pass, false);
});

test("the first open step that is ours is the one named, a person step is skipped", () => {
  const { open } = review(list, ".", run({ a: { status: 0, tail: "" }, b: { status: 1, tail: "" } }));
  assert.equal(open?.step.id, "3");
});

test("the stop is blocked while one of ours fails, and allowed when only the person's remain", () => {
  const blocked = stopVerdict(list, ".", run({ a: { status: 1, tail: "missing" }, c: { status: 0, tail: "" } }));
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason ?? "", /Open step 1: prompt says he decides/);
  assert.equal(stopVerdict(list, ".", run({ a: { status: 0, tail: "" }, c: { status: 0, tail: "" } })), null);
});

test("open plan items skip ticked boxes and PERSON items", () => {
  const text = [
    "- [x] 1. **Sent email log.** done",
    "- [ ] 2. **Email replies inbox.** open",
    "- [ ] 14. **Campaigns wakes**. PERSON: the operator adds it",
    "  - [ ] an indented sub-box is not an item",
  ].join("\n");
  assert.deepEqual(openItems(text), ["2. Email replies inbox. open"]);
});

test("a declared wait allows the stop only while it names what reports back and has not expired", () => {
  const now = Date.parse("2026-10-15T02:00:00Z");
  assert.equal(waitActive(JSON.stringify({ on: "CI of PR 387", until: "2026-10-15T02:10:00Z" }), now), true);
  assert.equal(waitActive(JSON.stringify({ on: "CI of PR 387", until: "2026-10-15T01:59:00Z" }), now), false);
  assert.equal(waitActive(JSON.stringify({ on: "", until: "2026-10-15T02:10:00Z" }), now), false);
  assert.equal(waitActive("not json", now), false);
});
