// W2 step 5 (contract 15): the installed skills, made available to Matter's runs. Matter works in a read-only safe mode,
// so it does not run a skill itself: it asks for media in its answer, and the daemon runs the skill's own scripts here,
// on this laptop, with the brand's fixed choices. Today: the operator's `qwen-voiceover` skill (local Qwen3-TTS in
// ComfyUI) with the Matter Of Place Voice. The operator's video skills join this list when he shares them.
//   bun scripts/workforce/media.ts --try "One line." "Another line."    make a voiceover by hand
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const OUT = join(homedir(), ".mop-workforce", "matter", "out");
const SKILL = join(homedir(), ".claude", "skills", "qwen-voiceover", "scripts");
const VENV_PYTHON = join(homedir(), "Documents", "ComfyUI", ".venv", "Scripts", "python.exe");
const BRAND_VOICE = "Matter Of Place Voice";
// One voice-over at a time on the 4 GB card; a long script is cut, never queued in parallel.
const MAX_LINES = 20;
const TIMEOUT_MS = 30 * 60_000;

export const mediaRequestSchema = z.object({
  skill: z.literal("qwen-voiceover"),
  name: z.string().min(1).max(60),
  lines: z.array(z.string().min(1).max(400)).min(1),
});
export type MediaRequest = z.infer<typeof mediaRequestSchema>;

/** A folder name from the request's name: lower case words joined by dashes, never empty. */
export function projectName(name: string, today = new Date()): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${today.toISOString().slice(0, 10)}-${slug === "" ? "voiceover" : slug}`;
}

/** The script file the skill reads: one spoken line per row, placed back to back. */
export function scriptText(lines: readonly string[]): string {
  return `${lines
    .slice(0, MAX_LINES)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")}\n`;
}

function run(program: string, args: string[], cwd: string): { ok: boolean; tail: string } {
  const ran = spawnSync(program, args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
  const tail = `${ran.stdout}\n${ran.stderr}`.trim().split("\n").slice(-3).join(" ");
  return { ok: ran.status === 0, tail };
}

/** Makes the voice-over and answers the mastered file's path, or why it could not. */
export function makeVoiceover(request: MediaRequest): { path?: string; error?: string } {
  if (!existsSync(SKILL))
    return { error: "the qwen-voiceover skill is not installed on this laptop" };
  if (!existsSync(VENV_PYTHON))
    return { error: "ComfyUI's Python was not found, so Qwen TTS cannot run" };
  const folder = join(OUT, projectName(request.name));
  mkdirSync(folder, { recursive: true });
  const script = join(folder, "script.txt");
  writeFileSync(script, scriptText(request.lines));
  const read = run("python", [join(SKILL, "read_script.py"), script, folder], folder);
  if (!read.ok) return { error: `the script could not be read: ${read.tail}` };
  const made = run(
    VENV_PYTHON,
    [join(SKILL, "make_voiceover.py"), "--dir", folder, "--voice", BRAND_VOICE],
    folder,
  );
  if (!made.ok) return { error: `the voice-over failed: ${made.tail}` };
  const master = join(folder, `${projectName(request.name).slice(11)}_MASTER.wav`);
  const polished = run(
    VENV_PYTHON,
    [join(SKILL, "polish.py"), join(folder, "voiceover.wav"), "--out", master],
    folder,
  );
  if (!polished.ok)
    return existsSync(join(folder, "voiceover.wav"))
      ? { path: join(folder, "voiceover.wav") }
      : { error: `the polish failed: ${polished.tail}` };
  return { path: master };
}

if (import.meta.main && process.argv.includes("--try")) {
  const lines = process.argv.slice(process.argv.indexOf("--try") + 1);
  console.log(JSON.stringify(makeVoiceover({ skill: "qwen-voiceover", name: "proof", lines })));
}
