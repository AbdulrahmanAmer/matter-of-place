// The one way the laptop runs the operator's Claude CLI for the AI staff (W1 employees and W2 Matter): the prompt on
// stdin (a long positional argument makes the CLI wait for stdin), JSON out, stderr ignored, the whole process tree
// killed on timeout (Jay: a plain kill leaves the CLI's children running).
import { spawn, spawnSync } from "node:child_process";
import { z } from "zod";

const cliAnswer = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  session_id: z.string().optional(),
});

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
}): Promise<{ text: string; session?: string }> {
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
        });
      } catch {
        fail(new Error("the Claude CLI answer was not readable"));
      }
    });
    child.stdin.end(input.prompt);
  });
}
