#!/usr/bin/env node
// One line per rule of STANDARDS.md (ruling H52): what a builder reads instead of the whole file. The first
// sentence of each **Rnn.** rule, cut at 160 characters. Reviewers still read STANDARDS.md in full.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "STANDARDS.md"), "utf8");
const rules = [...text.matchAll(/^\*\*(R\d+)\.\*\*\s+([\s\S]*?)(?=\n\n|\n\*\*R\d+\.\*\*|$)/gm)];
console.log(`# STANDARDS.md, one line per rule (${rules.length} rules). Open a rule in full with: grep -n "^\\*\\*Rnn\\.\\*\\*" workspace/05-plans/STANDARDS.md`);
for (const [, id, body] of rules) {
  const plain = body.replace(/\s+/g, " ").trim();
  // the first sentence, where a full stop inside backticks (`eslint .`) does not end a sentence
  let depth = 0;
  let end = plain.length;
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === "`") depth ^= 1;
    if (!depth && /[.;]/.test(plain[i]) && (i + 1 === plain.length || plain[i + 1] === " ")) { end = i + 1; break; }
  }
  const first = plain.slice(0, end);
  console.log(`${id}: ${first.length > 180 ? `${first.slice(0, 177).replace(/\s\S*$/, "")}...` : first}`);
}
