export const meta = {
  name: 'build-slice',
  description: 'Build one plan slice end to end: size it into groups, a Sonnet 5.5 builder at high effort builds each group (Opus 5.5 for critical groups), an Opus 5.5 reviewer at high effort tries to refute it in a fresh context, fix at most twice',
  whenToUse: 'Run a slice from workspace/05-plans (args: { slice: "B1b" }). Add dryRun: true to see the groups only, startAt: "g3" to resume, only: ["g2"] to run chosen groups. closeOut: { id, steps, title, critical, defects } (or a list of them) first closes groups that were built and rejected; give them ids such as c6 and pass only: ["c6"] to close without building further. maxFixRounds (default 3) bounds the fix rounds of each group. builderModel: "opus" builds every group on Opus, opusGroups: ["g4"] builds the named ones on Opus. It stops before building only when no group can run; strictDependencies: true also stops on any unmet dependency the sizing lists. For a lane (S54): root: "E:/mop-build/<lane>" (a git worktree with its own .env copy and bun install) and base: "origin/main" (the ref the slice branch starts from). Lanes side by side (ruling H45): previewPort: 8798 gives the lane its own port, bankBase: { P: 300, G: 100 } its own gotcha numbers, branch: "slice/b2" its branch. A review rejects only on a blocking defect; follow-ups are banked or listed by one agent and the group is accepted. When the slice is done the workflow merges it through the merge gate itself (ruling H50); mergeEach: true merges after every accepted group, noMerge: true never merges; mergeOnly: true runs only the merge agent for a lane whose groups are accepted.',
  phases: [
    { title: 'Size', detail: 'read the plan and split its steps into groups one builder session can finish; mark the critical ones', model: 'sonnet' },
    { title: 'Build', detail: 'mop-builder works one group on the slice branch and pastes proof into the slice log (Sonnet high; Opus high for a critical group)', model: 'sonnet' },
    { title: 'Review', detail: 'a fresh Opus reviewer re-runs the proofs and tries to refute the claim of done', model: 'opus' },
    { title: 'Fix', detail: 'the builder repairs the blocking defects, three rounds at most unless maxFixRounds says otherwise; follow-ups are banked or listed by one agent', model: 'sonnet' },
  ],
}

// The orchestrator (the main session) stays the judge: it re-runs the proofs, merges the pull request and
// closes the slice in PLAN.md. Nothing here merges into main or touches production.

const a = args || {}
const MAIN = 'E:/Matter Of Place'
const ROOT = a.root || MAIN
const BASE = a.base || 'origin/main'
const BASH_ROOT = '/' + ROOT[0].toLowerCase() + ROOT.slice(2)
const APP = `${ROOT}/app`
const slice = a.slice
if (!slice || !/^(B|H|L)[0-9a-z]+$/i.test(slice)) throw new Error('args.slice is required, for example { slice: "B1b" }')
const planPath = `${ROOT}/workspace/05-plans/${slice}.md`
const logPath = `${ROOT}/workspace/05-plans/logs/${slice}.md`
const branch = a.branch || `slice/${slice.toLowerCase()}`
const followPath = `${ROOT}/workspace/05-plans/logs/${slice}-followups.md`
const PORT = a.previewPort || 8788

const GROUPS = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'g1, g2, ... in build order' },
          steps: { type: 'string', description: 'the plan step numbers this group covers, e.g. "1-2"' },
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          proof: { type: 'string', description: 'the proof commands of these steps, verbatim from the plan' },
          blocked: { type: 'boolean' },
          blockedOn: { type: 'string' },
          critical: { type: 'boolean', description: 'true when a subtle mistake here is expensive: see rule 5 of the sizing instructions' },
          needsOrchestrator: { type: 'string', description: 'empty, or what only the orchestrator may do after this group (a production deploy, a secret to set by hand, a decision); merging to main is not one, the workflow merges through the gate' },
          designer: { type: 'boolean', description: 'true when the plan gives these steps to mop-designer' },
          needsPullRequest: { type: 'boolean', description: 'true only when a proof of these steps is a CI job on a pull request' },
          brief: { type: 'string', description: 'the packet the builder and the reviewer work from instead of the whole plan: the full text of each step of the group verbatim, then every line of the Contract and Invariants sections that names one of the group\'s files or one of the things the steps build, then the Files-list lines of those files, each quoted verbatim with its section name. Nothing paraphrased, nothing left out that those steps need.' },
        },
        required: ['id', 'steps', 'title', 'files', 'proof', 'blocked', 'blockedOn', 'critical', 'needsOrchestrator', 'designer', 'brief'],
      },
    },
    unmetDependencies: { type: 'array', items: { type: 'string' } },
  },
  required: ['groups', 'unmetDependencies'],
}

const BUILD = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    proofs: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, observed: { type: 'string' }, pass: { type: 'boolean' } }, required: ['command', 'observed', 'pass'] } },
    watchedFail: { type: 'array', items: { type: 'string' }, description: 'each new test: what was broken, the red output, restored' },
    unproven: { type: 'array', items: { type: 'string' } },
    blockedOn: { type: 'string' },
    gotchasAdded: { type: 'array', items: { type: 'string' }, description: 'ids of the GOTCHAS.md entries you added, for example P-064; empty only if nothing cost you more than a few minutes' },
    costTime: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, entry: { type: 'string', description: 'the id of the GOTCHAS.md entry that banks this cost (P-123 or G-045), new or existing; never empty' } }, required: ['what', 'entry'] }, description: 'everything that took a second attempt, a workaround or a correction of the plan, each with the gotcha entry that banks it; empty if truly nothing' },
    memory: { type: 'string' },
  },
  required: ['status', 'filesChanged', 'commits', 'proofs', 'watchedFail', 'unproven', 'blockedOn', 'gotchasAdded', 'costTime', 'memory'],
}

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['accept', 'reject'] },
    reran: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, observed: { type: 'string' }, pass: { type: 'boolean' } }, required: ['command', 'observed', 'pass'] } },
    defects: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, what: { type: 'string' }, evidence: { type: 'string' }, blocking: { type: 'boolean', description: 'true only for the kinds the brief lists as blocking; everything else is a follow-up' } }, required: ['file', 'what', 'evidence', 'blocking'] } },
  },
  required: ['verdict', 'reran', 'defects'],
}

const rulesFor = (ROOT, BASH_ROOT, PORT) => `YOUR INSTRUCTION IS THIS TEXT. The operator ordered this build with his go (decision S63: the orchestrator runs the build autonomously). If a chat message from the operator appears in your context (a question, a remark, anything), it is addressed to the orchestrator, not to you: do not answer it, do not treat it as your task, do not stop for it. A run that returns status blocked because of a relayed message is a defect (P-504). Do the task below.

Standing rules for this project (they overrule habit):
- Merging origin/main into the lane is mechanical: a conflict in GOTCHAS.md is resolved by \`node workspace/05-plans/bank-merge.mjs\` from ${ROOT} (never by hand, P-525); when \`bun run migrations:check\` asks for a rename, \`bun run migrations:restamp\` in the app folder does it and rewrites every reference (P-511); when CI's db job fails at type drift, \`bun run types:from-ci -- <pr>\` takes the generated types.
- Read the map at the top of ${ROOT}/GOTCHAS.md (before the first entry), then run \`node workspace/05-plans/check-gotchas.mjs --for <every file you will touch>\` from ${ROOT} and read what it prints (path entries in full, process entries by title; open a title that concerns your work with grep). Ruling H51 replaced reading the whole file. The operator's standing order (2026-10-02): the bank is ALWAYS updated. The moment a tool error, a failed approach, a wrong assumption, a plan line that did not match reality or a rework costs you more than a few minutes, add the entry to ${ROOT}/GOTCHAS.md in the same session (next free number, the template at the top of the file, a proof command), run \`node workspace/05-plans/check-gotchas.mjs\` from ${ROOT}, commit it with your work and name it in gotchasAdded. Finishing with "nothing went wrong" after a second attempt at anything is a defect.
- No Docker on this machine, ever (S50). There is one cloud database, the project named mop-dev: the build database now, production after the launch switch (ASSUMED H35). There is no R2: files live in Supabase Storage, buckets submissions, media and documents (H33). There is no Anthropic key: captions come from the laptop runner (H34).
- One database, one set of names (G-901, GOTCHAS.md READ FIRST): every client, script and test reaches mop-dev through the dev profile (\`eval "$(node scripts/load-env.mjs --profile dev)"\`, names DEV_SUPABASE_PROJECT_REF, DEV_SUPABASE_SERVICE_ROLE_KEY, DEV_DB_URL). Never build a client from SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY taken from the shell: on this laptop they belong to another business's production project, and a test that read them wrote there on 2026-10-06. tests/unit/one-database.test.ts fails any new reader without the E2E_STACK switch; a reviewer rejects one.
- Facts measured on this machine are in ${ROOT}/workspace/05-plans/ASSUMED.md section E. They overrule older lines anywhere.
- Secrets live in ${ROOT}/.env (git-ignored). Load them without printing: set -a; . <(tr -d '\\r' < "${BASH_ROOT}/.env" | grep -E '^[A-Z0-9_]+='); set +a   Never cat, echo or paste a value. Never commit a secret.
${ROOT === MAIN ? '' : `- Your working tree is ${ROOT}, a git worktree of the repository (a lane of the 48-hour build, S54). Every path you read or write is under it. Never read, edit, check out or run git in ${MAIN}: other lanes and the orchestrator work there. A Supabase CLI command that needs the project link runs \`supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF"\` in this tree's app folder first (the link is per folder). Never push an unmerged migration to mop-dev from a lane (ASSUMED section H, ruling DB-01): your database proof is the \`db\` job of CI on your pull request.\n`}- ${ROOT}/workspace/05-plans/STANDARDS.md binds every line you write: its folder map says where each file lives (a file that fits no row stops you: say so, do not invent a folder), its rules and mechanical gates are part of every proof. ASSUMED section H (the engineering review rulings) overrules older plan text; when a plan line cites a finding id (for example DB-01), its full text is in ${ROOT}/workspace/05-plans/review/${slice}.md.
- Write only what the step needs. No dead code, no speculative option or abstraction, no comment that restates the code, no swallowed error, no TODO left behind, no file outside the folder map, nothing committed that is build output, a log or a scratch file.- Work only on the branch ${branch}. Check \`git -C "${ROOT}" branch --show-current\` before every commit. Never commit to main, never merge your branch into main, never force-push, never rewrite pushed history. You may bring main into your branch with \`git fetch -q origin && git merge origin/main\` (a merge commit, never a rebase) at the start of your work and whenever GitHub shows your pull request as conflicting, because a conflicting pull request starts no CI run (GOTCHAS P-136); GOTCHAS.md merges by entry through its own driver, and you run \`node workspace/05-plans/check-gotchas.mjs\` after such a merge.
- One writer per file: touch only the files your group names, plus ${logPath} (append only). One exception (ruling H46): when a gate of \`bun run check\` fails only because your group's own new files need an entry in a gate's configuration (knip.json, .jscpd.json, eslint.config.js, a tsconfig include, .gitignore, tests/mutations registry wiring), add the smallest entry that names your files or your binary, say it in the log, and go on. That is not a reason to stop BLOCKED. A dependency the plan installs before any code imports it is added in the step that first imports it (STANDARDS R04).
- Migrations (ruling H57): never push a migration to mop-dev from this lane and never run db:reset or the seed there; prove a migration inside rolled-back transactions on mop-dev (P-312). The workflow merges an accepted migration group into main at once and main pushes it; a proof that needs the pushed migration is UNPROVEN until then and says so.
- Lanes run side by side (ruling H45). The local preview port of this lane is ${PORT}: wherever a plan step, a script or a gotcha says 8788, use ${PORT} here (\`wrangler dev --config .output/server/wrangler.json --port ${PORT}\` after copying .dev.vars as the cf:preview script does). Stop only the processes you started, by their own process id; never stop every node or workerd process, another lane may be serving its own preview.${a.bankBase ? ` Gotcha numbers in this lane start at P-${a.bankBase.P} and G-${a.bankBase.G}: take the next free number at or above them, so two lanes never hand out the same number.` : ''}
- Context is the cost (ruling H52): read a file longer than about 300 lines in slices (offset and limit), never re-read a file you just edited, run every command that prints more than a screen through \`node workspace/05-plans/quiet.mjs -- <command>\`, and never run a test suite in verbose mode unless a proof asks for a listed test name.
- Lanes share one machine (P-541): when a check stage dies with "JavaScript heap out of memory", that is node's own 2 GB heap ceiling under load, not a defect of yours; re-run with \`NODE_OPTIONS=--max-old-space-size=4096 bun run check\` and keep that variable for every later check, build and test in the group. Never retry the same command unchanged.
- Each cost you list under costTime names the gotcha entry that banks it. A cost without an entry is not finished work.
- Every new test is watched-fail: break the code it covers, see it red for the right reason, restore.
- A red result is a valid result. Paste real output. Words to use: UNPROVEN, NOT DONE, BLOCKED. Two failed approaches to one obstacle ends the attempt: record BLOCKED and what would unblock it.
- Copy is calm and brief with no em dashes. Never edit src/routeTree.gen.ts by hand.`
const RULES = rulesFor(ROOT, BASH_ROOT, PORT)

// An agent that dies on the way (a network outage, a terminal API error) returns null; the harness retries once after a
// pause instead of ending the run with the group half done (P-509, the B3 step 3 fix that died on ENOTFOUND). The second
// label carries a suffix so the journal shows both attempts.
const callAgent = async (prompt, opts) => {
  const first = await agent(prompt, opts)
  if (first !== null && first !== undefined) return first
  log(`${opts.label}: no result (the agent died); retrying once in two minutes`)
  await new Promise((resolve) => setTimeout(resolve, Number.isInteger(a.retryPauseMs) ? a.retryPauseMs : 120000))
  const second = await agent(prompt, { ...opts, label: `${opts.label}:retry` })
  if (second === null || second === undefined) log(`${opts.label}: the retry died too`)
  return second
}

// One merge of the branch into main through the gate (ruling H50); used after an accepted schema group (P-512) and at the slice end.
let acceptedAtLastMerge = 0
let merged = null
const mergeNow = (label) => callAgent(`${RULES}

You merge the work of slice ${slice} on branch ${branch} into main through the merge gate. Nothing else: no code change, no plan change.
1. \`git -C "${ROOT}" status --short\` must be empty. \`git -C "${ROOT}" fetch -q origin && git -C "${ROOT}" merge origin/main\`; a conflict in GOTCHAS.md is resolved by \`node workspace/05-plans/bank-merge.mjs\` from ${ROOT} (by entry; it proves no entry or hit-again line is lost and stages the file; if it refuses, return status "blocked" with its words); a conflict in a log file keeps both sides. A conflict where both sides appended to the same list (an import line in a stylesheet or an index file, a permission or job-type row, a test matrix row, a fixture export) is resolved by keeping both sides with main's part first; \`src/routeTree.gen.ts\` is never resolved by hand: take main's copy, run the live build (\`MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA bun run build\` from app) and commit the regenerated file. Any other conflict: stop and return status "blocked" naming the file. Then the migration order (ruling H57, P-511): \`cd "${ROOT}/app" && bun run migrations:restamp\` moves this branch's migrations past main's newest in their order and rewrites every reference (it prints "nothing to do" when the order holds), then \`bun run migrations:check\`. Commit the merge and push. If the pull request's db job later fails at "type drift", \`bun run types:from-ci -- <n>\` from the app folder takes the file CI generated; commit and push it. A lane never pushed a migration to the database, so a re-stamp is safe; main pushes it after the merge.
2. Find the pull request: \`gh pr list --head ${branch} --state open --json number --jq '.[0].number'\`. If none, open one, not a draft (\`gh pr create --base main --head ${branch}\` with a title naming the slice and the steps it carries). Otherwise \`gh pr ready <n>\`.
3. Wait for its checks: \`gh pr checks <n> --watch --interval 20\` (run it in the background and read its output file if it passes ten minutes). If a check fails, read the failing job's log (\`gh run view <id> --log-failed\`), fix nothing, and return status "blocked" with the failing step's output pasted.
4. \`node workspace/05-plans/merge-gate.mjs <n>\` from ${ROOT}; paste its output. It must print the merge; if it refuses, return status "blocked" with its words.
5. Record the merge commit (\`gh pr view <n> --json mergeCommit --jq .mergeCommit.oid\`) in proofs, with the CI run id. Report status "done".`, { label, phase: 'Fix', model: 'sonnet', effort: 'high', agentType: 'mop-builder', schema: BUILD })

// A merge-only relaunch (P-535 gap, 2026-10-08): a run ended with every group accepted but its merge did not land (CI
// red on a shared defect since fixed on main, or a resume that never saw the earlier groups), and a relaunch with the
// accepted steps is refused by the P-516 check. `mergeOnly: true` skips the sizer and the groups: the merge agent
// brings main in, waits for CI and runs the merge gate.
if (a.mergeOnly) {
  phase('Merge')
  const merged = await mergeNow(`merge:${slice}:all:relaunch`)
  return { slice, branch, root: ROOT, base: BASE, log: logPath, groups: [], merged, resumeWith: null, sizing: null }
}

// A group that was built and then stopped (rejected, or blocked on a ruling) is closed first: closeOut = { id, steps,
// title, critical, defects }, one object or a list. The sizing leaves those steps out, so they are not built twice.
const closing = [].concat(a.closeOut || []).map((c) => ({ id: c.id, steps: c.steps, title: c.title, files: [], proof: `every proof of plan steps ${c.steps}, as the plan writes them`, blocked: false, blockedOn: '', critical: Boolean(c.critical), needsOrchestrator: '', openDefects: c.defects }))

phase('Size')
// Ruling H53: a premade sizing (workspace/05-plans/sizing/<slice>.json, written and reviewed by the orchestrator) is
// passed as args.sizing and replaces the sizing agent; it is the same on every run and its briefs come from plan-brief.mjs.
const sized = a.sizing ? a.sizing : await callAgent(`${RULES}

You are sizing slice ${slice} for the builders. Read-only: change nothing.${closing.length ? `\nLeave out plan step${closing.length > 1 ? 's' : ''} ${closing.map((c) => c.steps).join(' and ')}: another builder is closing ${closing.length > 1 ? 'them' : 'it'} before your groups run, so treat ${closing.length > 1 ? 'them' : 'it'} as done.` : ''}
Read ${planPath} in full, then ${ROOT}/workspace/05-plans/PLAN.md and ${ROOT}/workspace/05-plans/ASSUMED.md section E, and the tail of ${logPath} if it exists (earlier groups may already be done: leave those out).
1. Check the slice's "Depends on" line against the status table at the end of PLAN.md and the facts in ASSUMED section E. unmetDependencies holds ONLY what stops the whole slice from starting: another slice it depends on that the table does not show as closed, or an input without which not one step can run. A step or a part of a step that waits (on a later slice, an operator input, the custom domain) is NOT an unmet dependency: it goes into that group's blockedOn. A fact you think is stale in a document is not a dependency either: say it in the group title of the step it touches.
2. Split the plan's ordered steps into groups, in order, EVERY step of the plan in exactly one group (a step that cannot run today goes in a group marked blocked, never left out: a sizing that omits a step is refused, P-516). One group is what one builder session finishes and proves: two or three consecutive plan steps when together they touch at most about ten files, one step alone when it is large or critical. Every group costs a fresh review, so do not split what one session can finish. Keep steps that share files in the same group. Copy each group's proof commands from the plan verbatim. Set designer to true when the plan's "Owner agent" line gives the group's steps to mop-designer (design direction, layout decisions, copy); otherwise false.
6. Write each group's brief (ruling H52): the text of its steps verbatim, then every Contract and Invariants line that names one of its files or one of the things its steps build, then the Files-list lines of those files, each verbatim under its section name. The builder and the reviewer read the brief instead of the plan, so a line they would need that is missing from it costs a fix round; a line they do not need costs every turn. Measured: the plan was read 91 times in one day and every read sat in the context of every later call. Your whole answer must fit in one reply (P-519: two sizings lost groups because their briefs ran to 15,000 to 30,000 characters each): keep every brief under 5,000 characters, quoting the step text and only the Contract lines that name its files; when the slice has more than six groups, leave brief as an empty string for every group (the builder then runs plan-brief.mjs, which quotes the same lines mechanically). A sizing that omits a step is refused, so fewer words, never fewer groups.
3. Mark a group blocked ONLY when nothing in it can run today (every step in it is marked BLOCKED in the plan or needs something section E says does not exist); say on what. When only a part is blocked, keep blocked false, put the waiting part in blockedOn, and say in the title which part runs: the builder builds and proves the part that runs and records the rest as BLOCKED.
4. Set needsOrchestrator when the plan step deploys production, sets a production secret by hand, or needs a decision. A merge to main is not a reason: the workflow merges the slice through the merge gate itself.
5. Set critical to true when the group writes or changes any of: row level security policies, grants or security definer SQL functions; sign-in, sessions, tokens, CSRF, permissions or the authorization matrix; the job system's claim, lease, retry or idempotency logic; payment, invoice or credit state; cryptography or signature checks; the launch switch, the production guard or any destructive database command; secrets handling in CI or deploy workflows. Otherwise false. A critical group is built by the stronger model (operator decision S62).`, { label: `size:${slice}`, phase: 'Size', model: 'sonnet', effort: 'high', schema: GROUPS })

if (!sized) throw new Error('sizing agent failed')
log(`${slice}: ${sized.groups.length} groups, ${sized.groups.filter((g) => g.blocked).length} blocked, unmet dependencies: ${sized.unmetDependencies.join('; ') || 'none'}`)
if (a.dryRun) return { slice, dryRun: true, ...sized }
// The stop rule is mechanical (GOTCHAS P-061): what the sizing agent lists as unmet is information for the
// orchestrator; the slice stops here only when not one group can run, or when the orchestrator asks for a strict stop.
if (!sized.groups.some((g) => !g.blocked) && !closing.length) return { slice, stopped: 'no group can run', ...sized }
if (a.strictDependencies && sized.unmetDependencies.length) return { slice, stopped: 'unmet dependencies (strict)', ...sized }

let groups = sized.groups
// P-516: a sizer once returned two of ten plan steps and the run merged those two and ended as if the slice were
// done. When the orchestrator passes `steps` (the plan's step ids), every one must sit in a group or a close-out;
// a sizing that omits one is refused before any build.
if (Array.isArray(a.steps)) {
  // A range may end on a lettered step ("1-3b", "7-7b"): it covers every plan step whose number sits inside the range,
  // letters included, so "1-3b" covers 1, 2, 3, 3a and 3b (2026-10-07, the first B10 sizing on the Dell was refused for
  // a group written exactly like that, P-516 by the letter).
  const numberOf = (id) => Number(String(id).match(/^(\d+)/)?.[1])
  const expand = (s) => String(s).split(/\s*,\s*/).flatMap((part) => {
    const m = part.match(/^(\d+)[a-z]?\s*(?:-|to)\s*(\d+)[a-z]?$/)
    if (!m) return [part.trim()]
    const lo = Number(m[1]), hi = Number(m[2])
    const out = []
    for (let i = lo; i <= hi; i++) out.push(String(i))
    for (const id of a.steps) if (/[a-z]$/.test(String(id)) && numberOf(id) >= lo && numberOf(id) <= hi) out.push(String(id))
    return out
  })
  const covered = new Set([...groups, ...closing].flatMap((g) => expand(g.steps)))
  const missing = a.steps.filter((s) => !covered.has(String(s)))
  if (missing.length) throw new Error(`sizing of ${slice} omits plan step${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (P-516): every step belongs to a group, blocked ones included`)
}
// Give each close-out an id the sizing cannot produce (c6, c7) so `only` can name it.
// startAt skips sized groups only: a close-out always runs first (P-506).
if (a.startAt) groups = groups.slice(Math.max(0, groups.findIndex((g) => g.id === a.startAt)))
groups = [...closing, ...groups]
const MAX_FIX = Number.isInteger(a.maxFixRounds) ? a.maxFixRounds : 3
if (a.only) groups = groups.filter((g) => a.only.includes(g.id))
// Sizer ids are not stable across runs (two sizings of H1 numbered the same seven groups g1..g7 and g4..g10), so a
// parallel group lane selects by plan step: onlySteps: ["7"] keeps the groups whose steps field names one of them.
if (a.onlySteps) groups = groups.filter((g) => String(g.steps).split(/,\s*/).some((s) => a.onlySteps.includes(s)))

const buildPrompt = (g, defects) => `${RULES}

You are building group ${g.id} of slice ${slice}: "${g.title}" (plan steps ${g.steps}).
Your brief, quoted from the plan ${planPath} (open the plan itself only for a section the brief names and does not quote):
${g.brief || '(the brief is mechanical: run `node workspace/05-plans/plan-brief.mjs ' + slice + ' --steps "' + g.steps.replace(/\s*(-|to)\s*/g, ',') + '" --files "' + g.files.join(',') + '"` from ' + ROOT + ' and read its output first)'}

Then read the rule index \`node workspace/05-plans/standards-index.mjs\` (one line per rule of STANDARDS.md; open the full rule in STANDARDS.md only when its line concerns your files) and ${APP}/AGENTS.md, then only the spec sections the brief cites and the files you will touch.
Your files: ${g.files.join(', ') || '(as the plan lists for these steps)'}. That list is the group's ownership for lane conflicts, not its scope: the scope is the step text, and every file the steps say to write or change is yours even when the list omits it (P-513; the brief quotes the Files line of each). Only when a step names a file another group of this slice owns do you stop and return "blocked".
Proof you must run and paste: ${g.proof}
Working style (ruling H52, measured on 69 agents: the context re-sent per call averaged 238k tokens and a builder made 97 calls): batch independent commands in one call; do not grep around when the brief names the files; run long commands through \`node workspace/05-plans/quiet.mjs -- <command>\`, which prints the summary when green and the failing part in full when red; replay watched-fails through the registry tool in one call when it exists, and never one entry per call by hand.

${defects ? `A fresh reviewer rejected the previous attempt. Fix exactly the defects marked blocking (or all of them when none carries the mark), then re-run every proof. A defect marked "blocking": false is a follow-up: fix it only when it is a small change inside your own files, otherwise leave it, another agent records it.\n${JSON.stringify(defects, null, 1)}\n` : `Start: \`git -C "${ROOT}" fetch -q origin && (git -C "${ROOT}" checkout ${branch} 2>/dev/null || git -C "${ROOT}" checkout -b ${branch} ${BASE}) && git -C "${ROOT}" merge origin/main\`. Other lanes land on main while you work, so every group starts from current main; if the merge conflicts in a code file, resolve it keeping both sides' intent, run \`bun run check\`, and say so in the log. Confirm the branch before you write.`}
Build the steps in order. After each step run its proof. When the group is proven: run \`bun run check\` and \`bun run build\` in the app folder, commit on ${branch} with a message that names the slice and steps, push the branch (\`git push -u origin ${branch}\`). Push once per finished piece of work, not once per commit: every push to a pull request spends Actions minutes. ${g.needsPullRequest ? `This group's proof needs CI: if \`gh pr list --head ${branch} --state open\` shows no pull request after your first push, open a draft one (\`gh pr create --draft --base main --head ${branch}\` with a title that names the slice and a body that says which steps it holds). Never mark it ready and never merge it.` : `Do not open a pull request: the workflow's merge step opens it when the slice is done and merges through the merge gate (ruling H54); your proof is local.`}
Append to ${logPath} a block headed "## ${g.id} · steps ${g.steps}" with each proof command and its real output: at most 40 lines per proof, the summary lines when green and the failing part in full when red (ruling H52 (3)).
Before you commit, the reviewer's own pass (ruling H60; measured on 2026-10-04: 7 of 11 rejections were false sentences in a runbook or log, 2 were registry entries made stale by the formatter, 2 were code): (a) re-read every sentence you wrote in a runbook, a doc or the log that states a fact about code, a header, a cache, a cost or a command, and check it against the file or by running the command; a sentence you cannot check is written as UNPROVEN, never as a fact; (b) every "only", "never", "always", "every" and "each" gets a second case looked for (another branch, another key, another caller, a TTL, another data center) and is reworded when one exists; (c) after prettier or any formatter has run, replay every registry entry of the files you touched (node scripts/watchfail.mjs --registry tests/mutations --changed origin/main) and fix the stale ones; (d) the first line of your log block names the commit the branch started from (git merge-base origin/main HEAD) and the commit you hand in; (e) a proof you ran against a stand-in, a fake or an older deploy says so in the same line. Then run bun run check once more.
If the plan is wrong, do not build something else quietly: stop, say what is wrong, and return status "blocked".`

const reviewPrompt = (g, built, where = { root: ROOT, bash: BASH_ROOT, port: PORT, rules: RULES, snapshot: null }) => `${where.rules}
${where.snapshot ? `This review runs in a frozen snapshot of commit ${where.snapshot.sha.slice(0, 7)} (ruling H54): first run \`node workspace/05-plans/review-snapshot.mjs create ${where.snapshot.lane} ${where.snapshot.sha}\` from ${where.snapshot.lane} (the lane root; the tool makes the snapshot beside it); it prints the snapshot folder, which is ${where.root}, and every path below is under it. The builder of the next group is working in the lane ${where.snapshot.lane} at the same time: never read, run or write anything there. When you are done, run \`node workspace/05-plans/review-snapshot.mjs remove ${where.snapshot.lane}\`. If create fails twice, return verdict reject with one defect whose file is SNAPSHOT and whose what is the error text, and nothing else. No CI run exists for this commit; your snapshot is the proof.\n` : ''}

You are a fresh reviewer for group ${g.id} of slice ${slice} ("${g.title}", plan steps ${g.steps}). You did not write this code and you were not given the author's reasoning. Read-only: do not edit, commit or push.
The contract, quoted from the plan ${where.root}/workspace/05-plans/${slice}.md (open the plan only for a section the brief names and does not quote):
${g.brief || '(the brief is mechanical: run `node workspace/05-plans/plan-brief.mjs ' + slice + ' --steps "' + g.steps.replace(/\s*(-|to)\s*/g, ',') + '" --files "' + g.files.join(',') + '"` from ' + ROOT + ' and read its output first)'}
The branch is ${branch}; see what changed with \`git -C "${where.root}" diff ${BASE}...${branch} --stat\` and read the changed files.
Working style (ruling H52): batch independent commands in one call; run long commands through \`node workspace/05-plans/quiet.mjs -- <command>\` (summary when green, the failing part in full when red); replay only this group's new registry entries plus the registry's own consistency check, the whole registry is CI's job.
The author claims: ${JSON.stringify({ status: built.status, proofs: built.proofs, unproven: built.unproven, watchedFail: built.watchedFail, costTime: built.costTime, gotchasAdded: built.gotchasAdded }, null, 1)}
1. Re-run every proof command yourself and record what you observed.
2. Try to refute "done": an invariant of the plan the code breaks, a proof that passes for the wrong reason, a test that cannot fail, a file the group should have created that is missing, a convention in AGENTS.md that is broken, a secret or an em dash in the diff, Docker assumed, R2 or a second database or an Anthropic key assumed (rulings H33, H34, H35).
3. Run \`bun run check\` in the app folder.
4. Read ${where.root}/workspace/05-plans/STANDARDS.md and go through its reviewer checklist line by line against the diff, and check every new or moved file against its folder map. A broken rule of STANDARDS.md is a defect: name the rule and the line. So is code the step did not ask for: dead code, an unused export, a speculative option, a comment that restates the code, a swallowed error, a leftover TODO, a scratch or generated file in the commit.
5. The gotcha bank (the operator's standing order). For each line the author lists under costTime, and for anything in the slice log or the diff that shows a second attempt or a workaround, there must be an entry in ${where.root}/GOTCHAS.md on this branch with a rule and a proof command: \`git -C "${where.root}" diff ${BASE}...${branch} -- GOTCHAS.md\` shows it and \`node workspace/05-plans/check-gotchas.mjs\` run from ${where.root} prints OK. A cost with no entry is a defect; say which. If something cost YOU time while reviewing, report it under defects with file "GOTCHAS.md" so it gets added.
6. Mark every defect blocking or not (ruling ASSUMED H45 (1)). Blocking, true: behaviour that breaks the plan's Contract, an invariant or a rule of STANDARDS.md in the group's own files; a proof that fails, or a test that stays green when the thing it covers is removed; a risk to security or to data; a regression of something that worked; a false statement in a runbook or in the log. Follow-up, false: a missing gotcha entry; a stale line in a plan or document that is not this group's file (it is the orchestrator's to fold); a weakness the plan does not ask this step to close; a note for a later slice; anything you would accept without. Before you mark a defect blocking, name to yourself the concrete input or event that makes it go wrong for this product; if you cannot, it is a follow-up. Do not hunt for ever finer cases in a helper script once its contract holds: say what it does not cover in one follow-up.
Verdict "reject" only when at least one defect is blocking or a proof did not reproduce. Otherwise "accept", and list the follow-ups: one agent banks or records every one of them, none is dropped. Taste alone is not a defect.`

// S62: Sonnet 5.5 at high effort builds; Opus 5.5 at high effort builds a critical group and reviews every group.
const builderModel = (g) => (a.builderModel === 'opus' || g.critical || (a.opusGroups || []).includes(g.id) ? 'opus' : 'sonnet')
// Ruling H45 (1): only a blocking defect costs a build and review round. A review whose defects are all follow-ups
// (a missing gotcha entry, a stale line in someone else's file, a weakness the plan does not ask the step to close)
// has passed the code: one agent banks or records every follow-up and the group is accepted. The orchestrator reads
// the follow-ups file and folds it before the slice closes, so nothing is dropped.
const isBank = (d) => /GOTCHAS\.md$/.test(String(d.file))
const blocks = (r) => Boolean(r && r.verdict === 'reject' && (r.defects.length === 0 || r.reran.some((x) => !x.pass) || r.defects.some((d) => d.blocking !== false && !isBank(d))))
const followUps = (r) => (r ? r.defects.filter((d) => d.blocking === false || isBank(d)) : [])
const bankPrompt = (g, defects) => `${RULES}

Group ${g.id} of slice ${slice} (plan steps ${g.steps}) passed its code review: a fresh reviewer found no blocking defect, only follow-ups. Record every one of them; change no code.
1. A follow-up whose file is GOTCHAS.md is a cost with no entry in the gotcha bank: add the entry to ${ROOT}/GOTCHAS.md with the lines its neighbours have (symptom, cause, rule, proof, added) and a proof a reader can run.
2. Every other follow-up goes, word for word with its evidence, under a heading "## ${g.id} · steps ${g.steps}" appended to ${followPath} (create the file with a first line "# ${slice} follow-ups: the orchestrator folds or assigns each before the slice closes" when it does not exist).
3. Append to ${logPath} a short block headed "## ${g.id} · follow-ups recorded" that names the gotcha entries and counts the other follow-ups.
Then run \`node workspace/05-plans/check-gotchas.mjs\` from ${ROOT}, commit on ${branch}, push, and report the entry ids in gotchasAdded.

The follow-ups, as the reviewer wrote them:\n${JSON.stringify(defects, null, 1)}`
const out = []
// Ruling H54: one serial chain of writers (builds, fixes, follow-ups) in the lane; each review runs in a frozen snapshot
// of the group's last commit, one review at a time per lane, overlapping the next build. A group that moves the schema
// of mop-dev (migrations, seed, db:push) waits for every pending review first. See review-overlap.md.
const schemaWork = (g) => (g.files || []).some((f) => /supabase\/migrations|\/seed|db-push|db-reset/.test(f)) || /\b(db:push|db:reset|seed)\b/.test(g.title || '')
const lastSha = (built) => { const line = (built.commits || []).at(-1) || ''; return (line.match(/^([0-9a-f]{7,40})\b/) || [])[1] || '' }
const snapshotWhere = (sha) => ({ root: `${ROOT}-review`, bash: `${BASH_ROOT}-review`, port: PORT + 1, rules: rulesFor(`${ROOT}-review`, `${BASH_ROOT}-review`, PORT + 1), snapshot: { sha, lane: ROOT } })
const snapshotFailed = (r) => Boolean(r && r.defects && r.defects.some((d) => d.file === 'SNAPSHOT'))
const pending = []   // { g, built, review: Promise, settled: boolean, result, rounds, worker }
let reviewQueue = Promise.resolve()
const startReview = (item, round) => {
  const sha = lastSha(item.built)
  const label = `${round ? `review${round + 1}` : 'review'}:${slice}:${item.g.id}:${item.g.steps}`
  const run = () => (a.noOverlap || !sha
    ? callAgent(reviewPrompt(item.g, item.built), { label, phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW })
    : callAgent(reviewPrompt(item.g, item.built, snapshotWhere(sha)), { label, phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW }))
  item.settled = false
  item.review = reviewQueue.then(run).then((r) => { item.result = r; item.settled = true; return r }, () => { item.result = null; item.settled = true; return null })
  reviewQueue = item.review
}
const finish = (item, accepted) => {
  out.push({ group: item.g.id, steps: item.g.steps, status: accepted ? 'accepted' : 'rejected', fixRounds: item.rounds, builder: item.worker, critical: Boolean(item.g.critical), built: item.built, review: item.result, bankClosed: item.bankClosed || null, needsOrchestrator: item.g.needsOrchestrator })
  log(`${item.g.id} (steps ${item.g.steps}): ${accepted ? 'accepted' : 'rejected'} after ${item.rounds} fix round(s)`)
}
// Writes for settled reviews, in the serial chain: a fix and a re-review, or the follow-up agent, or a review redone in the lane.
const settle = async () => {
  for (const item of pending.filter((x) => x.settled)) {
    const r = item.result
    if (!r || snapshotFailed(r)) {
      if (item.redone) { pending.splice(pending.indexOf(item), 1); finish(item, false); continue }
      item.redone = true
      log(`${item.g.id}: review ${r ? 'could not make its snapshot' : 'died'}; redoing it in the lane`)
      item.result = await callAgent(reviewPrompt(item.g, item.built), { label: `review-lane:${slice}:${item.g.id}:${item.g.steps}`, phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW })
      if (!item.result) { pending.splice(pending.indexOf(item), 1); finish(item, false); continue }
    }
    const review = item.result
    if (blocks(review) && item.rounds < MAX_FIX) {
      item.rounds++
      const later = pending.filter((x) => x !== item && groups.indexOf(x.g) > groups.indexOf(item.g)).map((x) => `${x.g.id} (steps ${x.g.steps}): ${x.g.files.join(', ')}`)
      const defects = later.length ? [...review.defects, { file: 'LATER GROUPS', what: `Built on top of this group since: ${later.join('; ')}. A fix repairs behaviour inside this group's contract; if it must change something those groups build on, stop and return status blocked naming the group (ruling H54).`, evidence: 'the writer chain', blocking: false }] : review.defects
      const fixed = await callAgent(buildPrompt(item.g, defects), { label: `fix${item.rounds}:${slice}:${item.g.id}:${item.g.steps}`, phase: 'Fix', model: item.worker === 'mop-designer' ? builderModel(item.g) : builderModel(item.g), effort: 'high', agentType: item.worker, schema: BUILD })
      if (!fixed || fixed.status === 'blocked') { pending.splice(pending.indexOf(item), 1); item.result = review; finish(item, false); continue }
      item.built = fixed
      startReview(item, item.rounds)
      continue
    }
    pending.splice(pending.indexOf(item), 1)
    if (blocks(review)) { finish(item, false); continue }
    if (followUps(review).length) {
      item.bankClosed = await callAgent(bankPrompt(item.g, followUps(review)), { label: `bank:${slice}:${item.g.id}:${item.g.steps}`, phase: 'Fix', model: 'claude-haiku-5-5', effort: 'high', agentType: 'mop-builder', schema: BUILD })
      finish(item, Boolean(item.bankClosed && item.bankClosed.status === 'done'))
    } else finish(item, true)
  }
}
const settleAll = async () => { while (pending.length) { await Promise.all(pending.map((x) => x.review)); await settle() } }
const failed = () => out.some((o) => o.status === 'rejected' || o.status === 'failed' || (o.status === 'blocked' && o.built))

for (const g of groups) {
  if (g.blocked) {
    out.push({ group: g.id, steps: g.steps, status: 'blocked', blockedOn: g.blockedOn })
    log(`${g.id} (steps ${g.steps}) BLOCKED on ${g.blockedOn}`)
    continue
  }
  if (schemaWork(g) && pending.length) { log(`${g.id} moves the schema: waiting for ${pending.length} pending review(s)`); await settleAll() }
  if (failed()) { log(`stopping before ${g.id}: an earlier group was not accepted`); break }
  const worker = g.designer ? 'mop-designer' : 'mop-builder'
  const tag = (kind) => `${kind}:${slice}:${g.id}:${g.steps}`
  const built = await callAgent(buildPrompt(g, g.openDefects || null), { label: tag(g.openDefects ? 'close' : 'build'), phase: g.openDefects ? 'Fix' : 'Build', model: builderModel(g), effort: 'high', agentType: worker, schema: BUILD })
  if (!built) { out.push({ group: g.id, steps: g.steps, status: 'failed', blockedOn: 'builder agent died' }); break }
  if (built.status === 'blocked') { out.push({ group: g.id, steps: g.steps, status: 'blocked', built, blockedOn: built.blockedOn, needsOrchestrator: g.needsOrchestrator }); log(`${g.id}: builder returned blocked`); break }
  const item = { g, built, rounds: 0, worker, settled: false, result: null }
  pending.push(item)
  startReview(item, 0)
  await settle()
  // P-512: a migration lands on main before the code that needs it, and never from a branch: an accepted schema group
  // merges now, while the lane is quiet (the next builder has not started).
  if (schemaWork(g) && !a.noMerge) {
    await settleAll()
    const mine = out.find((o) => o.group === g.id)
    if (mine && mine.status === 'accepted') { const m = await mergeNow(`merge:${slice}:${g.id}:${g.steps}`); merged = m; if (m && m.status === 'done') acceptedAtLastMerge = out.filter((o) => o.status === 'accepted').length; if (!m || m.status !== 'done') { log(`${g.id}: the merge of the schema group did not land; stopping`); out.push({ group: `${g.id}-merge`, steps: g.steps, status: 'failed', blockedOn: m ? m.blockedOn : 'merge agent died' }); break } }
  }
  if (g.needsOrchestrator) { await settleAll(); log(`stopping after ${g.id}: the orchestrator must act: ${g.needsOrchestrator}`); break }
}
await settleAll()
out.sort((x, y) => groups.findIndex((g) => g.id === x.group) - groups.findIndex((g) => g.id === y.group))

const next = sized.groups.find((g) => !g.blocked && !out.some((o) => o.group === g.id && o.status === 'accepted'))

// Ruling H50: the lane merges itself. When every group that can run is accepted (or when mergeEach is set and a
// group was just accepted), one agent brings main in, marks the pull request ready, waits for CI and runs the
// merge gate. The orchestrator re-runs its own probes after the merge, in batches, instead of stopping each lane.
// A merge spends CI minutes on main and a dev deploy, so the default is one merge per slice.
// P-518: an orchestrator item that reads "After the merge ..." waits for the merge, it does not replace it; B3b ended with every
// step accepted and its pull request open because its last group carried such a note.
const stoppedForOrchestrator = out.some((o) => o.status === 'accepted' && o.needsOrchestrator && !/^s*after the merge/i.test(String(o.needsOrchestrator)))
// A group the sizing marked blocked (waiting on another slice) has no `built` and does not hold the merge back;
// a group a builder returned blocked, or a rejected or failed one, does.
const sliceDone = !next && out.some((o) => o.status === 'accepted') && out.every((o) => o.status === 'accepted' || (o.status === 'blocked' && !o.built))
const unmerged = out.filter((o) => o.status === 'accepted').length > acceptedAtLastMerge
if (!a.noMerge && unmerged && (sliceDone || (a.mergeEach && out.at(-1)?.status === 'accepted')) && !stoppedForOrchestrator) {
  merged = await mergeNow(`merge:${slice}:all:${out.map((o) => o.steps).join(',')}`)
}
return { slice, branch, root: ROOT, base: BASE, log: logPath, groups: out, merged, resumeWith: next ? { slice, startAt: next.id } : null, sizing: sized }
