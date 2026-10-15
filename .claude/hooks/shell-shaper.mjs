// PreToolUse hook on Bash: shapes a command so it runs right the first time (operator, 2026-10-13: "optimize your
// harness to not use backslashes ... put things in the background and stay busy ... one shot this"). It replaces
// inline-script-guard.mjs, which only refused. Three rewrites, each returned as updatedInput:
//  1. An inline script with a backslash (`node -e`, `bun -e`) becomes a file in the scratch folder, run as `node <file>`:
//     on this machine the Bash tool changes backslashes inside an inline script (P-008), never inside a file.
//  2. A heredoc into a file (`cat > f <<'EOF'` or `cat >> f <<'EOF'`) is written by this hook with Node, every character
//     kept, and the segment becomes `: wrote f`.
//  3. A long command (tests, check, build, type check, lint, knip, replays, installs, gates, deploys) runs in the
//     background, so the session keeps working and is told when it ends.
// What it cannot rewrite safely (`python -c` or an unquoted heredoc delimiter with a backslash) is still refused.
// Test: node .claude/hooks/shell-shaper.test.mjs
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { readLearned, signatures } from "./background-learner.mjs";

const LONG =
  /(\bvitest\b|\bbun run (check|test|test:db|build|knip|typecheck|lint|jscpd)\b|\bbunx (tsc|vitest|eslint|knip|playwright)\b|\btsc --noEmit\b|watchfail\.mjs|local-ci\.mjs|deploy-local\.mjs|gate-loop\.sh|\bbun install\b|\bnpm (ci|install)\b|playwright test|supabase (db push|functions deploy)|wrangler deploy|bundle-check\.mjs)/;

// A command that only reads or searches text (grep watchfail.mjs, git show x:local-ci.mjs) names a long tool without
// running it, so LONG is tested only on the pieces that run something else.
const READER = /^(grep|rg|sed|awk|cat|head|tail|wc|ls|echo|printf|cut|sort|uniq|tr|jq|git (show|log|diff|grep|blame|status))\b/;

/** Whether any piece of the command (split at ; && || | and newlines) that is not a reader matches the pattern. */
function runs(command, pattern, quotedCounts = true) {
  // A quoted argument (a grep pattern with \| in it) is one word, never a place to split. Its text counts for a long
  // command (`bash "$S/gate-loop.sh"`) but not for a program name (a log line that mentions wrangler).
  const quoted = [];
  return command
    .replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\1[ \t]*(?=\n|$)/g, (_, tag, rest) => `<<${tag}${rest}`)
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => `\u0000${String(quoted.push(q) - 1)}\u0000`)
    .split(/&&|\|\||[;|\n]/)
    .map((piece) => piece.replace(/\u0000(\d+)\u0000/g, (_, i) => (quotedCounts ? quoted[Number(i)] : '""')))
    .map((piece) => piece.trim().replace(/^(\w+=\S*\s+)+/, "").replace(/^cd\s+\S+\s*$/, ""))
    .some((piece) => piece !== "" && !READER.test(piece) && pattern.test(piece));
}

const runsLong = (command) => runs(command, LONG);

/** Undo bash's double-quote escapes: inside "...", only \\ \" \$ \` and a backslash-newline are escapes. */
function unescapeDouble(text) {
  return text.replace(/\\([\\"$`\n])/g, (_, ch) => (ch === "\n" ? "" : ch));
}

/** The first `node|bun -e '...'` or `-e "..."` with its body, or null. */
function findInline(command) {
  const re = /\b(node|bun)\s+(?:-e|--eval)\s+(['"])/g;
  for (let m = re.exec(command); m !== null; m = re.exec(command)) {
    const quote = m[2];
    const bodyStart = m.index + m[0].length;
    let i = bodyStart;
    let body = "";
    for (; i < command.length; i++) {
      const ch = command[i];
      if (quote === '"' && ch === "\\" && i + 1 < command.length) {
        body += ch + command[i + 1];
        i++;
        continue;
      }
      if (ch === quote) break;
      body += ch;
    }
    if (i >= command.length) return null;
    return {
      runner: m[1],
      start: m.index,
      end: i + 1,
      script: quote === '"' ? unescapeDouble(body) : body,
    };
  }
  return null;
}

/** Heredocs into a file with a quoted delimiter: `cat >[>] file <<'EOF'\n...\nEOF`. */
function findHeredoc(command) {
  const re = /\bcat\s+(>>?)\s*("[^"]+"|'[^']+'|[^\s<;&|]+)\s*<<-?\s*(['"])(\w+)\3[^\n]*\n/g;
  const m = re.exec(command);
  if (m === null) return null;
  const bodyStart = m.index + m[0].length;
  const endRe = new RegExp(`^${m[4]}$`, "m");
  const rest = command.slice(bodyStart);
  const end = endRe.exec(rest);
  if (end === null) return null;
  return {
    append: m[1] === ">>",
    file: m[2].replace(/^["']|["']$/g, ""),
    start: m.index,
    headerEnd: bodyStart,
    body: rest.slice(0, end.index),
    end: bodyStart + end.index + m[4].length,
  };
}

/** A Git Bash path (/e/x, /c/Users/..) or ~ as a Windows path Node can open. */
function nodePath(file, cwd) {
  let f = file.replace(/^~(?=\/)/, process.env.USERPROFILE ?? process.env.HOME ?? "~");
  const drive = /^\/([a-zA-Z])\/(.*)$/.exec(f);
  if (drive) f = `${drive[1].toUpperCase()}:/${drive[2]}`;
  if (!/^([a-zA-Z]:[\\/]|\/)/.test(f)) f = join(cwd, f);
  return f.replace(/\\/g, "/");
}

/** The working directory a command has reached at `index`: each `cd X` before it, applied in order. */
export function cwdAt(command, index, start) {
  let dir = start;
  const re = /(?:^|&&|;|\|\||\n)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g;
  for (const m of command.slice(0, index).matchAll(re)) {
    const target = m[1].replace(/^["']|["']$/g, "");
    dir = nodePath(target, dir);
  }
  return dir;
}

let counter = 0;
const scratch = () => join(tmpdir(), "claude-shell-shaper");

/**
 * The shaped tool input, or { deny } for what cannot be rewritten, or null for no change.
 * @param {{ command?: string, run_in_background?: boolean }} input
 * @param {{ cwd?: string, write?: (file: string, text: string, append: boolean) => void, now?: () => number }} [io]
 */
export function shape(input, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const write =
    io.write ??
    ((file, text, append) => {
      mkdirSync(dirname(file), { recursive: true });
      if (append) appendFileSync(file, text);
      else writeFileSync(file, text);
    });
  let command = String(input.command ?? "");
  const notes = [];

  for (let heredoc = findHeredoc(command); heredoc !== null; heredoc = findHeredoc(command)) {
    write(nodePath(heredoc.file, cwdAt(command, heredoc.start, cwd)), heredoc.body, heredoc.append);
    command = `${command.slice(0, heredoc.start)}: wrote ${heredoc.file}${command.slice(heredoc.end)}`;
    notes.push(`heredoc written to ${heredoc.file}`);
  }
  for (let inline = findInline(command); inline !== null && inline.script.includes("\\"); inline = findInline(command)) {
    counter += 1;
    const file = join(scratch(), `inline-${String(io.now?.() ?? Date.now())}-${String(counter)}.mjs`);
    write(file, inline.script, false);
    command = `${command.slice(0, inline.start)}${inline.runner} "${file.replace(/\\/g, "/")}"${command.slice(inline.end)}`;
    notes.push(`inline script moved to ${file}`);
  }
  if (/(\bpython3?\s+-c\b|<<-?\s*\w+\s*\n)/.test(command) && command.includes("\\")) {
    return { deny: "An inline python script or an unquoted heredoc with a backslash cannot be rewritten safely (P-008): write it to a file with the Write tool and run the file." };
  }
  // Matter of Place P-530, hit twice: the shell holds the operator's personal Cloudflare token, and `bun --env-file`
  // does not replace a variable that is already set, so a wrangler call meant for the project writes to another account.
  const env = io.env ?? process.env;
  if (
    runs(command, /(^|\s)wrangler(\s|$)/, false) &&
    /matter of place|mop-build/i.test(`${cwd} ${command}`) &&
    (env.CLOUDFLARE_API_TOKEN ?? "") !== "" &&
    !/env -u CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_TOKEN=|\bcfw?\.mjs\b/.test(command)
  ) {
    return {
      deny: "This shell holds the personal Cloudflare token, and `bun --env-file` does not replace it (P-530): wrangler would act on the wrong account. Run it as `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID <command that loads .env into wrangler's own process>`, or through the project runner that reads the pair from .env.",
    };
  }
  // Long by the list, by what the operator once backgrounded by hand (background-learned.json), or by the command's own
  // stated time limit of a minute or more.
  const learned = io.learned ?? readLearned();
  const longByLimit = [...command.matchAll(/\btimeout\s+(\d+)\b/g)].some((m) => Number(m[1]) >= 60);
  const longByLearning = signatures(command).some((sig) => learned.includes(sig));
  const background = input.run_in_background !== true && (runsLong(command) || longByLimit || longByLearning);
  if (notes.length === 0 && !background) return null;
  if (background) notes.push("long command sent to the background");
  return { input: { ...input, command, ...(background ? { run_in_background: true } : {}) }, notes };
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  if (payload.tool_name !== "Bash") return;
  const result = shape(payload.tool_input ?? {}, { cwd: payload.cwd });
  if (result === null) return;
  const out =
    "deny" in result
      ? { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: result.deny }
      : {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `shell-shaper: ${result.notes.join("; ")}`,
          updatedInput: result.input,
        };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
}

if (process.argv[1] && /shell-shaper\.mjs$/.test(process.argv[1])) await main();
