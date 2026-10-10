import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

// H1 follow-ups (g7 step 10): the rows of scripts/harden/checklist.json that serve `.output` do not build it
// themselves (P-3016), and the two rows that read the last audit-deps run say what they read when it was not success.
const APP = fileURLToPath(new URL("../../", import.meta.url));
const rowsSchema = z.object({
  rows: z.array(
    z.object({ id: z.string(), build: z.boolean().optional(), command: z.string().optional() }),
  ),
});
const rows = rowsSchema.parse(
  JSON.parse(readFileSync(join(APP, "scripts/harden/checklist.json"), "utf8")),
).rows;
const commandOf = (id: string): string => {
  const command = rows.find((row) => row.id === id)?.command;
  if (command === undefined) throw new Error(`${id} has no command`);
  return command;
};

const work: string[] = [];
afterAll(() => {
  for (const dir of work) rmSync(dir, { recursive: true, force: true });
});

/** A folder holding a `gh` that answers `answer` and a `bun` that succeeds, first on the PATH of the run. */
function stubs(answer: string) {
  const dir = mkdtempSync(join(tmpdir(), "checklist-"));
  work.push(dir);
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash\nprintf '%s' '${answer}'\n`);
  writeFileSync(join(dir, "bun"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(dir, "gh"), 0o755);
  chmodSync(join(dir, "bun"), 0o755);
  return dir;
}

function runRow(id: string, answer: string) {
  const dir = stubs(answer);
  const run = spawnSync("bash", ["-c", commandOf(id)], {
    cwd: APP,
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env["PATH"] ?? ""}` },
  });
  const lines = `${run.stdout}${run.stderr}`.split("\n").filter((line) => line.trim() !== "");
  return { status: run.status, last: lines.at(-1) ?? "" };
}

describe("rows that serve the built Worker", () => {
  it("say build: true and never run bun run build in their own command", () => {
    const own = rows
      .filter((row) => /\bbun run build\b/.test(row.command ?? ""))
      .map((row) => row.id);
    expect(own).toEqual([]);
  });

  it("include H1-26 among the rows the runner builds for", () => {
    expect(rows.find((row) => row.id === "H1-26")?.build).toBe(true);
  });
});

describe("the rows that read the last audit-deps run on main", () => {
  it.each(["H1-08", "H1-10"])(
    "%s ends on the conclusion it read when that was not success",
    (id) => {
      expect(runRow(id, "failure")).toEqual({
        status: 1,
        last: "last audit-deps.yml run on main: failure",
      });
    },
  );

  it.each(["H1-08", "H1-10"])("%s says none when the run list is empty", (id) => {
    expect(runRow(id, "")).toEqual({ status: 1, last: "last audit-deps.yml run on main: none" });
  });

  it.each(["H1-08", "H1-10"])("%s passes on success", (id) => {
    expect(runRow(id, "success")).toEqual({
      status: 0,
      last: "last audit-deps.yml run on main: success",
    });
  });
});
