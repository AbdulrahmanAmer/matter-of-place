import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCORECARD_ROWS, SECTIONS, lintReport } from "../../../../scripts/audit/lint-report.mjs";

const SCRIPT = new URL("../../../../scripts/audit/lint-report.mjs", import.meta.url);
const TEMPLATE = new URL("../../../../workspace/audits/REPORT-TEMPLATE.md", import.meta.url);

const BASE = {
  front: { date: "2026-10-03", schedule: "manual" },
  psi: { pages: [{ path: "/", score: 93, lcp_ms: 2141, cls: 0.012, inp_ms: 180 }] },
  cache: { edge_hit_ratio: 0.97, headers_present_ratio: 1, stale_count: 0 },
  uptime: { monitors: [{ url: "https://matterofplace.com/", uptime_30d: 99.98, interval_s: 300 }] },
  gauges: [{ line: "workers_requests_day", used: 1200, limit: 100000, percent: 1.2 }],
  analytics: [{ event: "not_found", months: [3, 4] }],
};
const SIDECAR = JSON.stringify(BASE);

const FINDING_A = `### A-20261003-01 Add alt text to the home image

- Evidence: https://matterofplace.com/ image 3 has no alt
- Impact: 4
- Effort: S
- Score: 4
- Fix: app/src/components/site/hero.tsx
- PR: proposal only
`;
const FINDING_B = `### A-20261003-02 Shorten the faq description

- Evidence: /faq description is 190 characters
- Impact: 3
- Effort: M
- Score: 1.5
- Fix: app/src/routes/faq.tsx
- PR: proposal only
`;

interface Parts {
  summary: string[];
  scorecard: string[];
  gauges: string;
  findings: string[];
  omit: string[];
}

function build(change: Partial<Parts> = {}): string {
  const parts: Parts = {
    summary: ["One.", "Two.", "Three.", "Four.", "Five."],
    scorecard: [
      "| Performance | score 93, LCP 2141 ms, p75 | Not measured | Not measured | ok |",
      "| Technical SEO | 0 failed | Not measured | Not measured | ok |",
      "| AEO and GEO | llms.txt present | Not measured | Not measured | ok |",
      "| Keywords | Not measured | Not measured | Not measured | not measured |",
      "| Channels | Not measured | Not measured | Not measured | not measured |",
      "| Security | Not measured | Not measured | Not measured | not measured |",
      "| Uptime | 99.98% for / every 300 s | Not measured | Not measured | ok |",
      "| Caching | edge hit ratio 97%, headers present 1, H16 on 2026-10-03 | Not measured | Not measured | ok |",
    ],
    gauges: "| workers_requests_day | 1200 | 100000 | 1.2% | Not measured | cloudflare | ok |",
    findings: [FINDING_A, FINDING_B],
    omit: [],
    ...change,
  };
  const sections: Record<string, string> = {
    Summary: parts.summary.join("\n"),
    Scorecard: `| Area | Value | Previous | Delta | Status |\n|---|---|---|---|---|\n${parts.scorecard.join("\n")}`,
    "Free-tier gauges": `| Line | Used | Limit | Percent | Previous percent | Source | Status |\n|---|---|---|---|---|---|---|\n${parts.gauges}`,
    KPIs: "Not measured",
    "Inquiries by source": "Not measured",
    "Analytics trend": "| Event | Month one | Month two |\n|---|---|---|\n| not_found | 3 | 4 |",
    "Not found (404)": "None.",
    Findings: parts.findings.join("\n"),
    "Proposed changes": "- none",
    "Not measured": "- Search Console: GOOGLE_SA_JSON_B64 unset",
  };
  const body = SECTIONS.filter((name) => !parts.omit.includes(name))
    .map((name) => `## ${name}\n\n${sections[name] ?? ""}\n`)
    .join("\n");
  return `# Audit 2026-10-03\n\nRun id: audit-2026-10-03\n\n${body}`;
}

const lint = (report: string, sidecarText: string | null = SIDECAR, env = {}) =>
  lintReport({ report, sidecarText, env });

describe("lintReport", () => {
  it("passes a complete report whose numbers are in the sidecar", () => {
    expect(lint(build())).toEqual([]);
  });

  it("enforces a five-line summary", () => {
    const problems = lint(build({ summary: ["One.", "Two.", "Three.", "Four."] }));
    expect(problems).toEqual(["the summary has 4 lines, exactly 5 are required"]);
  });

  it("rejects a report without ## Analytics trend (ruling H16)", () => {
    expect(lint(build({ omit: ["Analytics trend"] }))).toEqual([
      'missing section "## Analytics trend"',
    ]);
  });

  it("rejects a report without ## Inquiries by source", () => {
    expect(lint(build({ omit: ["Inquiries by source"] }))).toEqual([
      'missing section "## Inquiries by source"',
    ]);
  });

  it("rejects a report without ## Not measured", () => {
    expect(lint(build({ omit: ["Not measured"] }))).toEqual(['missing section "## Not measured"']);
  });

  it("rejects a Scorecard without the Caching row", () => {
    const without = build()
      .split("\n")
      .filter((line) => !line.startsWith("| Caching"))
      .join("\n");
    expect(lint(without)).toEqual(['the Scorecard has no "Caching" row']);
    expect(SCORECARD_ROWS).toContain("Caching");
  });

  it("rejects a finding without impact, effort and score", () => {
    const unranked = FINDING_A.replace("- Score: 4\n", "");
    expect(lint(build({ findings: [unranked, FINDING_B] }))).toEqual([
      "A-20261003-01 is unranked: it needs Impact (1 to 5), Effort (S, M or L) and Score",
    ]);
  });

  it("rejects findings that are not in score order", () => {
    expect(lint(build({ findings: [FINDING_B, FINDING_A] }))).toEqual([
      "findings are not ranked: A-20261003-01 (4) follows A-20261003-02 (1.5)",
    ]);
  });

  it("rejects a score that is not impact over effort", () => {
    const wrong = FINDING_A.replace("- Score: 4", "- Score: 9");
    expect(lint(build({ findings: [wrong, FINDING_B] }))).toEqual([
      "A-20261003-01 has Score 9, impact / effort is 4.00",
    ]);
  });

  it("rejects a number in a table that is missing from the sidecar", () => {
    const problems = lint(
      build({ gauges: "| workers_requests_day | 1200 | 100000 | 55% | n | c | ok |" }),
    );
    expect(problems).toEqual([
      "the number 55% in a table is not in the sidecar: | workers_requests_day | 1200 | 100000 | 55% | n | c | ok |",
    ]);
  });

  it("rejects an em dash", () => {
    const dash = String.fromCodePoint(0x2014);
    const problems = lint(
      build({ summary: [`One ${dash} two.`, "Two.", "Three.", "Four.", "Five."] }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^line \d+ holds an em dash$/);
  });

  it("rejects a sidecar holding mopk_dev_x, naming the pattern and not the value", () => {
    const problems = lint(build(), JSON.stringify({ ...BASE, leaked: "mopk_dev_x" }));
    expect(problems.some((problem) => problem.includes("pattern /\\bmopk_"))).toBe(true);
    expect(problems.join("\n")).not.toContain("mopk_dev_x");
  });

  it("rejects the value of a secret name set in the environment, naming the name", () => {
    const secret = "uptime-secret-value-123";
    const leaked = lint(build({ summary: [secret, "Two.", "Three.", "Four.", "Five."] }), SIDECAR, {
      UPTIME_API_KEY: secret,
    });
    expect(leaked).toEqual(["secret: the report holds the value of UPTIME_API_KEY"]);
  });

  it("rejects an ops-health path segment other than <redacted>, DO-03", () => {
    const hook = (segment: string) =>
      JSON.stringify({
        ...BASE,
        url: `https://matterofplace.com/api/hooks/ops-health/${segment}`,
      });
    expect(lint(build(), hook("<redacted>"))).toEqual([]);
    expect(lint(build(), hook("tok-live-0001")).join("\n")).toContain("ops-health path segment");
    expect(lint(build(), hook("tok-live-0001")).join("\n")).not.toContain("tok-live-0001");
  });

  it("rejects a report with no sidecar", () => {
    expect(lint(build(), null)).toEqual([
      "the sidecar workspace/audits/data/<date>.json is missing",
    ]);
  });
});

describe("the REPORT-TEMPLATE.md", () => {
  it("holds every section heading in order and every scorecard row", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    const headings = [...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(SECTIONS);
    for (const row of SCORECARD_ROWS) expect(template).toContain(`| ${row} |`);
  });
});

describe("lint-report.mjs as a command", () => {
  function folder(report: string) {
    const dir = mkdtempSync(join(tmpdir(), "lint-report-"));
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "2026-10-03.md"), report);
    writeFileSync(join(dir, "data", "2026-10-03.json"), SIDECAR);
    return join(dir, "2026-10-03.md");
  }
  const run = (path: string) =>
    spawnSync("node", [fileURLToPath(SCRIPT), path], { encoding: "utf8" });

  it("exits 0 for a good report and non-zero without the Caching row", () => {
    expect(run(folder(build())).status).toBe(0);
    const without = build()
      .split("\n")
      .filter((line) => !line.startsWith("| Caching"))
      .join("\n");
    const bad = run(folder(without));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('the Scorecard has no "Caching" row');
  });
});
