import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  LEDGER_PATH,
  PANELISTS,
  SEVERITIES,
  findingProblems,
  ledgerProblems,
  openAboveLow,
} from "./run.mjs";

// The acceptance panel as one team (plan H2 step 3): three headless Claude sessions, one per charter, take turns in
// rounds. Each turn is one `claude -p` call on the panelist's own session (resumed, so it keeps what it saw), with
// read-only tools, and answers in one JSON shape: a message to the other two, new finding rows, votes on rows,
// the areas it did not walk, and whether it is done. This script is the only writer of the ledger: it numbers the
// rows, applies the two-of-three severity rule, relays every message to the H2 log and ends the pass by the stop rule.
//   node workspace/05-plans/acceptance/team.mjs --pass smoke|<n> [--rounds <n>] [--url <deploy>] [--ledger <path>] [--log <path>]
// Load the shell the way probe.mjs says first: the panelists inherit it and the probes read their credentials from it.
// `--pass smoke` is the dry run: two rounds, one page each, a throwaway ledger under scratch/acceptance.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const LOG_PATH = join(REPO_ROOT, "workspace/05-plans/logs/H2.md");
const SMOKE_LEDGER_PATH = join(REPO_ROOT, "scratch/acceptance/ledger-smoke.json");
const MODEL = "claude-opus-5-5";
const EFFORT = "high";
const TURN_TIMEOUT_MS = 25 * 60_000;
const DEFAULT_ROUNDS = 6;
const SMOKE_ROUNDS = 2;
const MESSAGE_LOG_LIMIT = 2500;
const ABOVE_LOW = SEVERITIES.slice(0, 3);
const SMOKE_PAGES = {
  "senior-engineer": "/",
  "security-specialist": "/contact",
  "user-journey": "/california",
};

// Read-only by tools, not by a sandbox: Read, Glob and Grep, and a bash that matches one of these patterns exactly.
// A command with a pipe, a redirect or `;` does not match and is refused (permission mode dontAsk).
const TOOLS = ["Read", "Glob", "Grep", "Bash"];
const ALLOWED = [
  "Read",
  "Glob",
  "Grep",
  "Bash(node workspace/05-plans/acceptance/probe.mjs *)",
  "Bash(node workspace/05-plans/standards-index.mjs*)",
  "Bash(bun run --cwd app audit:deps*)",
];
const DENIED = ["Read(**/.env*)", "Read(**/.dev.vars*)"];

const TEXT = { type: "string" };
const TURN_SCHEMA = {
  type: "object",
  properties: {
    message: TEXT,
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: TEXT,
          title: TEXT,
          evidence: TEXT,
          proof: TEXT,
          severity: { type: "string", enum: SEVERITIES },
          reason: TEXT,
          slice: {
            type: "string",
            description:
              'the id of the plan slice that owns the fix, such as "B7" or "H1", nothing else',
          },
          steps: {
            type: "string",
            description: 'the plan step numbers of the fix, such as "4" or "4-5"',
          },
          files: {
            type: "array",
            items: TEXT,
            description: "the repository paths the fix group changes",
          },
        },
        required: [
          "area",
          "title",
          "evidence",
          "proof",
          "severity",
          "reason",
          "slice",
          "steps",
          "files",
        ],
      },
    },
    votes: {
      type: "array",
      items: {
        type: "object",
        properties: { id: TEXT, severity: { type: "string", enum: SEVERITIES }, reason: TEXT },
        required: ["id", "severity", "reason"],
      },
    },
    unwalked: { type: "array", items: TEXT },
    done: { type: "boolean" },
  },
  required: ["message", "findings", "votes", "unwalked", "done"],
};

/**
 * @typedef {import("./run.mjs").Finding} Finding
 * @typedef {{
 *   message: string, findings: Array<Record<string, unknown>>, votes: Array<Record<string, unknown>>,
 *   unwalked: string[], done: boolean,
 * }} Turn the answer of one panelist's turn
 * @typedef {(panelist: string, prompt: string) => Promise<{ turn: Turn, costUsd: number }>} Send
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value @returns {string} */
const text = (value) => (typeof value === "string" ? value.trim() : "");

/** @param {Finding[]} findings @returns {string} */
const nextId = (findings) => {
  const last = Math.max(0, ...findings.map((f) => Number(f.id.slice(2))));
  return `F-${String(last + 1).padStart(3, "0")}`;
};

/**
 * The two-of-three rule on one undecided row: two distinct panelists on one severity decide it, three votes with no
 * two alike leave it for the orchestrator's ruling.
 * @param {Finding} row
 * @returns {"decided" | "split" | "waiting"}
 */
function decide(row) {
  const severity = SEVERITIES.find(
    (candidate) => row.votes.filter((vote) => vote.severity === candidate).length >= 2,
  );
  if (severity !== undefined) {
    row.severity = severity;
    row.status = "open";
    return "decided";
  }
  return row.votes.length >= PANELISTS.length ? "split" : "waiting";
}

/**
 * The problems of one new finding a panelist hands in, or an empty list when it can become a row.
 * @param {Record<string, unknown>} item
 * @returns {string[]}
 */
function newFindingProblems(item) {
  /** @type {string[]} */
  const problems = [];
  for (const key of ["area", "title", "evidence", "reason"]) {
    if (text(item[key]) === "") problems.push(`${key} is empty`);
  }
  if (!SEVERITIES.includes(text(item["severity"]))) problems.push("severity is not one of four");
  if (text(item["proof"]) !== "") {
    if (!/^(B|H|L)[0-9a-z]+$/i.test(text(item["slice"]))) {
      problems.push(
        `slice must be the id of the slice that owns the fix, such as "B7" or "H1" (got "${text(item["slice"])}")`,
      );
    }
    if (text(item["steps"]) === "") problems.push("steps is empty");
    const files = item["files"];
    if (!Array.isArray(files) || files.length === 0 || !files.every((f) => text(f) !== "")) {
      problems.push("files must list the fix group's files");
    }
  }
  return problems;
}

/**
 * Applies one turn to the ledger (in place). A new finding with a proof enters as a `question` holding its author's
 * vote and becomes `open` when a second panelist votes the same severity; one without a proof stays a question with
 * no votes. Returns what the log and the panelist's next turn should say.
 * @param {Finding[]} findings
 * @param {string} panelist
 * @param {Turn} turn
 * @param {{ allowNew: boolean }} options
 * @returns {{ events: string[], notes: string[], rejected: number }} events go to the log, notes go back to the panelist,
 *   rejected counts the new findings refused for a defect the panelist can correct
 */
export function applyTurn(findings, panelist, turn, { allowNew }) {
  /** @type {string[]} */
  const events = [];
  /** @type {string[]} */
  const notes = [];
  let rejected = 0;
  for (const item of turn.findings) {
    if (!allowNew) {
      notes.push(
        `a new finding ("${text(item["title"])}") was not taken: this round takes votes and answers only`,
      );
      continue;
    }
    const problems = isRecord(item) ? newFindingProblems(item) : ["not an object"];
    if (problems.length > 0) {
      rejected += 1;
      notes.push(`a new finding ("${text(item["title"])}") was not taken: ${problems.join("; ")}`);
      continue;
    }
    const proven = text(item["proof"]) !== "";
    /** @type {Finding} */
    const row = {
      id: nextId(findings),
      panelist,
      area: text(item["area"]),
      severity: null,
      votes: proven
        ? [{ panelist, severity: text(item["severity"]), reason: text(item["reason"]) }]
        : [],
      title: text(item["title"]),
      evidence: text(item["evidence"]),
      status: "question",
    };
    if (proven) {
      row.proof = text(item["proof"]);
      row.slice = text(item["slice"]);
      row.steps = text(item["steps"]);
      row.files = /** @type {string[]} */ (item["files"]).map(text);
    }
    findings.push(row);
    events.push(
      proven
        ? `new ${row.id} (${panelist} proposes ${text(item["severity"])}): ${row.title}`
        : `new ${row.id} (a question, no proof): ${row.title}`,
    );
  }
  for (const item of turn.votes) {
    const row = findings.find((f) => f.id === text(item["id"]));
    const severity = text(item["severity"]);
    if (row === undefined) notes.push(`vote on ${text(item["id"])} ignored: no such row`);
    else if (row.proof === undefined) notes.push(`vote on ${row.id} ignored: it has no proof yet`);
    else if (row.status !== "question") notes.push(`vote on ${row.id} ignored: it is decided`);
    else if (row.votes.some((vote) => vote.panelist === panelist)) {
      notes.push(`vote on ${row.id} ignored: you voted already`);
    } else if (!SEVERITIES.includes(severity) || text(item["reason"]) === "") {
      notes.push(`vote on ${row.id} ignored: it needs a severity and its reason`);
    } else {
      row.votes.push({ panelist, severity, reason: text(item["reason"]) });
      events.push(`vote ${row.id} ${severity} (${panelist})`);
      const outcome = decide(row);
      if (outcome === "decided") {
        events.push(`${row.id} decided ${String(row.severity)}, now open`);
      } else if (outcome === "split") {
        events.push(`${row.id} NEEDS THE ORCHESTRATOR'S RULING: three votes, no two alike`);
      }
    }
  }
  return { events, notes, rejected };
}

/**
 * The rows still waiting for this panelist's vote: a proven question the panelist has not voted on.
 * @param {Finding[]} findings
 * @param {string} panelist
 * @returns {string[]}
 */
const waitingFor = (findings, panelist) =>
  findings
    .filter(
      (f) =>
        f.status === "question" &&
        f.proof !== undefined &&
        !f.votes.some((vote) => vote.panelist === panelist),
    )
    .map((f) => f.id);

/**
 * A pass is clean when no row is open above `low` and no row of this pass carries a vote above `low` that is not
 * overruled by a decided `low`.
 * @param {Finding[]} findings
 * @param {number} before how many rows the ledger held when the pass began
 * @returns {boolean}
 */
export function passIsClean(findings, before) {
  const heavy = findings
    .slice(before)
    .filter((f) =>
      f.severity === null
        ? f.votes.some((vote) => ABOVE_LOW.includes(vote.severity))
        : ABOVE_LOW.includes(f.severity),
    );
  return openAboveLow(findings).length === 0 && heavy.length === 0;
}

/**
 * The stop rule of the panel: the last two numbered passes in the log are clean and ran on different days.
 * @param {string} logText
 * @returns {boolean}
 */
export function stopRuleMet(logText) {
  const verdicts = [
    ...logText.matchAll(/^pass-verdict: (\d+) (\d{4}-\d{2}-\d{2}) (clean|not-clean)$/gm),
  ].map((m) => ({ date: m[2], clean: m[3] === "clean" }));
  const [first, second] = verdicts.slice(-2);
  return (
    first !== undefined &&
    second !== undefined &&
    first.clean &&
    second.clean &&
    first.date !== second.date
  );
}

/** @param {Finding} f @returns {string} */
const digestLine = (f) => {
  const votes = f.votes.map((vote) => `${vote.panelist}=${vote.severity}`).join(", ") || "none";
  const state = f.severity === null ? f.status : `${f.status} ${f.severity}`;
  return `${f.id} [${state}] by ${f.panelist}, votes: ${votes}. ${f.title}`;
};

const PROTOCOL = `How this team works:
- You have read-only tools: Read, Glob and Grep, and these commands, each run alone (a pipe, a redirect, \`;\` or \`&&\` is refused): \`node workspace/05-plans/acceptance/probe.mjs <page|journey|db|logs|sentry|advisors> ...\`, \`node workspace/05-plans/standards-index.mjs\` and \`bun run --cwd app audit:deps\`. You cannot edit a file. A secret you meet is named by place and never copied.
- You do not write the ledger. You hand rows in as JSON and the team script numbers them. A finding is a row only with a proof a person can re-run (a command, a URL and the observed line, a SQL query); without a proof, leave "proof" empty and it stays a question. Name the slice that owns the fix ("B7"), the plan steps, and the files.
- Severity: critical (data loss, security, money), high (a journey cannot be completed, a wrong fact shown), medium (a journey is confusing or slow, a standard not met), low (polish). A row you hand in carries your own severity and reason as your vote. It becomes open when a second panelist votes the same severity. Three votes with no two alike go to the orchestrator.
- The other two read your message and answer it in their turns. Say what they need from you: what you saw, what you disagree with, what you ask them to check. Write plainly, no em dashes.
- Every turn you answer with the JSON of the schema. "done" means you have nothing more to add this pass and every row waiting for your vote has it.`;

/**
 * The text one panelist receives for one turn.
 * @param {{
 *   panelist: string, round: number, pass: string, charter: string, task: string, findings: Finding[],
 *   inbox: string[], notes: string[], deployed: string, allowNew: boolean,
 * }} input
 * @returns {string}
 */
export function turnPrompt(input) {
  const others = PANELISTS.filter((name) => name !== input.panelist);
  const parts = [];
  if (input.round === 1) {
    parts.push(
      `You are the ${input.panelist} of the acceptance panel of Matter of Place (plan H2). Beside you: ${others.join(" and ")}. The probes look at ${input.deployed}.`,
      `Your charter:\n\n${input.charter.trim()}`,
      PROTOCOL,
    );
  }
  parts.push(`Pass ${input.pass}, round ${String(input.round)}. ${input.task}`);
  if (!input.allowNew)
    parts.push("This round takes votes and answers only: hand in no new finding.");
  parts.push(
    input.inbox.length > 0
      ? `Since your last turn the others said:\n${input.inbox.join("\n\n")}`
      : "The others have said nothing yet.",
  );
  parts.push(`The ledger now:\n${input.findings.map(digestLine).join("\n") || "(no rows)"}`);
  const waiting = waitingFor(input.findings, input.panelist);
  if (waiting.length > 0) parts.push(`Rows waiting for your vote: ${waiting.join(", ")}.`);
  if (input.notes.length > 0) {
    parts.push(`The script on your last turn:\n- ${input.notes.join("\n- ")}`);
  }
  return parts.join("\n\n");
}

/** @param {Date} now @returns {string} 2026-10-11 10:21 +0300 */
function stamp(now) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${zone}`;
}

/**
 * One pass: rounds of turns in the order of PANELISTS until every panelist is done in the same round, or the rounds
 * run out. The ledger is written and the log appended after every turn.
 * @param {{
 *   pass: string, send: Send, charters: Record<string, string>, ledgerPath: string, logPath: string,
 *   maxRounds: number, now: () => Date, deployed: string, tasks: Record<string, string>, smoke: boolean,
 * }} options
 * @returns {Promise<{ clean: boolean, rounds: number, added: number, costUsd: number, needRuling: string[] }>}
 */
export async function runPass(options) {
  const { pass, send, charters, ledgerPath, logPath, maxRounds, now, deployed } = options;
  /** @type {{ findings: Finding[] }} */
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const before = ledger.findings.length;
  const relay = (/** @type {string} */ block) => {
    appendFileSync(logPath, `${block}\n`);
  };
  relay(`\n## panel · pass ${pass} · ${stamp(now())}\n`);
  relay(
    `Probes aimed at ${deployed}. Panelists: ${PANELISTS.join(", ")}, each on ${MODEL} at ${EFFORT} effort, read-only tools. Ledger: ${ledgerPath}.\n`,
  );
  /** @type {Record<string, string[]>} */
  const inbox = Object.fromEntries(PANELISTS.map((name) => [name, []]));
  /** @type {Record<string, string[]>} */
  const notes = Object.fromEntries(PANELISTS.map((name) => [name, []]));
  let costUsd = 0;
  let rounds = 0;
  /**
   * One call of a panelist, applied to the ledger and relayed to the log.
   * @param {string} panelist
   * @param {string} prompt
   * @param {{ round: number, allowNew: boolean, heading: string }} where
   */
  const takeTurn = async (panelist, prompt, { round, allowNew, heading }) => {
    const { turn, costUsd: cost } = await send(panelist, prompt);
    costUsd += cost;
    const result = applyTurn(ledger.findings, panelist, turn, { allowNew });
    const problems = ledgerProblems(ledger);
    if (problems.length > 0)
      throw new Error(`the ledger would be invalid:\n${problems.join("\n")}`);
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    inbox[panelist] = [];
    const message = text(turn.message);
    for (const other of PANELISTS.filter((name) => name !== panelist)) {
      if (message !== "") inbox[other]?.push(`${panelist}: ${message}`);
    }
    relay(
      [
        `### round ${String(round)} · ${panelist}${heading} · ${stamp(now())}`,
        "",
        message === "" ? "(no message)" : message.slice(0, MESSAGE_LOG_LIMIT),
        ...result.events.map((event) => `- ${event}`),
        ...result.notes.map((note) => `- script: ${note}`),
        ...(turn.unwalked.length > 0 ? [`- not walked: ${turn.unwalked.join("; ")}`] : []),
        "",
      ].join("\n"),
    );
    return { turn, result };
  };
  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    /** @type {string[]} */
    const done = [];
    const allowNew = !options.smoke || round === 1;
    for (const panelist of PANELISTS) {
      const prompt = turnPrompt({
        panelist,
        round,
        pass,
        charter: charters[panelist] ?? "",
        task: options.tasks[panelist] ?? "",
        findings: ledger.findings,
        inbox: inbox[panelist] ?? [],
        notes: notes[panelist] ?? [],
        deployed,
        allowNew,
      });
      let taken = await takeTurn(panelist, prompt, { round, allowNew, heading: "" });
      let finished = taken.turn.done === true;
      if (taken.result.rejected > 0) {
        const again = `The script took part of your last turn:\n- ${taken.result.notes.join("\n- ")}\nHand in the refused rows again, corrected, and only those: what it took stays as it is. Leave "message" empty unless you have something new for the others.`;
        taken = await takeTurn(panelist, again, { round, allowNew, heading: " (correction)" });
        finished ||= taken.turn.done === true;
      }
      notes[panelist] = taken.result.notes;
      const waiting = waitingFor(ledger.findings, panelist);
      if (finished && waiting.length === 0) done.push(panelist);
      else if (finished)
        notes[panelist]?.push(`you said done, but ${waiting.join(", ")} still wait for your vote`);
    }
    if (!options.smoke && done.length === PANELISTS.length) break;
  }
  const needRuling = ledger.findings
    .filter((f) => f.status === "question" && f.votes.length >= PANELISTS.length)
    .map((f) => f.id);
  const clean = passIsClean(ledger.findings, before);
  const added = ledger.findings.length - before;
  const date = stamp(now()).slice(0, 10);
  relay(
    [
      `Pass ${pass}: ${String(rounds)} round(s), ${String(added)} new row(s), ${String(openAboveLow(ledger.findings).length)} open above low, cost about $${costUsd.toFixed(2)}.`,
      needRuling.length > 0
        ? `Waiting for the orchestrator's ruling: ${needRuling.join(", ")}.`
        : "",
      `pass-verdict: ${pass} ${date} ${clean ? "clean" : "not-clean"}`,
      "",
    ].join("\n"),
  );
  return { clean, rounds, added, costUsd, needRuling };
}

/**
 * A sender that talks to `claude -p`: the first turn of a panelist opens its session, every later one resumes it.
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} context
 * @returns {Send}
 */
function claudeSender({ cwd, env }) {
  /** @type {Map<string, string>} */
  const sessions = new Map();
  /** @param {string[]} args @param {string} prompt @returns {Promise<string>} */
  const run = (args, prompt) =>
    new Promise((resolve, reject) => {
      const child = spawn("claude", args, {
        cwd,
        env,
        windowsHide: true,
        signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.stdin.on("error", reject);
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(stdout)
          : reject(new Error(`claude exited ${String(code)}: ${stderr.slice(0, 500)}`)),
      );
      child.stdin.end(prompt);
    });
  return async (panelist, prompt) => {
    const known = sessions.get(panelist);
    const id = known ?? randomUUID();
    const args = [
      "-p",
      "--safe-mode",
      "--model",
      MODEL,
      "--effort",
      EFFORT,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(TURN_SCHEMA),
      "--permission-mode",
      "dontAsk",
      "--tools",
      TOOLS.join(","),
      "--allowedTools",
      ...ALLOWED,
      "--disallowedTools",
      ...DENIED,
      ...(known === undefined ? ["--session-id", id] : ["--resume", id]),
    ];
    const raw = JSON.parse(await run(args, prompt));
    if (!isRecord(raw) || raw["is_error"] === true || !isRecord(raw["structured_output"])) {
      throw new Error(`${panelist}: no structured answer (${text(raw?.["result"]).slice(0, 300)})`);
    }
    sessions.set(panelist, id);
    return {
      turn: /** @type {Turn} */ (raw["structured_output"]),
      costUsd: typeof raw["total_cost_usd"] === "number" ? raw["total_cost_usd"] : 0,
    };
  };
}

/** @returns {Promise<number>} */
async function main() {
  const { values } = parseArgs({
    options: {
      pass: { type: "string" },
      rounds: { type: "string" },
      url: { type: "string" },
      ledger: { type: "string" },
      log: { type: "string" },
    },
  });
  const pass = values.pass ?? "";
  const smoke = pass === "smoke";
  if (!smoke && !/^[1-9]\d*$/.test(pass)) {
    console.error(
      "usage: team.mjs --pass smoke|<number> [--rounds <n>] [--url <deploy>] [--ledger <path>] [--log <path>]",
    );
    return 2;
  }
  const logPath = values.log ?? LOG_PATH;
  if (!smoke && stopRuleMet(readFileSync(logPath, "utf8"))) {
    console.log("stop rule met: the last two passes were clean on different days; no pass runs");
    return 0;
  }
  let ledgerPath = values.ledger ?? LEDGER_PATH;
  if (smoke) {
    ledgerPath = values.ledger ?? SMOKE_LEDGER_PATH;
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${JSON.stringify({ findings: [] }, null, 2)}\n`);
  }
  const problems = ledgerProblems(JSON.parse(readFileSync(ledgerPath, "utf8")));
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    return 2;
  }
  const maxRounds = Number(values.rounds ?? (smoke ? SMOKE_ROUNDS : DEFAULT_ROUNDS));
  const charters = Object.fromEntries(
    PANELISTS.map((name) => [name, readFileSync(join(HERE, "charters", `${name}.md`), "utf8")]),
  );
  const tasks = Object.fromEntries(
    PANELISTS.map((name) => [
      name,
      smoke
        ? `SMOKE PASS, a short test of the team and not a walk. Round 1: read exactly one page, run \`node workspace/05-plans/acceptance/probe.mjs page ${SMOKE_PAGES[/** @type {keyof typeof SMOKE_PAGES} */ (name)]}\` once, then hand in exactly one finding from what it printed, in the area of your charter, with that command and the line you observed as its proof. If the page shows nothing wrong, the finding is a \`low\` note about it, and says so. Round 2: read what the others said and the rows they handed in, vote on every row waiting for your vote with your charter's yardstick, and answer the others by name in your message. Set "done" true in round 2.`
        : 'Walk the whole product in the area of your charter, hand in findings with proofs, vote on the rows the others hand in, answer them, and set "done" when you have nothing more to add.',
    ]),
  );
  const env = { ...process.env };
  if (values.url !== undefined) env["ACCEPTANCE_URL"] = values.url;
  const deployed = env["ACCEPTANCE_URL"] ?? "the dev deploy named at the top of probe.mjs";
  const result = await runPass({
    pass,
    send: claudeSender({ cwd: REPO_ROOT, env }),
    charters,
    ledgerPath,
    logPath,
    maxRounds,
    now: () => new Date(),
    deployed,
    tasks,
    smoke,
  });
  console.log(
    `pass ${pass}: ${String(result.rounds)} round(s), ${String(result.added)} new row(s), ${result.clean ? "clean" : "not clean"}, cost about $${result.costUsd.toFixed(2)}; ledger ${ledgerPath}; log ${logPath}`,
  );
  if (result.needRuling.length > 0) console.log(`needs a ruling: ${result.needRuling.join(", ")}`);
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
