// `bun run scripts/harden/waf-check.ts --zone <id> | --fixture <file>` (H1-03, H1-35, GS-08). Reads four answers of the
// Cloudflare API, read-only: the rate-limit, managed-firewall and custom-firewall entrypoints and Bot Management.
// `--zone` asks the live API with `CF_EDGE_TOKEN`, else `CLOUDFLARE_API_TOKEN` (the ops profile); `--fixture` reads the
// same four answers from a recorded file, so no check ever edits a zone. Prints `waf ok`, or one line per problem and
// exit 1: exactly one enabled rate-limit rule names both `/api/public/` and `/api/admin/auth/`, an enabled execute
// rule runs the managed ruleset, Bot Fight Mode is on, and no custom rule decides by country.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";

const API = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 20_000;
const RATELIMIT = "rulesets/phase/http_ratelimit/entrypoint";
const MANAGED = "rulesets/phase/http_request_firewall_managed/entrypoint";
const CUSTOM = "rulesets/phase/http_request_firewall_custom/entrypoint";
const BOTS = "bot_management";
const COUNTRY = /\bip\.(?:src|geoip)\.country\b/;

const rule = z
  .object({
    action: z.string(),
    expression: z.string(),
    enabled: z.boolean().optional(),
    description: z.string().optional(),
  })
  .passthrough();
const ruleset = z
  .object({ result: z.object({ rules: z.array(rule).default([]) }).passthrough() })
  .passthrough();
const bots = z
  .object({ result: z.object({ fight_mode: z.boolean() }).passthrough() })
  .passthrough();
const recorded = z.record(z.string(), z.unknown());

type Rule = z.infer<typeof rule>;
type Answers = Record<string, unknown>;

const enabled = (rules: Rule[]) => rules.filter((entry) => entry.enabled !== false);

async function liveAnswers(zone: string): Promise<Answers> {
  const token = process.env["CF_EDGE_TOKEN"] ?? process.env["CLOUDFLARE_API_TOKEN"];
  if (token === undefined || token === "")
    throw new Error("waf-check: CF_EDGE_TOKEN or CLOUDFLARE_API_TOKEN is not set");
  const answers: Answers = {};
  for (const path of [RATELIMIT, MANAGED, CUSTOM, BOTS]) {
    const response = await fetch(`${API}/zones/${zone}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A phase with no entrypoint yet answers 404: it holds no rule.
    if (response.status === 404 && path !== BOTS) {
      answers[path] = { result: { rules: [] } };
      continue;
    }
    if (!response.ok) throw new Error(`waf-check: ${path} answered ${String(response.status)}`);
    answers[path] = await response.json();
  }
  return answers;
}

function rulesOf(answers: Answers, path: string): Rule[] {
  return ruleset.parse(answers[path]).result.rules;
}

function problems(answers: Answers): string[] {
  const found: string[] = [];
  const limits = enabled(rulesOf(answers, RATELIMIT)).filter(
    (entry) =>
      entry.expression.includes("/api/public/") && entry.expression.includes("/api/admin/auth/"),
  );
  if (limits.length !== 1) {
    found.push(
      `rate limit: ${String(limits.length)} enabled rules name both /api/public/ and /api/admin/auth/, expected 1`,
    );
  }
  if (!enabled(rulesOf(answers, MANAGED)).some((entry) => entry.action === "execute")) {
    found.push("managed ruleset: no enabled execute rule in http_request_firewall_managed");
  }
  if (!bots.parse(answers[BOTS]).result.fight_mode) found.push("bot fight mode: off");
  for (const entry of enabled(rulesOf(answers, CUSTOM)).filter((custom) =>
    COUNTRY.test(custom.expression),
  )) {
    found.push(`custom rule decides by country: ${entry.description ?? entry.expression}`);
  }
  return found;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { zone: { type: "string" }, fixture: { type: "string" } },
  });
  if ((values.zone === undefined) === (values.fixture === undefined)) {
    console.error("usage: bun run scripts/harden/waf-check.ts --zone <id> | --fixture <file>");
    return 64;
  }
  const answers =
    values.fixture === undefined
      ? await liveAnswers(values.zone ?? "")
      : recorded.parse(JSON.parse(readFileSync(values.fixture, "utf8")));
  const found = problems(answers);
  for (const problem of found) console.error(`waf-check: ${problem}`);
  if (found.length > 0) return 1;
  console.log("waf ok");
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
