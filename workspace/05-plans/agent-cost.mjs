#!/usr/bin/env node
// What a build run cost (ruling H52): tokens re-read from cache, output tokens, tool calls, minutes, per
// agent kind and per accepted step. Reads the journals and transcripts the Workflow tool writes under the
// project's Claude folder.
//
//   node workspace/05-plans/agent-cost.mjs                 every build run of the last 7 days
//   node workspace/05-plans/agent-cost.mjs --run wf_abc    one run (several --run allowed)
//   node workspace/05-plans/agent-cost.mjs --since 2026-10-03T03:00:00+03:00
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const M = (n) => `${(n / 1e6).toFixed(1)}M`;
const project = join(homedir(), ".claude", "projects", ROOT.replace(/[^A-Za-z0-9]/g, "-"));
/** The runs since a time (or the named runs), each with its agents summed by kind and its accepted steps. */
export function collectRuns({ wanted = [], since = Date.now() - 7 * 86_400_000 } = {}) {

// "5-6" is two steps, "10-11" two, "1,2" two, "4b" one (a range counts its two ends and the whole numbers between)
const expand = (text) => [...String(text).matchAll(/(\d+)([a-z]?)(?:\s*(?:-|–|to)\s*(\d+)([a-z]?))?/g)].reduce((n, m) => n + (m[3] ? Math.max(1, Number(m[3]) - Number(m[1]) + 1) : 1), 0) || 1;
const runs = [];
for (const session of existsSync(project) ? readdirSync(project) : []) {
  const dir = join(project, session, "subagents", "workflows");
  if (!existsSync(dir)) continue;
  for (const run of readdirSync(dir)) {
    const journal = join(dir, run, "journal.jsonl");
    if (!existsSync(journal)) continue;
    if (wanted.length ? !wanted.some((w) => run.startsWith(w)) : statSync(journal).mtimeMs < since) continue;
    const lines = readFileSync(journal, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!lines.some((l) => l.type === "started" && /^(build|close|review|fix\d*|bank|size):/.test(l.label ?? ""))) continue;
    const results = new Map(lines.filter((l) => l.type === "result").map((l) => [l.agentId, l.result ?? {}]));
    const labels = new Map(lines.filter((l) => l.type === "started").map((l) => [l.agentId, l.label]));
    // accepted steps: a group whose review accepted or whose bank agent finished
    const accepted = new Set();
    for (const [id, label] of labels) {
      const [kind, , group, steps] = label.split(":");
      const r = results.get(id);
      if ((kind.startsWith("review") && r?.verdict === "accept") || (kind === "bank" && r?.status === "done")) accepted.add(`${group}:${steps ?? ""}`);
    }
    const stepsAccepted = [...accepted].reduce((n, key) => n + expand(key.split(":")[1]), 0);
    const kinds = {};
    let wallStart = Infinity;
    let wallEnd = 0;
    for (const f of readdirSync(join(dir, run)).filter((x) => x.endsWith(".meta.json"))) {
      const meta = JSON.parse(readFileSync(join(dir, run, f), "utf8"));
      const kind = (meta.description ?? "").split(":")[0].replace(/\d+$/, "") || "other";
      const k = (kinds[kind] ??= { n: 0, min: 0, calls: 0, cacheRead: 0, cacheWrite: 0, out: 0 });
      k.n++;
      let start = null;
      let end = null;
      for (const line of readFileSync(join(dir, run, f.replace(".meta.json", ".jsonl")), "utf8").split("\n")) {
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
        if (Number.isFinite(t)) { start = start === null ? t : Math.min(start, t); end = Math.max(end ?? 0, t); }
        const u = e.type === "assistant" ? e.message?.usage : null;
        if (u) { k.cacheRead += u.cache_read_input_tokens || 0; k.cacheWrite += u.cache_creation_input_tokens || 0; k.out += u.output_tokens || 0; }
        for (const p of Array.isArray(e.message?.content) ? e.message.content : []) if (p.type === "tool_use") k.calls++;
      }
      if (start !== null) { k.min += (end - start) / 60000; wallStart = Math.min(wallStart, start); wallEnd = Math.max(wallEnd, end); }
    }
    const total = Object.values(kinds).reduce((s, v) => ({ cacheRead: s.cacheRead + v.cacheRead, cacheWrite: s.cacheWrite + v.cacheWrite, out: s.out + v.out, calls: s.calls + v.calls, min: s.min + v.min, n: s.n + v.n }), { cacheRead: 0, cacheWrite: 0, out: 0, calls: 0, min: 0, n: 0 });
    runs.push({ at: statSync(journal).mtimeMs, run, slice: [...labels.values()].map((l) => l.split(":")[1]).find(Boolean) ?? "?", stepsAccepted, kinds, total, wall: Number.isFinite(wallStart) ? (wallEnd - wallStart) / 60000 : 0 });
  }
}
runs.sort((a, b) => a.run.localeCompare(b.run));
return runs;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("agent-cost.mjs")) {
const args = process.argv.slice(2);
const wanted = args.flatMap((a, i) => (a === "--run" ? [args[i + 1]] : []));
const sinceAt = args.indexOf("--since");
const runs = collectRuns({ wanted, since: sinceAt >= 0 ? Date.parse(args[sinceAt + 1]) : undefined });
const sum = { cacheRead: 0, cacheWrite: 0, out: 0, calls: 0, min: 0, n: 0, steps: 0, wall: 0 };
for (const r of runs) {
  const t = r.total;
  console.log(`${r.run} ${r.slice.padEnd(4)} steps accepted ${String(r.stepsAccepted).padStart(2)} | agents ${String(t.n).padStart(2)} | calls ${String(t.calls).padStart(4)} | cache reads ${M(t.cacheRead).padStart(7)} | output ${M(t.out).padStart(5)} | agent minutes ${t.min.toFixed(0).padStart(4)} | wall ${r.wall.toFixed(0).padStart(4)} min` + (r.stepsAccepted ? ` | per step: ${M(t.cacheRead / r.stepsAccepted)} cache, ${(t.min / r.stepsAccepted).toFixed(0)} agent min, ${(t.calls / r.stepsAccepted).toFixed(0)} calls` : ""));
  for (const [k, v] of Object.entries(r.kinds)) console.log(`    ${k.padEnd(7)} n ${String(v.n).padStart(2)}  ${(v.min / v.n).toFixed(0).padStart(3)} min/agent  ${(v.calls / v.n).toFixed(0).padStart(3)} calls/agent  context per call ${v.calls ? Math.round(v.cacheRead / v.calls / 1000) : 0}k`);
  sum.cacheRead += t.cacheRead; sum.cacheWrite += t.cacheWrite; sum.out += t.out; sum.calls += t.calls; sum.min += t.min; sum.n += t.n; sum.steps += r.stepsAccepted; sum.wall += r.wall;
}
if (runs.length > 1) console.log(`\nall: ${runs.length} runs, ${sum.steps} steps accepted, ${sum.n} agents, ${sum.calls} calls, cache reads ${M(sum.cacheRead)}, output ${M(sum.out)}, agent minutes ${sum.min.toFixed(0)}` + (sum.steps ? `\nper accepted step: ${M(sum.cacheRead / sum.steps)} cache reads, ${M(sum.out / sum.steps)} output, ${(sum.calls / sum.steps).toFixed(0)} calls, ${(sum.min / sum.steps).toFixed(0)} agent minutes; context per call ${Math.round(sum.cacheRead / sum.calls / 1000)}k` : ""));
}
