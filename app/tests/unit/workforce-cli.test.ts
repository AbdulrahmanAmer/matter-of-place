// scripts/workforce/cli.ts: a colleague's run has no clock; only a silent (stuck) run is stopped (operator,
// 2026-10-15), and the stream-json answer is read from its result line.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runClaude, UsageLimitError } from "../../scripts/workforce/cli";

const fake = fileURLToPath(new URL("../fixtures/fake-claude.mjs", import.meta.url));
const run = (mode: string, limits: { idleMs?: number; timeoutMs?: number }) =>
  runClaude({
    args: [fake, mode],
    cwd: process.cwd(),
    env: { ...process.env, WORKFORCE_CLI: process.execPath },
    prompt: "hello",
    who: "the colleague",
    ...limits,
  });

describe("runClaude", () => {
  it("lets a colleague who keeps working run past the silence limit", async () => {
    const answer = await run("talk", { idleMs: 1_500 });
    expect(answer).toMatchObject({ text: "done", session: "s-1", usage: { input_tokens: 3 } });
  }, 20_000);

  it("stops a colleague who prints nothing for the silence limit", async () => {
    await expect(run("silent", { idleMs: 400 })).rejects.toThrow(
      "the colleague went silent for 0 minutes",
    );
  }, 20_000);

  it("still honours a hard cap when a caller sets one", async () => {
    await expect(run("talk", { timeoutMs: 150 })).rejects.toThrow("took longer than");
  }, 20_000);

  it("reads the one object of --output-format json", async () => {
    await expect(run("json", { idleMs: 2_000 })).resolves.toMatchObject({
      text: "one answer",
      session: "s-2",
    });
  }, 20_000);

  it("does not take a tool result that mentions a rate limit for the account being out of usage", async () => {
    await expect(run("tool-mentions-limit", { idleMs: 2_000 })).resolves.toMatchObject({
      text: "done",
    });
  }, 20_000);

  it("reports the usage limit from the final answer", async () => {
    await expect(run("out-of-usage", { idleMs: 2_000 })).rejects.toBeInstanceOf(UsageLimitError);
  }, 20_000);
});
