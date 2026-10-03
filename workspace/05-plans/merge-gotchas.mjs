#!/usr/bin/env node
// Git merge driver for GOTCHAS.md: node merge-gotchas.mjs <base> <ours> <theirs>, result written to <ours>.
//
// Lanes and the orchestrator all append entries to the bank. A text merge of two appends loses a line:
// every entry ends with the same "- added: <date>" line, the merge takes it for common text and keeps it
// once (GOTCHAS P-501; the built-in union driver and a hand resolver both dropped it). This driver merges
// by entry instead: everything ours has, in its order, then each entry of theirs that ours lacks.
//
// Wire it once per clone (worktrees share it):
//   git config merge.gotchas.driver 'node "<main folder>/workspace/05-plans/merge-gotchas.mjs" %O %A %B'
// .gitattributes holds: GOTCHAS.md merge=gotchas
import { readFileSync, writeFileSync } from "node:fs";

const ENTRY = /^## ([GP]-\d+) /;

/** @param {string} text */
export function parse(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => ENTRY.test(line));
  const head = (first < 0 ? lines : lines.slice(0, first)).join("\n").replace(/\n+$/, "");
  /** @type {{ id: string, body: string }[]} */
  const entries = [];
  if (first >= 0) {
    let start = first;
    for (let i = first + 1; i <= lines.length; i++) {
      if (i === lines.length || lines[i].startsWith("## ")) {
        const id = ENTRY.exec(lines[start])?.[1];
        const body = lines.slice(start, i).join("\n").replace(/\n+$/, "");
        entries.push({ id: id ?? `section:${lines[start]}`, body });
        start = i;
      }
    }
  }
  return { head, entries };
}

/**
 * @param {string} base
 * @param {string} ours
 * @param {string} theirs
 * @returns {{ text: string, conflicts: string[] }}
 */
export function merge(base, ours, theirs) {
  const b = parse(base);
  const o = parse(ours);
  const t = parse(theirs);
  const baseById = new Map(b.entries.map((entry) => [entry.id, entry.body]));
  const theirsById = new Map(t.entries.map((entry) => [entry.id, entry.body]));
  const conflicts = [];
  const merged = o.entries.flatMap((entry) => {
    const other = theirsById.get(entry.id);
    const was = baseById.get(entry.id);
    // retired on their side (gardening): gone from theirs, unchanged on ours since the base
    if (other === undefined && was !== undefined && was === entry.body) return [];
    if (other === undefined || other === entry.body) return [entry.body];
    if (was === entry.body) return [other];
    if (was === other) return [entry.body];
    conflicts.push(entry.id);
    return [entry.body];
  });
  const mine = new Set(o.entries.map((entry) => entry.id));
  for (const entry of t.entries) if (!mine.has(entry.id)) merged.push(entry.body);
  const head = o.head === b.head ? t.head : o.head;
  return { text: `${[head, ...merged].join("\n\n")}\n`, conflicts };
}

if (process.argv[1]?.endsWith("merge-gotchas.mjs") && process.argv.length >= 5) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  const { text, conflicts } = merge(readFileSync(basePath, "utf8"), readFileSync(oursPath, "utf8"), readFileSync(theirsPath, "utf8"));
  writeFileSync(oursPath, text);
  if (conflicts.length) {
    console.error(`merge-gotchas: both sides changed ${conflicts.join(", ")}; ours kept, compare by hand`);
    process.exit(1);
  }
}
