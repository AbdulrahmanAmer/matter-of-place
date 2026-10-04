import { z } from "zod";
import { AppError } from "../../../lib/errors.ts";
import type { CheckOutcome, HealthCheck, HealthContext } from "../health.ts";

// The provider checks of the daily health job (INT-07), the adapter of these three reads (R32). Each one skips while
// its credential is absent and passes the job's signal to fetch. There is no model check: captions run through the
// operator's own account on his laptop and no model key exists (ruling H34 (1)); Meta is meta_token_refresh's (INT-06).

const DAY_MS = 24 * 60 * 60 * 1000;
const GITHUB_WARN_DAYS = 14;
const LINKEDIN_WARN_MONTHS = 10;
const RESEND_DOMAIN = "matterofplace.com";

const skip = (message: string): CheckOutcome => ({ status: "skip", message });
const unreachable = (provider: string, error: unknown): CheckOutcome => ({
  status: "warn",
  message: `could not reach ${provider}: ${error instanceof Error ? error.message : String(error)}`,
});

/** GitHub writes the expiry as `2026-11-01 12:00:00 UTC`. */
function parseGithubExpiry(header: string): number {
  return Date.parse(header.replace(" UTC", "Z").replace(" ", "T"));
}

const githubDispatch: HealthCheck = {
  name: "github_dispatch",
  async run(ctx) {
    const token = ctx.env["GITHUB_DISPATCH_TOKEN"];
    const repo = ctx.env["GITHUB_REPO"];
    if (!token || !repo) return skip("GITHUB_DISPATCH_TOKEN or GITHUB_REPO is not set");
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "matter-of-place-health",
        },
        signal: ctx.signal,
      });
    } catch (error) {
      return unreachable("GitHub", error);
    }
    if (response.status === 401)
      return { status: "fail", message: "GitHub refused the dispatch token (401)" };
    if (!response.ok)
      return { status: "warn", message: `GitHub answered ${String(response.status)}` };
    // The token of ASSUMED E22 has no expiry, so GitHub sends no header for it.
    const header = response.headers.get("github-authentication-token-expiration");
    if (header === null) return { status: "ok", message: "the dispatch token does not expire" };
    const expires = parseGithubExpiry(header);
    if (Number.isNaN(expires))
      return { status: "warn", message: `unreadable token expiry: ${header}` };
    const days = Math.floor((expires - ctx.now.getTime()) / DAY_MS);
    if (expires <= ctx.now.getTime())
      return { status: "fail", message: "the dispatch token has expired" };
    if (days < GITHUB_WARN_DAYS) {
      return { status: "warn", message: `the dispatch token expires in ${String(days)} days` };
    }
    return { status: "ok", message: `the dispatch token expires in ${String(days)} days` };
  },
};

const resendDomainsSchema = z
  .object({ data: z.array(z.object({ name: z.string(), status: z.string() }).passthrough()) })
  .passthrough();

const resendDomain: HealthCheck = {
  name: "resend_domain",
  async run(ctx) {
    const key = ctx.env["RESEND_API_KEY"];
    if (!key) return skip("RESEND_API_KEY is not set");
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctx.signal,
      });
    } catch (error) {
      return unreachable("Resend", error);
    }
    if (!response.ok)
      return { status: "fail", message: `Resend answered ${String(response.status)}` };
    const parsed = resendDomainsSchema.safeParse(await response.json());
    if (!parsed.success) return { status: "fail", message: "Resend answered an unexpected shape" };
    const domain = parsed.data.data.find((entry) => entry.name === RESEND_DOMAIN);
    if (domain?.status === "verified")
      return { status: "ok", message: `${RESEND_DOMAIN} is verified` };
    return {
      status: "fail",
      message: `${RESEND_DOMAIN} is ${domain?.status ?? "missing"} at Resend`,
    };
  },
};

const linkedinSettingsSchema = z.object({ api_version: z.string().regex(/^\d{6}$/) }).passthrough();

async function linkedinVersion(ctx: HealthContext): Promise<string | undefined> {
  const { data, error } = await ctx.db
    .from("settings")
    .select("value")
    .eq("key", "linkedin")
    .maybeSingle();
  if (error !== null)
    throw new AppError("unavailable", undefined, "The job system did not answer (settings).");
  const parsed = linkedinSettingsSchema.safeParse(data?.value);
  return parsed.success ? parsed.data.api_version : undefined;
}

const linkedinVersionCheck: HealthCheck = {
  // LinkedIn retires a `YYYYMM` API version about a year after it ships.
  name: "linkedin_version",
  async run(ctx) {
    const version = await linkedinVersion(ctx);
    if (version === undefined) return skip("settings.linkedin.api_version is not set");
    const year = Number(version.slice(0, 4));
    const month = Number(version.slice(4));
    const age = ctx.now.getUTCFullYear() * 12 + ctx.now.getUTCMonth() + 1 - (year * 12 + month);
    if (age >= LINKEDIN_WARN_MONTHS) {
      return {
        status: "warn",
        message: `LinkedIn API version ${version} is ${String(age)} months old`,
      };
    }
    return {
      status: "ok",
      message: `LinkedIn API version ${version} is ${String(age)} months old`,
    };
  },
};

export const providerChecks: readonly HealthCheck[] = [
  githubDispatch,
  resendDomain,
  linkedinVersionCheck,
];
