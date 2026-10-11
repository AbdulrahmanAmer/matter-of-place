// node .claude/hooks/merge-guard.test.mjs
import assert from "node:assert/strict";
import { decide } from "./merge-guard.mjs";

assert.notEqual(decide("gh pr merge 282 --merge"), "", "a plain merge is refused");
assert.notEqual(decide("cd app && gh pr merge 282 --auto --merge >/dev/null"), "", "auto-merge is refused");
assert.notEqual(decide("gh  pr   merge 1"), "", "extra spaces are still a merge");
assert.equal(decide("gh pr view 282 --json mergeable"), "", "reading a pull request is allowed");
assert.equal(decide("node workspace/05-plans/merge-gate.mjs 282"), "", "the gate script is allowed");
assert.equal(decide("git merge --no-edit origin/main"), "", "a git merge into a branch is allowed");
console.log("merge-guard: 6 ok");
