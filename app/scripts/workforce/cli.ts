// The one way the laptop runs the operator's Claude CLI for the AI staff (W1 employees and W2 Matter): the prompt on
// stdin (a long positional argument makes the CLI wait for stdin), JSON or stream-JSON out, stderr ignored, the whole
// process tree killed when a run is stopped (Jay: a plain kill leaves the CLI's children running).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * W8 fourth review: a CLI run that may read outside-shaped text is shut off from the operator's own setup. No
 * setting source (the operator's settings allow every tool without asking), no MCP server, writes kept inside its
 * folder, and under `dontAsk` every tool refused except `allowed` (built-in tools limited to the same list). Used by
 * the triage, the weekly review's replay and the daily meeting. `home` holds the empty MCP config.
 */
export function isolatedArgs(home: string, allowed = ""): string[] {
  // the folder may not exist yet (a fresh machine, CI): made first, so the empty MCP config can be written
  mkdirSync(home, { recursive: true });
  const noMcp = join(home, "no-mcp.json");
  if (!existsSync(noMcp)) writeFileSync(noMcp, JSON.stringify({ mcpServers: {} }));
  return [
    ...["--tools", allowed, "--setting-sources", ""],
    ...["--strict-mcp-config", "--mcp-config", noMcp, "--restricted"],
    ...["--permission-mode", "dontAsk", "--allowedTools", allowed],
  ];
}

/**
 * P-4691: the command line of the one retry of an answer that is not a valid outcome (`readRunAnswer`): the run's model,
 * shut off like the triage (`isolatedArgs`, no tool at all), nothing saved. No `--json-schema`: measured on CLI 2.1.296
 * (2026-10-28), a schema of only `reply` made the retry put the whole object, as a string, inside `reply`, 4 runs of 4.
 */
export function retryArgs(home: string, model: string): string[] {
  return [
    ...["-p", "--model", model, "--output-format", "json", "--no-session-persistence"],
    ...isolatedArgs(home),
  ];
}

export const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
});
export type CliUsage = z.infer<typeof usageSchema>;

/** Two calls of one run counted as one (P-4691: an unreadable answer's retry is the run's usage too). */
export function addUsage(a: CliUsage | undefined, b: CliUsage | undefined): CliUsage | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  };
}

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
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
    return;
  }
  // The child is not started detached, so it has no process group of its own and `kill(-pid)` throws ESRCH (seen on
  // CI's Linux, 2026-10-15); fall back to the process itself, and never throw for one already gone.
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/**
 * The final answer of a run: the one JSON object of `--output-format json`, or the `result` line of
 * `--output-format stream-json` (one JSON object per line, the result last).
 */
function answerOf(out: string): unknown {
  const whole = out.trim();
  try {
    return JSON.parse(whole);
  } catch {
    const lines = whole.split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        const event: unknown = JSON.parse(line);
        if (
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "result"
        )
          return event;
      } catch {
        // A partial or non-JSON line is not the answer.
      }
    }
    throw new Error("no result");
  }
}

const minutes = (ms: number): string => String(Math.round(ms / 60_000));

/**
 * One headless CLI run; answers the result text and the session id, or fails with a reason fit for the chat.
 * `idleMs` stops a run only when it has printed nothing for that long (a stuck run), never a run that is still working
 * (operator, 2026-10-15: agent work is not limited by a clock); with stream-json every message and tool use prints a
 * line. `timeoutMs` is a hard cap for the few callers that want one (a meeting, a review).
 */
export function runClaude(input: {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  timeoutMs?: number;
  idleMs?: number;
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
    let stopped = false;
    const stop = (reason: string): void => {
      stopped = true;
      fail(new Error(reason));
      killTree(child.pid);
    };
    const cap =
      input.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            stop(`${input.who} took longer than ${minutes(input.timeoutMs ?? 0)} minutes`);
          }, input.timeoutMs);
    let idle: NodeJS.Timeout | undefined;
    const watch = (): void => {
      if (input.idleMs === undefined) return;
      clearTimeout(idle);
      idle = setTimeout(() => {
        stop(`${input.who} went silent for ${minutes(input.idleMs ?? 0)} minutes`);
      }, input.idleMs);
    };
    const clear = (): void => {
      clearTimeout(cap);
      clearTimeout(idle);
    };
    watch();
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      watch();
    });
    child.on("error", (error) => {
      clear();
      fail(new Error(`the Claude CLI did not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clear();
      if (stopped) return;
      // The limit is read from the final answer only: a stream also carries the colleague's own reading and tool
      // results, where "rate limit" and `"is_error":true` can appear without the account being out of usage.
      let final: unknown;
      try {
        final = answerOf(out);
      } catch {
        final = undefined;
      }
      const finalText = final === undefined ? out.slice(-2000) : JSON.stringify(final);
      const limit = usageLimitOf(finalText);
      if (limit !== null && (code !== 0 || finalText.includes('"is_error":true'))) {
        fail(new UsageLimitError(limit));
        return;
      }
      if (code !== 0) {
        fail(new Error(`the Claude CLI exited with code ${String(code)}`));
        return;
      }
      try {
        const answer = cliAnswer.parse(final);
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
