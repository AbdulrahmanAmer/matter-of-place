// B10 step 7: posts one approved Instagram asset from `mop-dev`, before the launch switch. `bun run
// scripts/meta-test-post.ts --asset <id> --i-mean-it [--target dev]` enqueues `post_meta` for it and prints `posted
// instagram <permalink>` or `failed instagram <error>` (exit 1). It never calls Meta itself.
import { testPostMain } from "./lib/test-post.ts";
import { runScript } from "./lib/social-script.ts";

if (import.meta.main) await runScript(() => testPostMain(["instagram"]));
