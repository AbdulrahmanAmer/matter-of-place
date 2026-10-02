export const meta = {
  name: 'build-slice',
  description: 'Build one plan slice end to end: size it into groups, a Sonnet 5.5 builder at high effort builds each group (Opus 5.5 for critical groups), an Opus 5.5 reviewer at high effort tries to refute it in a fresh context, fix at most twice',
  whenToUse: 'Run a slice from workspace/05-plans (args: { slice: "B1b" }). Add dryRun: true to see the groups only, startAt: "g3" to resume, only: ["g2"] to run chosen groups. closeOut: { id, steps, title, critical, defects } (or a list of them) first closes groups that were built and rejected; give them ids such as c6 and pass only: ["c6"] to close without building further. maxFixRounds (default 3) bounds the fix rounds of each group. builderModel: "opus" builds every group on Opus, opusGroups: ["g4"] builds the named ones on Opus. It stops before building only when no group can run; strictDependencies: true also stops on any unmet dependency the sizing lists. For a lane (S54): root: "E:/mop-build/<lane>" (a git worktree with its own .env copy and bun install) and base: "origin/main" (the ref the slice branch starts from). Lanes side by side (ruling H45): previewPort: 8798 gives the lane its own port, bankBase: { P: 300, G: 100 } its own gotcha numbers, branch: "slice/b2" its branch. A review rejects only on a blocking defect; follow-ups are banked or listed by one agent and the group is accepted. When the slice is done the workflow merges it through the merge gate itself (ruling H50); mergeEach: true merges after every accepted group, noMerge: true never merges.',
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
        },
        required: ['id', 'steps', 'title', 'files', 'proof', 'blocked', 'blockedOn', 'critical', 'needsOrchestrator', 'designer'],
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

const RULES = `Standing rules for this project (they overrule habit):
- Read the map at the top of ${ROOT}/GOTCHAS.md (before the first entry), then run \`node workspace/05-plans/check-gotchas.mjs --for <every file you will touch>\` from ${ROOT} and read what it prints (path entries in full, process entries by title; open a title that concerns your work with grep). Ruling H51 replaced reading the whole file. The operator's standing order (2026-10-02): the bank is ALWAYS updated. The moment a tool error, a failed approach, a wrong assumption, a plan line that did not match reality or a rework costs you more than a few minutes, add the entry to ${ROOT}/GOTCHAS.md in the same session (next free number, the template at the top of the file, a proof command), run \`node workspace/05-plans/check-gotchas.mjs\` from ${ROOT}, commit it with your work and name it in gotchasAdded. Finishing with "nothing went wrong" after a second attempt at anything is a defect.
- No Docker on this machine, ever (S50). There is one cloud database, the project named mop-dev: the build database now, production after the launch switch (ASSUMED H35). There is no R2: files live in Supabase Storage, buckets submissions, media and documents (H33). There is no Anthropic key: captions come from the laptop runner (H34).
- Facts measured on this machine are in ${ROOT}/workspace/05-plans/ASSUMED.md section E. They overrule older lines anywhere.
- Secrets live in ${ROOT}/.env (git-ignored). Load them without printing: set -a; . <(tr -d '\\r' < "${BASH_ROOT}/.env" | grep -E '^[A-Z0-9_]+='); set +a   Never cat, echo or paste a value. Never commit a secret.
${ROOT === MAIN ? '' : `- Your working tree is ${ROOT}, a git worktree of the repository (a lane of the 48-hour build, S54). Every path you read or write is under it. Never read, edit, check out or run git in ${MAIN}: other lanes and the orchestrator work there. A Supabase CLI command that needs the project link runs \`supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF"\` in this tree's app folder first (the link is per folder). Never push an unmerged migration to mop-dev from a lane (ASSUMED section H, ruling DB-01): your database proof is the \`db\` job of CI on your pull request.\n`}- ${ROOT}/workspace/05-plans/STANDARDS.md binds every line you write: its folder map says where each file lives (a file that fits no row stops you: say so, do not invent a folder), its rules and mechanical gates are part of every proof. ASSUMED section H (the engineering review rulings) overrules older plan text; when a plan line cites a finding id (for example DB-01), its full text is in ${ROOT}/workspace/05-plans/review/${slice}.md.
- Write only what the step needs. No dead code, no speculative option or abstraction, no comment that restates the code, no swallowed error, no TODO left behind, no file outside the folder map, nothing committed that is build output, a log or a scratch file.- Work only on the branch ${branch}. Check \`git -C "${ROOT}" branch --show-current\` before every commit. Never commit to main, never merge your branch into main, never force-push, never rewrite pushed history. You may bring main into your branch with \`git fetch -q origin && git merge origin/main\` (a merge commit, never a rebase) at the start of your work and whenever GitHub shows your pull request as conflicting, because a conflicting pull request starts no CI run (GOTCHAS P-136); GOTCHAS.md merges by entry through its own driver, and you run \`node workspace/05-plans/check-gotchas.mjs\` after such a merge.
- One writer per file: touch only the files your group names, plus ${logPath} (append only). One exception (ruling H46): when a gate of \`bun run check\` fails only because your group's own new files need an entry in a gate's configuration (knip.json, .jscpd.json, eslint.config.js, a tsconfig include, .gitignore, tests/mutations registry wiring), add the smallest entry that names your files or your binary, say it in the log, and go on. That is not a reason to stop BLOCKED. A dependency the plan installs before any code imports it is added in the step that first imports it (STANDARDS R04).
- Lanes run side by side (ruling H45). The local preview port of this lane is ${PORT}: wherever a plan step, a script or a gotcha says 8788, use ${PORT} here (\`wrangler dev --config .output/server/wrangler.json --port ${PORT}\` after copying .dev.vars as the cf:preview script does). Stop only the processes you started, by their own process id; never stop every node or workerd process, another lane may be serving its own preview.${a.bankBase ? ` Gotcha numbers in this lane start at P-${a.bankBase.P} and G-${a.bankBase.G}: take the next free number at or above them, so two lanes never hand out the same number.` : ''}
- Each cost you list under costTime names the gotcha entry that banks it. A cost without an entry is not finished work.
- Every new test is watched-fail: break the code it covers, see it red for the right reason, restore.
- A red result is a valid result. Paste real output. Words to use: UNPROVEN, NOT DONE, BLOCKED. Two failed approaches to one obstacle ends the attempt: record BLOCKED and what would unblock it.
- Copy is calm and brief with no em dashes. Never edit src/routeTree.gen.ts by hand.`

// A group that was built and then stopped (rejected, or blocked on a ruling) is closed first: closeOut = { id, steps,
// title, critical, defects }, one object or a list. The sizing leaves those steps out, so they are not built twice.
const closing = [].concat(a.closeOut || []).map((c) => ({ id: c.id, steps: c.steps, title: c.title, files: [], proof: `every proof of plan steps ${c.steps}, as the plan writes them`, blocked: false, blockedOn: '', critical: Boolean(c.critical), needsOrchestrator: '', openDefects: c.defects }))

phase('Size')
const sized = await agent(`${RULES}

You are sizing slice ${slice} for the builders. Read-only: change nothing.${closing.length ? `\nLeave out plan step${closing.length > 1 ? 's' : ''} ${closing.map((c) => c.steps).join(' and ')}: another builder is closing ${closing.length > 1 ? 'them' : 'it'} before your groups run, so treat ${closing.length > 1 ? 'them' : 'it'} as done.` : ''}
Read ${planPath} in full, then ${ROOT}/workspace/05-plans/PLAN.md and ${ROOT}/workspace/05-plans/ASSUMED.md section E, and the tail of ${logPath} if it exists (earlier groups may already be done: leave those out).
1. Check the slice's "Depends on" line against the status table at the end of PLAN.md and the facts in ASSUMED section E. unmetDependencies holds ONLY what stops the whole slice from starting: another slice it depends on that the table does not show as closed, or an input without which not one step can run. A step or a part of a step that waits (on a later slice, an operator input, the custom domain) is NOT an unmet dependency: it goes into that group's blockedOn. A fact you think is stale in a document is not a dependency either: say it in the group title of the step it touches.
2. Split the plan's ordered steps into groups, in order. One group is what one builder session finishes and proves: two or three consecutive plan steps when together they touch at most about ten files, one step alone when it is large or critical. Every group costs a fresh review, so do not split what one session can finish. Keep steps that share files in the same group. Copy each group's proof commands from the plan verbatim. Set designer to true when the plan's "Owner agent" line gives the group's steps to mop-designer (design direction, layout decisions, copy); otherwise false.
3. Mark a group blocked ONLY when nothing in it can run today (every step in it is marked BLOCKED in the plan or needs something section E says does not exist); say on what. When only a part is blocked, keep blocked false, put the waiting part in blockedOn, and say in the title which part runs: the builder builds and proves the part that runs and records the rest as BLOCKED.
4. Set needsOrchestrator when the plan step deploys production, sets a production secret by hand, or needs a decision. A merge to main is not a reason: the workflow merges the slice through the merge gate itself.
5. Set critical to true when the group writes or changes any of: row level security policies, grants or security definer SQL functions; sign-in, sessions, tokens, CSRF, permissions or the authorization matrix; the job system's claim, lease, retry or idempotency logic; payment, invoice or credit state; cryptography or signature checks; the launch switch, the production guard or any destructive database command; secrets handling in CI or deploy workflows. Otherwise false. A critical group is built by the stronger model (operator decision S62).`, { label: `size:${slice}`, phase: 'Size', model: 'sonnet', effort: 'high', schema: GROUPS })

if (!sized) throw new Error('sizing agent failed')
log(`${slice}: ${sized.groups.length} groups, ${sized.groups.filter((g) => g.blocked).length} blocked, unmet dependencies: ${sized.unmetDependencies.join('; ') || 'none'}`)
if (a.dryRun) return { slice, dryRun: true, ...sized }
// The stop rule is mechanical (GOTCHAS P-061): what the sizing agent lists as unmet is information for the
// orchestrator; the slice stops here only when not one group can run, or when the orchestrator asks for a strict stop.
if (!sized.groups.some((g) => !g.blocked)) return { slice, stopped: 'no group can run', ...sized }
if (a.strictDependencies && sized.unmetDependencies.length) return { slice, stopped: 'unmet dependencies (strict)', ...sized }

let groups = sized.groups
// Give each close-out an id the sizing cannot produce (c6, c7) so `only` can name it.
groups = [...closing, ...groups]
const MAX_FIX = Number.isInteger(a.maxFixRounds) ? a.maxFixRounds : 3
if (a.startAt) groups = groups.slice(Math.max(0, groups.findIndex((g) => g.id === a.startAt)))
if (a.only) groups = groups.filter((g) => a.only.includes(g.id))

const buildPrompt = (g, defects) => `${RULES}

You are building group ${g.id} of slice ${slice}: "${g.title}" (plan steps ${g.steps}).
The plan is ${planPath}. Read it in full, then ${ROOT}/workspace/05-plans/STANDARDS.md, then ${APP}/AGENTS.md, then only the spec sections the plan cites and the files you will touch.
Your files: ${g.files.join(', ') || '(as the plan lists for these steps)'}
Proof you must run and paste: ${g.proof}

${defects ? `A fresh reviewer rejected the previous attempt. Fix exactly the defects marked blocking (or all of them when none carries the mark), then re-run every proof. A defect marked "blocking": false is a follow-up: fix it only when it is a small change inside your own files, otherwise leave it, another agent records it.\n${JSON.stringify(defects, null, 1)}\n` : `Start: \`git -C "${ROOT}" fetch -q origin && (git -C "${ROOT}" checkout ${branch} 2>/dev/null || git -C "${ROOT}" checkout -b ${branch} ${BASE}) && git -C "${ROOT}" merge origin/main\`. Other lanes land on main while you work, so every group starts from current main; if the merge conflicts in a code file, resolve it keeping both sides' intent, run \`bun run check\`, and say so in the log. Confirm the branch before you write.`}
Build the steps in order. After each step run its proof. When the group is proven: run \`bun run check\` and \`bun run build\` in the app folder, commit on ${branch} with a message that names the slice and steps, push the branch (\`git push -u origin ${branch}\`). Push once per finished piece of work, not once per commit: every push to a pull request spends Actions minutes. CI runs only on a pull request: if \`gh pr list --head ${branch} --state open\` shows none after your first push, open a draft one (\`gh pr create --draft --base main --head ${branch}\` with a title that names the slice and a body that says which steps it holds). Never mark it ready and never merge it: the workflow's merge step does that through the merge gate when the slice is done.
Append to ${logPath} a block headed "## ${g.id} · steps ${g.steps}" with each proof command and its real output (trim long output, never trim the failing part).
If the plan is wrong, do not build something else quietly: stop, say what is wrong, and return status "blocked".`

const reviewPrompt = (g, built) => `${RULES}

You are a fresh reviewer for group ${g.id} of slice ${slice} ("${g.title}", plan steps ${g.steps}). You did not write this code and you were not given the author's reasoning. Read-only: do not edit, commit or push.
The contract is ${planPath} (the sections Contract, Invariants and the steps ${g.steps} with their proofs). The branch is ${branch}; see what changed with \`git -C "${ROOT}" diff ${BASE}...${branch} --stat\` and read the changed files.
The author claims: ${JSON.stringify({ status: built.status, proofs: built.proofs, unproven: built.unproven, watchedFail: built.watchedFail, costTime: built.costTime, gotchasAdded: built.gotchasAdded }, null, 1)}
1. Re-run every proof command yourself and record what you observed.
2. Try to refute "done": an invariant of the plan the code breaks, a proof that passes for the wrong reason, a test that cannot fail, a file the group should have created that is missing, a convention in AGENTS.md that is broken, a secret or an em dash in the diff, Docker assumed, R2 or a second database or an Anthropic key assumed (rulings H33, H34, H35).
3. Run \`bun run check\` in the app folder.
4. Read ${ROOT}/workspace/05-plans/STANDARDS.md and go through its reviewer checklist line by line against the diff, and check every new or moved file against its folder map. A broken rule of STANDARDS.md is a defect: name the rule and the line. So is code the step did not ask for: dead code, an unused export, a speculative option, a comment that restates the code, a swallowed error, a leftover TODO, a scratch or generated file in the commit.
5. The gotcha bank (the operator's standing order). For each line the author lists under costTime, and for anything in the slice log or the diff that shows a second attempt or a workaround, there must be an entry in ${ROOT}/GOTCHAS.md on this branch with a rule and a proof command: \`git -C "${ROOT}" diff ${BASE}...${branch} -- GOTCHAS.md\` shows it and \`node workspace/05-plans/check-gotchas.mjs\` run from ${ROOT} prints OK. A cost with no entry is a defect; say which. If something cost YOU time while reviewing, report it under defects with file "GOTCHAS.md" so it gets added.
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
for (const g of groups) {
  if (g.blocked) {
    out.push({ group: g.id, steps: g.steps, status: 'blocked', blockedOn: g.blockedOn })
    log(`${g.id} (steps ${g.steps}) BLOCKED on ${g.blockedOn}`)
    continue
  }
  // The label carries the steps so the progress board (workspace/05-plans/board.mjs) can read the journal.
  const tag = (kind) => `${kind}:${slice}:${g.id}:${g.steps}`
  const worker = g.designer ? 'mop-designer' : 'mop-builder'
  let built = await agent(buildPrompt(g, g.openDefects || null), { label: tag(g.openDefects ? 'close' : 'build'), phase: g.openDefects ? 'Fix' : 'Build', model: builderModel(g), effort: 'high', agentType: worker, schema: BUILD })
  if (!built) { out.push({ group: g.id, steps: g.steps, status: 'failed', blockedOn: 'builder agent died' }); break }
  let review = null
  let rounds = 0
  if (built.status !== 'blocked') {
    review = await agent(reviewPrompt(g, built), { label: tag('review'), phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW })
    while (blocks(review) && rounds < MAX_FIX) {
      rounds++
      const fixed = await agent(buildPrompt(g, review.defects), { label: tag(`fix${rounds}`), phase: 'Fix', model: builderModel(g), effort: 'high', agentType: worker, schema: BUILD })
      if (!fixed) break
      built = fixed
      review = await agent(reviewPrompt(g, built), { label: tag(`review${rounds + 1}`), phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW })
    }
  }
  let bankClosed = null
  const passed = Boolean(review && !blocks(review))
  if (passed && followUps(review).length) bankClosed = await agent(bankPrompt(g, followUps(review)), { label: tag('bank'), phase: 'Fix', model: 'sonnet', effort: 'high', agentType: 'mop-builder', schema: BUILD })
  const accepted = passed && (!followUps(review).length || Boolean(bankClosed && bankClosed.status === 'done'))
  out.push({ group: g.id, steps: g.steps, status: built.status === 'blocked' ? 'blocked' : accepted ? 'accepted' : 'rejected', fixRounds: rounds, builder: builderModel(g), critical: Boolean(g.critical), built, review, bankClosed, needsOrchestrator: g.needsOrchestrator })
  log(`${g.id} (steps ${g.steps}): ${built.status}, review ${review ? review.verdict : 'not run'}, fix rounds ${rounds}`)
  if (!accepted) { log(`stopping after ${g.id}: later groups depend on it`); break }
  if (g.needsOrchestrator) { log(`stopping after ${g.id}: the orchestrator must act: ${g.needsOrchestrator}`); break }
}

const next = sized.groups.find((g) => !g.blocked && !out.some((o) => o.group === g.id && o.status === 'accepted'))

// Ruling H50: the lane merges itself. When every group that can run is accepted (or when mergeEach is set and a
// group was just accepted), one agent brings main in, marks the pull request ready, waits for CI and runs the
// merge gate. The orchestrator re-runs its own probes after the merge, in batches, instead of stopping each lane.
// A merge spends CI minutes on main and a dev deploy, so the default is one merge per slice.
const stoppedForOrchestrator = out.some((o) => o.status === 'accepted' && o.needsOrchestrator) && out.at(-1)?.needsOrchestrator
const sliceDone = !next && out.length > 0 && out.every((o) => o.status === 'accepted')
let merged = null
if (!a.noMerge && (sliceDone || (a.mergeEach && out.at(-1)?.status === 'accepted')) && !stoppedForOrchestrator) {
  merged = await agent(`${RULES}

You merge the work of slice ${slice} on branch ${branch} into main through the merge gate. Nothing else: no code change, no plan change.
1. \`git -C "${ROOT}" status --short\` must be empty. \`git -C "${ROOT}" fetch -q origin && git -C "${ROOT}" merge origin/main\`; resolve a conflict only in GOTCHAS.md (it merges by entry through its driver; run \`node workspace/05-plans/check-gotchas.mjs\` from ${ROOT}) or in a log file (keep both sides). Any other conflict: stop and return status "blocked" naming the file. Push.
2. Find the pull request: \`gh pr list --head ${branch} --state open --json number --jq '.[0].number'\`. If none, open one (not draft). Otherwise \`gh pr ready <n>\`.
3. Wait for its checks: \`gh pr checks <n> --watch --interval 20\` (run it in the background and read its output file if it passes ten minutes). If a check fails, read the failing job's log (\`gh run view <id> --log-failed\`), fix nothing, and return status "blocked" with the failing step's output pasted.
4. \`node workspace/05-plans/merge-gate.mjs <n>\` from ${ROOT}; paste its output. It must print the merge; if it refuses, return status "blocked" with its words.
5. Record the merge commit (\`gh pr view <n> --json mergeCommit --jq .mergeCommit.oid\`) in proofs, with the CI run id. Report status "done".`, { label: `merge:${slice}:all:${out.map((o) => o.steps).join(',')}`, phase: 'Fix', model: 'sonnet', effort: 'high', agentType: 'mop-builder', schema: BUILD })
}
return { slice, branch, root: ROOT, base: BASE, log: logPath, groups: out, merged, resumeWith: next ? { slice, startAt: next.id } : null, sizing: sized }
