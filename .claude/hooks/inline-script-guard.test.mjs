// node .claude/hooks/inline-script-guard.test.mjs
import assert from "node:assert/strict";
import { decide } from "./inline-script-guard.mjs";

assert.notEqual(decide(String.raw`node -e 'const re=new RegExp("a\\.b")'`), "", "node -e with a backslash is refused");
assert.notEqual(decide(String.raw`python3 -c "print('a\n')"`), "", "python -c with a backslash is refused");
assert.notEqual(decide("cat > x.mjs <<'EOF'\nconst re = /\\d+/;\nEOF"), "", "a heredoc with a backslash is refused");
assert.notEqual(decide(String.raw`bun --eval "console.log('\t')"`), "", "bun --eval with a backslash is refused");
assert.equal(decide(`node -e 'console.log(1+1)'`), "", "an inline script without a backslash is allowed");
assert.equal(decide("cat > x.mjs <<'EOF'\nconsole.log(1)\nEOF"), "", "a heredoc without a backslash is allowed");
assert.equal(decide(String.raw`grep -n "a\|b" file.ts`), "", "a backslash outside an inline script is allowed");
assert.equal(decide("node scripts/run.mjs"), "", "running a script file is allowed");
console.log("inline-script-guard: 8 ok");
