// B10 steps 7a and 7b: posts one approved asset to X or LinkedIn from `mop-dev`, before the launch switch. `bun run
// scripts/social-test-post.ts --channel x|linkedin --asset <id> --i-mean-it [--target dev]` enqueues `post_x` or
// `post_linkedin` for it and prints `posted <channel> <permalink>` or `failed <channel> <error>` (exit 1). It never
// calls a platform itself.
import { testPostMain } from "./lib/test-post.ts";
import { runScript } from "./lib/social-script.ts";

if (import.meta.main) await runScript(() => testPostMain(["x", "linkedin"]));
