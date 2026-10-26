// W6 item 4: Matter's lessons from building. A pull request he merges through the gate writes one lesson row (what
// broke in CI, what fixed it) to agent_lessons with source 'build', for Matter himself; the same recall that shows the
// operator's decisions (growth.ts: recallLessons, lessonsBlock) shows it in his next build prompt.
// - Starts it: the merge-gate command in Matter's live session (live.ts) or a number in the closing JSON of a one-shot
//   full-power run (daemon.ts). Either way GitHub is asked whether the pull request is merged; the claim is not trusted.
// - Reads: the account `gh` is signed in as, `gh pr view` (title, commits; every commit subject of his own pull request, H138 (7)), each
//   commit's failed GitHub Actions check runs and their annotations.
// - Writes: `record_build_lesson`, one row per pull request. A pull request CI never failed has nothing to learn from
//   and writes no row. Failure: a lesson that cannot be read or written is logged and dropped; it never stops a run.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Db } from "../../src/server/lib/db.ts";
import { lessonsBlock, recallLessons, type Lesson } from "../workforce/growth.ts";

const REPO = "AbdulrahmanAmer/matter-of-place";
/** The account Matter's `gh` is signed in as, and the owner of the repository: the only author of his own pull requests. */
const HIS_ACCOUNT = REPO.split("/")[0] ?? "";
const MAX_COMMITS = 20;
const MAX_PRS = 10;
/** Where a one-shot run leaves the numbers it merged for the live supervisor to settle (one number a line). */
const MERGES_FILE = join(homedir(), ".mop-workforce", "matter", "merges.queue");

/** `gh` with its arguments: the output, or null when the call failed. Injected so the rules run without GitHub. */
export type Gh = (args: string[]) => Promise<string | null>;

const run = promisify(execFile);

const ghCli: Gh = async (args) => {
  try {
    const { stdout } = await run("gh", args, {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
};

/** The pull request a shell command merges through the gate, or null: `node workspace/05-plans/merge-gate.mjs 464 ...`. */
export function mergeGatePr(command: string): number | null {
  const found = /merge-gate\.mjs\s+(\d+)\b/.exec(command);
  return found?.[1] === undefined ? null : Number(found[1]);
}

interface Failure {
  /** Index in the pull request's commits, oldest first, of the commit whose check failed. */
  commit: number;
  job: string;
  note: string;
}

interface Built {
  title: string;
  /**
   * Commit subjects, oldest first, of every commit on his own pull request: a commit's git author is whatever email
   * the committer typed, so it proves nothing; what vouches for the words is that he pushed them (H138 (7)).
   */
  subjects: readonly string[];
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`;
};

/**
 * The lesson of one merged pull request: the job that failed and the first thing CI said, then the commits made after
 * the first failure, which are what fixed it. Null when CI never failed.
 */
export function buildLesson(
  built: Built,
  failures: readonly Failure[],
): { trigger: string; action: string } | null {
  const first = failures.reduce<Failure | undefined>(
    (soonest, failure) =>
      soonest === undefined || failure.commit < soonest.commit ? failure : soonest,
    undefined,
  );
  if (first === undefined) return null;
  const jobs = [...new Set(failures.map((failure) => failure.job))].slice(0, 4);
  const note = failures.find((failure) => failure.note !== "")?.note ?? "";
  const later = built.subjects.slice(first.commit + 1);
  const fixes = later.slice(0, 4).map((subject) => oneLine(subject, 120));
  const fixed =
    fixes.length > 0 ? fixes.join("; ") : "no later commit, a rerun or a change outside the branch";
  return {
    trigger: oneLine(`A build like "${built.title}" failed CI at ${jobs.join(", ")}`, 300),
    action: oneLine(
      `What broke: ${note === "" ? "the job failed and left no message" : oneLine(note, 300)}. ` +
        `What fixed it: ${fixed}. ` +
        "Check for this before you push.",
      1000,
    ),
  };
}

const prSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  author: z.object({ login: z.string() }),
  /** True for a branch of a fork; null owner when the fork is gone. */
  isCrossRepository: z.boolean(),
  headRepositoryOwner: z.object({ login: z.string() }).nullable(),
  commits: z.array(z.object({ oid: z.string(), messageHeadline: z.string() })),
});

const same = (login: string | undefined) => login?.toLowerCase() === HIS_ACCOUNT.toLowerCase();

/**
 * Whether a pull request is Matter's own: a branch of this repository, by his account. Its title, commit subjects and CI
 * messages become a directive in his full-power prompt, so text from anyone else's pull request never gets there (H101).
 */
function isHis(view: {
  author: { login: string };
  isCrossRepository: boolean;
  headRepositoryOwner: { login: string } | null;
}): boolean {
  return (
    !view.isCrossRepository && same(view.headRepositoryOwner?.login) && same(view.author.login)
  );
}

/** The account `gh` is signed in as, read once per `gh` (once a process for the real one); null when it cannot be read. */
const signedIn = new WeakMap<Gh, string>();

async function accountOf(gh: Gh): Promise<string | null> {
  const known = signedIn.get(gh);
  if (known !== undefined) return known;
  const login = (await gh(["api", "user", "--jq", ".login"]))?.trim() ?? "";
  if (login === "") return null;
  signedIn.set(gh, login);
  return login;
}

/** Only GitHub Actions runs this repository's CI; a check of any other App carries words nobody here wrote. */
const CI_APP = "github-actions";
const failedRuns = z.array(
  z.object({ id: z.number().int(), name: z.string(), app: z.string().nullable() }),
);
const messages = z.array(z.string());

/** `gh`'s JSON output read against its schema; null when the call failed or the answer is not what was asked for. */
function read<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (raw === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every failed check of every commit of the pull request (the latest MAX_COMMITS), with the first message CI gave. */
async function failuresOf(gh: Gh, oids: readonly string[], offset: number): Promise<Failure[]> {
  const found: Failure[] = [];
  for (const [index, oid] of oids.entries()) {
    const raw = await gh([
      "api",
      `repos/${REPO}/commits/${oid}/check-runs?per_page=100`,
      "--jq",
      '[.check_runs[] | select(.conclusion == "failure") | {id, name, app: .app.slug}]',
    ]);
    const ours = (read(raw, failedRuns) ?? []).filter((check) => check.app === CI_APP);
    for (const check of ours) {
      const notes = await gh([
        "api",
        `repos/${REPO}/check-runs/${String(check.id)}/annotations`,
        "--jq",
        "[.[].message]",
      ]);
      found.push({
        commit: offset + index,
        job: check.name,
        note: oneLine((read(notes, messages) ?? []).find((line) => line.trim() !== "") ?? "", 300),
      });
    }
  }
  return found;
}

type Recorded =
  | "recorded"
  | "recorded before"
  | "no CI failure"
  | "not merged"
  | "not his"
  | "unreadable"
  | "not written"
  | "signed in as another account"
  | "signed-in account unknown";

/**
 * Writes the lesson of one pull request. "not merged" and "unreadable" can change (the gate may still be merging, GitHub
 * may answer later), so the caller may ask again; every other answer is final. Fails closed when `gh` is not signed in
 * as his account: the login checks below compare names, and a renamed account would hand his name to a stranger.
 */
export async function recordBuildLesson(
  db: Db,
  matterId: string,
  pr: number,
  gh: Gh = ghCli,
): Promise<Recorded> {
  const account = await accountOf(gh);
  if (account === null) return "signed-in account unknown";
  if (!same(account)) return "signed in as another account";
  const raw = await gh([
    "pr",
    "view",
    String(pr),
    "--repo",
    REPO,
    "--json",
    "number,title,state,author,isCrossRepository,headRepositoryOwner,commits",
  ]);
  const view = read(raw, prSchema);
  if (view === null) return "unreadable";
  if (view.state !== "MERGED") return "not merged";
  if (!isHis(view)) return "not his";
  const recent = view.commits.slice(-MAX_COMMITS);
  const failures = await failuresOf(
    gh,
    recent.map((commit) => commit.oid),
    view.commits.length - recent.length,
  );
  const lesson = buildLesson(
    {
      title: view.title,
      subjects: view.commits.map((commit) => commit.messageHeadline),
    },
    failures,
  );
  if (lesson === null) return "no CI failure";
  const { data, error } = await db.rpc("record_build_lesson", {
    p_agent: matterId,
    p_pr: pr,
    p_trigger: lesson.trigger,
    p_action: lesson.action,
  });
  if (error !== null) return "not written";
  return data ? "recorded" : "recorded before";
}

/** What a one-shot run may name as merged: only Matter at full power, which a signed-in person's line gives (H100, H101). */
export function mergedByRun(
  isMatter: boolean,
  power: "full" | "read",
  merged: readonly number[] | undefined,
): number[] {
  return isMatter && power === "full" ? [...(merged ?? [])] : [];
}

/**
 * A one-shot run names the pull requests it merged; it does not ask GitHub itself, because the gate may still be merging
 * and a slow GitHub must not hold the run. The numbers wait in a file for the live supervisor, which asks again for half
 * an hour. At most ten a run, each once; a file that cannot be written drops the lesson, never the run.
 */
export function queueMerges(prs: readonly number[], file = MERGES_FILE): number[] {
  const queued = [...new Set(prs)].slice(0, MAX_PRS);
  if (queued.length === 0) return [];
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, queued.map((pr) => `${String(pr)}\n`).join(""));
    return queued;
  } catch {
    return [];
  }
}

/** The numbers a one-shot run queued, taken out of the file (renamed first, so a run writing now starts a new file). */
export function takeQueuedMerges(file = MERGES_FILE): number[] {
  const taken = `${file}.${String(process.pid)}`;
  try {
    renameSync(file, taken);
  } catch {
    return [];
  }
  try {
    const numbers = readFileSync(taken, "utf8")
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pr) => Number.isInteger(pr) && pr > 0);
    return [...new Set(numbers)];
  } catch {
    return [];
  } finally {
    rmSync(taken, { force: true });
  }
}

/**
 * A merge Matter's live session started, waiting for GitHub to say it is merged. The gate runs in the background, so
 * the merge can land after the turn that started it; a number is asked again until it is merged or half an hour old.
 */
const PENDING_MS = 30 * 60_000;

export function stillPending(answer: Recorded, firstSeenAt: number, now: number): boolean {
  return (answer === "not merged" || answer === "unreadable") && now - firstSeenAt < PENDING_MS;
}

/** The lessons Matter is shown at the start of a live session: his own and the team's, ranked like any colleague's. */
export async function recallForMatter(
  db: Db,
  matterId: string,
  situation: string,
): Promise<{ shown: Lesson[]; block: string }> {
  const { data } = await db
    .from("agent_lessons")
    .select("id, trigger, action, uses, last_used_at, created_at, source")
    .eq("status", "active")
    .or(`agent_id.eq.${matterId},agent_id.is.null`);
  const shown = recallLessons(data ?? [], situation);
  return { shown, block: lessonsBlock(shown) };
}

/** A lesson shown is a lesson used: its count ranks it. */
export async function markUsed(db: Db, shown: readonly Lesson[]): Promise<void> {
  const now = new Date().toISOString();
  for (const lesson of shown) {
    await db
      .from("agent_lessons")
      .update({ uses: lesson.uses + 1, last_used_at: now })
      .eq("id", lesson.id);
  }
}
