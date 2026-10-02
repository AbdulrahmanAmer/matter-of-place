export const meta = {
  name: 'build-slice',
  description: 'Build one plan slice end to end: size it into groups, a Sonnet 5.5 builder at high effort builds each group (Opus 5.5 for critical groups), an Opus 5.5 reviewer at high effort tries to refute it in a fresh context, fix at most twice',
  whenToUse: 'Run a slice from workspace/05-plans (args: { slice: "B1b" }). Add dryRun: true to see the groups only, startAt: "g3" to resume, only: ["g2"] to run chosen groups. closeOut: { id, steps, title, critical, defects } (or a list of them) first closes groups that were built and rejected; give them ids such as c6 and pass only: ["c6"] to close without building further. maxFixRounds (default 3) bounds the fix rounds of each group. builderModel: "opus" builds every group on Opus, opusGroups: ["g4"] builds the named ones on Opus. It stops before building only when no group can run; strictDependencies: true also stops on any unmet dependency the sizing lists. For a lane (S54): root: "E:/mop-build/<lane>" (a git worktree with its own .env copy and bun install) and base: "origin/main" (the ref the slice branch starts from).',
  phases: [
    { title: 'Size', detail: 'read the plan and split its steps into groups one builder session can finish; mark the critical ones', model: 'sonnet' },
    { title: 'Build', detail: 'mop-builder works one group on the slice branch and pastes proof into the slice log (Sonnet high; Opus high for a critical group)', model: 'sonnet' },
    { title: 'Review', detail: 'a fresh Opus reviewer re-runs the proofs and tries to refute the claim of done', model: 'opus' },
    { title: 'Fix', detail: 'the builder repairs what the reviewer refuted, three rounds at most unless maxFixRounds says otherwise', model: 'sonnet' },
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
const branch = `slice/${slice.toLowerCase()}`

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
          needsOrchestrator: { type: 'string', description: 'empty, or what only the orchestrator may do after this group (merge to main, a production deploy, a secret to set by hand)' },
        },
        required: ['id', 'steps', 'title', 'files', 'proof', 'blocked', 'blockedOn', 'critical', 'needsOrchestrator'],
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
    costTime: { type: 'array', items: { type: 'string' }, description: 'everything that took a second attempt, a workaround or a correction of the plan, one line each; empty if truly nothing' },
    memory: { type: 'string' },
  },
  required: ['status', 'filesChanged', 'commits', 'proofs', 'watchedFail', 'unproven', 'blockedOn', 'gotchasAdded', 'costTime', 'memory'],
}

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['accept', 'reject'] },
    reran: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, observed: { type: 'string' }, pass: { type: 'boolean' } }, required: ['command', 'observed', 'pass'] } },
    defects: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, what: { type: 'string' }, evidence: { type: 'string' } }, required: ['file', 'what', 'evidence'] } },
  },
  required: ['verdict', 'reran', 'defects'],
}

const RULES = `Standing rules for this project (they overrule habit):
- Read ${ROOT}/GOTCHAS.md in full first. The operator's standing order (2026-10-02): the bank is ALWAYS updated. The moment a tool error, a failed approach, a wrong assumption, a plan line that did not match reality or a rework costs you more than a few minutes, add the entry to ${ROOT}/GOTCHAS.md in the same session (next free number, the template at the top of the file, a proof command), run \`node workspace/05-plans/check-gotchas.mjs\` from ${ROOT}, commit it with your work and name it in gotchasAdded. Finishing with "nothing went wrong" after a second attempt at anything is a defect.
- No Docker on this machine, ever (S50). There is one cloud database, the project named mop-dev: the build database now, production after the launch switch (ASSUMED H35). There is no R2: files live in Supabase Storage, buckets submissions, media and documents (H33). There is no Anthropic key: captions come from the laptop runner (H34).
- Facts measured on this machine are in ${ROOT}/workspace/05-plans/ASSUMED.md section E. They overrule older lines anywhere.
- Secrets live in ${ROOT}/.env (git-ignored). Load them without printing: set -a; . <(tr -d '\\r' < "${BASH_ROOT}/.env" | grep -E '^[A-Z0-9_]+='); set +a   Never cat, echo or paste a value. Never commit a secret.
${ROOT === MAIN ? '' : `- Your working tree is ${ROOT}, a git worktree of the repository (a lane of the 48-hour build, S54). Every path you read or write is under it. Never read, edit, check out or run git in ${MAIN}: other lanes and the orchestrator work there. A Supabase CLI command that needs the project link runs \`supabase link --project-ref "$DEV_SUPABASE_PROJECT_REF"\` in this tree's app folder first (the link is per folder). Never push an unmerged migration to mop-dev from a lane (ASSUMED section H, ruling DB-01): your database proof is the \`db\` job of CI on your pull request.\n`}- ${ROOT}/workspace/05-plans/STANDARDS.md binds every line you write: its folder map says where each file lives (a file that fits no row stops you: say so, do not invent a folder), its rules and mechanical gates are part of every proof. ASSUMED section H (the engineering review rulings) overrules older plan text; when a plan line cites a finding id (for example DB-01), its full text is in ${ROOT}/workspace/05-plans/review/${slice}.md.
- Write only what the step needs. No dead code, no speculative option or abstraction, no comment that restates the code, no swallowed error, no TODO left behind, no file outside the folder map, nothing committed that is build output, a log or a scratch file.- Work only on the branch ${branch}. Check \`git -C "${ROOT}" branch --show-current\` before every commit. Never commit to main, never merge, never force-push, never rewrite pushed history.
- One writer per file: touch only the files your group names, plus ${logPath} (append only).
- Every new test is watched-fail: break the code it covers, see it red for the right reason, restore.
- A red result is a valid result. Paste real output. Words to use: UNPROVEN, NOT DONE, BLOCKED. Two failed approaches to one obstacle ends the attempt: record BLOCKED and what would unblock it.
- Copy is calm and brief with no em dashes. Never edit src/routeTree.gen.ts by hand.`

phase('Size')
const sized = await agent(`${RULES}

You are sizing slice ${slice} for the builders. Read-only: change nothing.
Read ${planPath} in full, then ${ROOT}/workspace/05-plans/PLAN.md and ${ROOT}/workspace/05-plans/ASSUMED.md section E, and the tail of ${logPath} if it exists (earlier groups may already be done: leave those out).
1. Check the slice's "Depends on" line against the status table at the end of PLAN.md and the facts in ASSUMED section E. unmetDependencies holds ONLY what stops the whole slice from starting: another slice it depends on that the table does not show as closed, or an input without which not one step can run. A step or a part of a step that waits (on a later slice, an operator input, the custom domain) is NOT an unmet dependency: it goes into that group's blockedOn. A fact you think is stale in a document is not a dependency either: say it in the group title of the step it touches.
2. Split the plan's ordered steps into groups, in order. One group is what one builder session finishes and proves: usually one or two plan steps, at most about eight files. Keep steps that share files in the same group. Copy each group's proof commands from the plan verbatim.
3. Mark a group blocked ONLY when nothing in it can run today (every step in it is marked BLOCKED in the plan or needs something section E says does not exist); say on what. When only a part is blocked, keep blocked false, put the waiting part in blockedOn, and say in the title which part runs: the builder builds and proves the part that runs and records the rest as BLOCKED.
4. Set needsOrchestrator when the plan step merges to main, deploys production, sets a production secret by hand, or needs a decision.
5. Set critical to true when the group writes or changes any of: row level security policies, grants or security definer SQL functions; sign-in, sessions, tokens, CSRF, permissions or the authorization matrix; the job system's claim, lease, retry or idempotency logic; payment, invoice or credit state; cryptography or signature checks; the launch switch, the production guard or any destructive database command; secrets handling in CI or deploy workflows. Otherwise false. A critical group is built by the stronger model (operator decision S62).`, { label: `size:${slice}`, phase: 'Size', model: 'sonnet', effort: 'high', schema: GROUPS })

if (!sized) throw new Error('sizing agent failed')
log(`${slice}: ${sized.groups.length} groups, ${sized.groups.filter((g) => g.blocked).length} blocked, unmet dependencies: ${sized.unmetDependencies.join('; ') || 'none'}`)
if (a.dryRun) return { slice, dryRun: true, ...sized }
// The stop rule is mechanical (GOTCHAS P-061): what the sizing agent lists as unmet is information for the
// orchestrator; the slice stops here only when not one group can run, or when the orchestrator asks for a strict stop.
if (!sized.groups.some((g) => !g.blocked)) return { slice, stopped: 'no group can run', ...sized }
if (a.strictDependencies && sized.unmetDependencies.length) return { slice, stopped: 'unmet dependencies (strict)', ...sized }

let groups = sized.groups
// A group that was built and then rejected is closed first: closeOut = { id, steps, title, critical, defects }.
// Its steps are already in the slice log, so the sizing left them out; the builder gets the reviewer's defects.
// closeOut may be one object or a list; give each an id the sizing cannot produce (c6, c7) so `only` can name it.
const closing = [].concat(a.closeOut || []).map((c) => ({ id: c.id, steps: c.steps, title: c.title, files: [], proof: `every proof of plan steps ${c.steps}, as the plan writes them`, blocked: false, blockedOn: '', critical: Boolean(c.critical), needsOrchestrator: '', openDefects: c.defects }))
groups = [...closing, ...groups]
const MAX_FIX = Number.isInteger(a.maxFixRounds) ? a.maxFixRounds : 3
if (a.startAt) groups = groups.slice(Math.max(0, groups.findIndex((g) => g.id === a.startAt)))
if (a.only) groups = groups.filter((g) => a.only.includes(g.id))

const buildPrompt = (g, defects) => `${RULES}

You are building group ${g.id} of slice ${slice}: "${g.title}" (plan steps ${g.steps}).
The plan is ${planPath}. Read it in full, then ${ROOT}/workspace/05-plans/STANDARDS.md, then ${APP}/AGENTS.md, then only the spec sections the plan cites and the files you will touch.
Your files: ${g.files.join(', ') || '(as the plan lists for these steps)'}
Proof you must run and paste: ${g.proof}

${defects ? `A fresh reviewer rejected the previous attempt. Fix exactly these defects, then re-run every proof:\n${JSON.stringify(defects, null, 1)}\n` : `Start: \`git -C "${ROOT}" fetch -q origin && git -C "${ROOT}" checkout ${branch} 2>/dev/null || git -C "${ROOT}" checkout -b ${branch} ${BASE}\`. Confirm the branch before you write.`}
Build the steps in order. After each step run its proof. When the group is proven: run \`bun run check\` and \`bun run build\` in the app folder, commit on ${branch} with a message that names the slice and steps, push the branch (\`git push -u origin ${branch}\`).
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
5. The gotcha bank (the operator's standing order). For each line the author lists under costTime, and for anything in the slice log or the diff that shows a second attempt or a workaround, there must be an entry in ${ROOT}/GOTCHAS.md on this branch with a rule and a proof command: \`git -C "${ROOT}" diff ${BASE}...${branch} -- GOTCHAS.md\` shows it and \`node workspace/05-plans/check-gotchas.mjs\` run from ${ROOT} prints OK. A cost with no entry is a defect; say which. If something cost YOU time while reviewing, report it under defects with file "GOTCHAS.md" so the author adds it.
Verdict "accept" only if every proof reproduced and you found no defect that breaks the contract or the standards. Taste alone is not a defect.`

// S62: Sonnet 5.5 at high effort builds; Opus 5.5 at high effort builds a critical group and reviews every group.
const builderModel = (g) => (a.builderModel === 'opus' || g.critical || (a.opusGroups || []).includes(g.id) ? 'opus' : 'sonnet')
const out = []
for (const g of groups) {
  if (g.blocked) {
    out.push({ group: g.id, steps: g.steps, status: 'blocked', blockedOn: g.blockedOn })
    log(`${g.id} (steps ${g.steps}) BLOCKED on ${g.blockedOn}`)
    continue
  }
  let built = await agent(buildPrompt(g, g.openDefects || null), { label: `${g.openDefects ? 'close' : 'build'}:${slice}:${g.id}`, phase: g.openDefects ? 'Fix' : 'Build', model: builderModel(g), effort: 'high', agentType: 'mop-builder', schema: BUILD })
  if (!built) { out.push({ group: g.id, steps: g.steps, status: 'failed', blockedOn: 'builder agent died' }); break }
  let review = null
  let rounds = 0
  if (built.status !== 'blocked') {
    review = await agent(reviewPrompt(g, built), { label: `review:${slice}:${g.id}`, phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW })
    while (review && review.verdict === 'reject' && rounds < MAX_FIX) {
      rounds++
      const fixed = await agent(buildPrompt(g, review.defects), { label: `fix${rounds}:${slice}:${g.id}`, phase: 'Fix', model: builderModel(g), effort: 'high', agentType: 'mop-builder', schema: BUILD })
      if (!fixed) break
      built = fixed
      review = await agent(reviewPrompt(g, built), { label: `review${rounds + 1}:${slice}:${g.id}`, phase: 'Review', model: 'opus', effort: 'high', agentType: 'unit-reviewer', schema: REVIEW })
    }
  }
  const accepted = Boolean(review && review.verdict === 'accept')
  out.push({ group: g.id, steps: g.steps, status: built.status === 'blocked' ? 'blocked' : accepted ? 'accepted' : 'rejected', fixRounds: rounds, builder: builderModel(g), critical: Boolean(g.critical), built, review, needsOrchestrator: g.needsOrchestrator })
  log(`${g.id} (steps ${g.steps}): ${built.status}, review ${review ? review.verdict : 'not run'}, fix rounds ${rounds}`)
  if (!accepted) { log(`stopping after ${g.id}: later groups depend on it`); break }
  if (g.needsOrchestrator) { log(`stopping after ${g.id}: the orchestrator must act: ${g.needsOrchestrator}`); break }
}

const next = sized.groups.find((g) => !g.blocked && !out.some((o) => o.group === g.id && o.status === 'accepted'))
return { slice, branch, root: ROOT, base: BASE, log: logPath, groups: out, resumeWith: next ? { slice, startAt: next.id } : null, sizing: sized }
