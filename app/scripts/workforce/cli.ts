// The one way the laptop runs the operator's Claude CLI for the AI staff (W1 employees and W2 Matter): the prompt on
// stdin (a long positional argument makes the CLI wait for stdin), JSON out, stderr ignored, the whole process tree
// killed on timeout (Jay: a plain kill leaves the CLI's children running).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { z } from "zod";

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
});
export type CliUsage = z.infer<typeof usageSchema>;

const cliAnswer = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  session_id: z.string().optional(),
  // W2 step 6: the CLI's own token counts; the cost is ours to compute (growth.ts).
  usage: usageSchema.optional(),
});

/** The operator's Claude limit is spent: nothing can run until `resetAt` (gap audit item 32). */
export class UsageLimitError extends Error {
  readonly resetAt: Date;
  constructor(resetAt: Date) {
    super(`the Claude usage limit is reached until ${resetAt.toISOString()}`);
    this.name = "UsageLimitError";
    this.resetAt = resetAt;
  }
}

const LIMIT_TEXT = /usage limit|limit reached|rate limit|out of (extra )?usage|weekly limit/i;

/**
 * A usage-limit answer from the CLI, with its reset time: the "...|<epoch seconds>" the CLI prints, or an hour from
 * now when it gives none. Null for any other answer.
 */
export function usageLimitOf(text: string, now: Date = new Date()): Date | null {
  if (!LIMIT_TEXT.test(text)) return null;
  const epoch = /\|(\d{10})/.exec(text)?.[1];
  return epoch === undefined
    ? new Date(now.getTime() + 60 * 60_000)
    : new Date(Number(epoch) * 1000);
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
  else process.kill(-pid, "SIGKILL");
}

/** One headless CLI run; answers the result text and the session id, or fails with a reason fit for the chat. */
export function runClaude(input: {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  timeoutMs: number;
  /** Who timed out, in the words the office shows: "the colleague", "Matter". */
  who: string;
}): Promise<{ text: string; session?: string; usage?: CliUsage }> {
  const program = input.env["WORKFORCE_CLI"]?.trim() || "claude";
  return new Promise((done, fail) => {
    const child = spawn(program, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      killTree(child.pid);
      fail(
        new Error(
          `${input.who} took longer than ${String(Math.round(input.timeoutMs / 60_000))} minutes`,
        ),
      );
    }, input.timeoutMs);
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(new Error(`the Claude CLI did not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const limit = usageLimitOf(out);
      if (limit !== null && (code !== 0 || out.includes('"is_error":true'))) {
        fail(new UsageLimitError(limit));
        return;
      }
      if (code !== 0) {
        fail(new Error(`the Claude CLI exited with code ${String(code)}`));
        return;
      }
      try {
        const answer = cliAnswer.parse(JSON.parse(out));
        if (answer.is_error === true) {
          fail(new Error("the Claude CLI answered an error"));
          return;
        }
        done({
          text: answer.result,
          ...(answer.session_id === undefined ? {} : { session: answer.session_id }),
          ...(answer.usage === undefined ? {} : { usage: answer.usage }),
        });
      } catch {
        fail(new Error("the Claude CLI answer was not readable"));
      }
    });
    child.stdin.end(input.prompt);
  });
}

/** When the usage-limit breaker is set and its reset is still ahead, that reset; otherwise null (and the file goes). */
export function breakerUntil(file: string, now: Date = new Date()): Date | null {
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    const until =
      typeof raw === "object" && raw !== null && "until" in raw && typeof raw.until === "string"
        ? new Date(raw.until)
        : null;
    if (until !== null && until.getTime() > now.getTime()) return until;
  } catch {
    // An unreadable breaker is no breaker.
  }
  rmSync(file, { force: true });
  return null;
}
