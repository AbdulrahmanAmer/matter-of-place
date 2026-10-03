# Watched-fail ledger

Every new test is watched failing for the right reason (RULE 2, STANDARDS R49). `node scripts/watchfail.mjs ... --record "<test name>"` appends a row here; do not format this file by hand (`.prettierignore` skips it, so the appended rows keep their shape). What CI replays is the registry, `tests/mutations/<slice>.json`, not this ledger.

| Date | Test | Mutation | Expected reason | Observed |
| ---- | ---- | -------- | --------------- | -------- |
| 2026-10-03 | seo brand once | src/lib/seo.ts: "title === siteConfig.name \|\|" → "" | /expected/ | red, output matched /expected/ |
| 2026-10-03 | dom.ts: cleanup after each test (scratch component test) | tests/setup/dom.ts: "  cleanup();" → "" | /starts with an empty body after cleanup/ | red, output matched /starts with an empty body after cleanup/ |
| 2026-10-03 | dom.ts: matchMedia stub never matches (scratch component test) | tests/setup/dom.ts: "matches: false," → "matches: true," | /renders, and matchMedia exists/ | red, output matched /renders, and matchMedia exists/ |
| 2026-10-03 | hermetic.ts: fetch refuses the network (scratch unit and component test) | tests/setup/hermetic.ts: "  value: refuseNetwork," → "  value: () => 1," | /refuses the network/ | red, output matched /refuses the network/ |
| 2026-10-03 | hermetic.ts: credentials removed from process.env (scratch unit test) | tests/setup/hermetic.ts: "Reflect.deleteProperty(process.env, name);" → "name;" | /sees no credential/ | red, output matched /sees no credential/ |
