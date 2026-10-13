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
  // Long by the list, by what the operator once backgrounded by hand (background-learned.json), or by the command's own
  // stated time limit of a minute or more.
  const learned = io.learned ?? readLearned();
  const longByLimit = [...command.matchAll(/\btimeout\s+(\d+)\b/g)].some((m) => Number(m[1]) >= 60);
  const longByLearning = signatures(command).some((sig) => learned.includes(sig));
  const background = input.run_in_background !== true && (LONG.test(command) || longByLimit || longByLearning);
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
