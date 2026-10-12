// W2 contract 16: every employee's prompt opens with the ten-line staff charter, once the operator has approved it in
// W2.md ("Approved by the operator: yes"); before that, no employee prompt carries it. Matter's prompt always opens
// with the full words (scripts/matter/run.ts).
import { existsSync, readFileSync } from "node:fs";

/** The ten numbered lines, or "" while the operator has not approved them. */
export function staffCharter(planText: string): string {
  const start = planText.indexOf("## The staff charter (distilled)");
  if (start === -1) return "";
  const end = planText.indexOf("\n## ", start + 4);
  const section = planText.slice(start, end === -1 ? undefined : end);
  if (!/^Approved by the operator: yes\b/m.test(section)) return "";
  const lines = section
    .split("\n")
    .filter((line) => /^\s*\d+\.\s/.test(line) || /^\s{3}\S/.test(line));
  return [
    "Our charter (the operator's words, distilled):",
    ...lines.map((line) => line.trimEnd()),
  ].join("\n");
}

export function staffCharterFrom(planFile: string): string {
  return existsSync(planFile) ? staffCharter(readFileSync(planFile, "utf8")) : "";
}
