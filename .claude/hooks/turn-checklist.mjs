// UserPromptSubmit hook: the working checklist, pushed into every turn (operator, 2026-10-13: "put them in a checklist
// that you will follow to heart ... one shot this"). The hooks enforce what they can (shell-shaper.mjs, edit-impact.mjs);
// this is the order of work they cannot enforce. Kept short: it is read on every turn.
const CHECKLIST = [
  "Working checklist (Matter of Place):",
  "1. Before any test or check: act on every edit-impact note (STALE, EXPECT, NO ENTRY, GONE, UNUSED, COMPANION). Fix them all, then run once.",
  "2. Moving or renaming code, a test title or a string: in the same step, grep app/tests/mutations and app/tests for the old name and update them.",
  "3. Before pushing, run what CI runs on what changed: knip when exports change, runbook-lint for .env.example, bundle-check (built with VITE_API_BASE_URL=/api/public) for public UI, both tsc configs for shared code.",
  "4. Scripts go in files (Write tool), never node -e or heredocs; shell-shaper rewrites them if missed.",
  "5. Long commands run in the background (shell-shaper enforces it); keep working and never sleep-wait. One heavy job at a time on the laptop (P-712).",
  "6. Report with the real output; say NOT DONE or UNPROVEN plainly.",
].join("\n");

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: CHECKLIST } }));
