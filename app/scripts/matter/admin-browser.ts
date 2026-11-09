// Matter sees the live admin as himself (operator, 2026-10-27: "lets give matter access to the admin login page under his
// account so he can do all those checks"; ruling H151). It signs his own agent account into a Chrome profile that only
// he uses, with no mailbox: his key asks the admin for a one-time sign-in token for its own account
// (`POST /api/admin/auth/agent-sign-in`, which only a bearer key may call), and the admin's own confirm page spends
// it, as a mailed link would. No service role is read here. The server treats that session as the agent it is, so
// every person-only action is refused to it; a release without that route cannot sign him in at all.
//   bun scripts/matter/admin-browser.ts                               signs in if needed and checks /admin loads
//   bun scripts/matter/admin-browser.ts --visit /admin/office --shot office.png
//   bun scripts/matter/admin-browser.ts --text /admin/proposed-posts
// The server issues the token for the key's own account only, so it can only ever be his. No link, token, key or
// cookie is printed. Exit 0 when the page was read; 1 on any refusal or failure.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { childEnv, loadEnvFile } from "../workforce/env.ts";
import { ADMIN_BASE } from "./actions.ts";
import { DESK } from "./run.ts";

const DRIVER = fileURLToPath(new URL("./admin-browser-drive.mjs", import.meta.url));
const PROFILE = join(homedir(), ".mop-workforce", "matter", "admin-profile");
// Chrome's start, the sign-in and one page with its data; the driver's own steps time out well inside this.
const DRIVER_MS = 150_000;
// The driver's exit when the profile holds no session: the one case that makes a sign-in token.
const SIGNED_OUT = 3;
const SIGN_IN_MS = 20_000;

/**
 * The admin page a run may open: a path under /admin, no traversal, no space; null when refused. Git Bash turns a
 * leading `/admin/x` into `C:/Program Files/Git/admin/x` (P-3465), so the path is taken from where `/admin` starts.
 */
export function adminPagePath(arg: string | undefined): string | null {
  const text = arg?.replace(/\\/g, "/");
  const at = text?.indexOf("/admin") ?? -1;
  if (text === undefined || at < 0) return null;
  // Only Git Bash's own prefix may stand before it: never a host, never another path that holds `/admin`.
  if (at > 0 && !/^[A-Za-z]:\/.*\/Git$/.test(text.slice(0, at))) return null;
  const path = text.slice(at);
  if (!/^\/admin(?:[/?#]|$)/.test(path)) return null;
  if (path.includes("%") || path.includes("..") || path.includes("//") || /\s/.test(path))
    return null;
  // What the browser will ask for must be exactly what was given: no dot segment or escape survives normalising.
  const url = new URL(path, ADMIN_BASE);
  return url.origin === ADMIN_BASE && `${url.pathname}${url.search}${url.hash}` === path
    ? path
    : null;
}

/** The admin's own confirm page for a token hash, the address the mailed sign-in link has (B5's template). */
export function confirmUrl(tokenHash: string): string {
  const query = new URLSearchParams({ token_hash: tokenHash, type: "email", next: "/admin" });
  return `${ADMIN_BASE}/admin/auth/confirm?${query.toString()}`;
}

const issuedSchema = z.object({ token_hash: z.string().min(1) });

/**
 * A confirm address for Matter's own account, from the admin itself: his key asks for a one-time token, and the server
 * issues it only for the key's own account. A 404 is a release without agent sign-in (H151): nothing is signed in.
 */
async function signInLink(): Promise<string> {
  const key = process.env["MATTER_AGENT_KEY"];
  if (key === undefined || key === "") throw new Error("This laptop holds no Matter key.");
  const response = await fetch(`${ADMIN_BASE}/api/admin/auth/agent-sign-in`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(SIGN_IN_MS),
  });
  if (response.status === 404) {
    throw new Error("The live admin does not offer agent sign-in yet (H151 is not deployed).");
  }
  if (!response.ok) {
    throw new Error(`The admin refused a sign-in token (HTTP ${String(response.status)}).`);
  }
  const issued = issuedSchema.safeParse(await response.json());
  if (!issued.success) throw new Error("The admin answered no sign-in token.");
  return confirmUrl(issued.data.token_hash);
}

const resultSchema = z.object({
  signedIn: z.boolean(),
  refused: z.string().optional(),
  kind: z.string().optional(),
  roles: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  path: z.string().optional(),
  title: z.string().optional(),
  shot: z.string().optional(),
  text: z.string().optional(),
});

type DriverResult = z.infer<typeof resultSchema> & { code: number };

interface DriverInput {
  site: string;
  profile: string;
  path: string;
  shot: string | null;
  text: boolean;
  headed: boolean;
  link: string | null;
}

/** Runs the browser half under node: a browser launched from bun hangs on Windows (scripts/admin-shot-measure.mjs). */
function drive(input: DriverInput): Promise<DriverResult> {
  return new Promise((done, fail) => {
    // The driver gets no key, token or secret (childEnv); the sign-in address reaches it on stdin, never in argv.
    const env = childEnv();
    // A DEBUG name would make puppeteer log its protocol traffic, which carries the confirm address.
    delete env["DEBUG"];
    const child = spawn("node", [DRIVER], {
      env,
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`The browser did not finish within ${String(DRIVER_MS / 1000)} s.`));
    }, DRIVER_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = Buffer.concat(chunks).toString("utf8").trim().split(/\r?\n/).at(-1) ?? "";
      try {
        done({ ...resultSchema.parse(JSON.parse(last)), code: code ?? 1 });
      } catch {
        fail(new Error(`The browser stopped without an answer (exit ${String(code)}).`));
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      visit: { type: "string" },
      shot: { type: "string" },
      text: { type: "string" },
      headed: { type: "boolean", default: false },
    },
  });
  if (values.visit !== undefined && values.text !== undefined) {
    throw new Error("Give --visit or --text, not both.");
  }
  const asked = values.text ?? values.visit ?? "/admin";
  const path = adminPagePath(asked);
  if (path === null) throw new Error(`Not an admin page: ${asked} (a path under /admin).`);
  const shot = values.shot === undefined ? null : resolve(values.shot);
  if (shot !== null && !shot.toLowerCase().endsWith(".png")) {
    throw new Error("--shot names a .png file.");
  }
  // Run from his desk, the names are in the runner folder's env file beside it (read.ts).
  loadEnvFile(join(dirname(DESK), "live", ".env"));
  loadEnvFile();
  const input: DriverInput = {
    site: ADMIN_BASE,
    profile: PROFILE,
    path,
    shot,
    text: values.text !== undefined,
    headed: values.headed,
    link: null,
  };
  let result = await drive(input);
  if (result.code === SIGNED_OUT) {
    console.log("matter admin: the profile is signed out; signing Matter's own account in");
    result = await drive({ ...input, link: await signInLink() });
  }
  if (!result.signedIn || result.code !== 0) {
    throw new Error(
      result.refused ?? `The admin did not open signed in (exit ${String(result.code)}).`,
    );
  }
  console.log(
    `matter admin: signed in as an agent (roles ${(result.roles ?? []).join(", ")}; scopes ${(result.scopes ?? []).join(", ")})`,
  );
  console.log(`page ${result.path ?? path}: ${result.title ?? ""}`);
  if (result.shot !== undefined) console.log(`screenshot: ${result.shot}`);
  if (result.text !== undefined) console.log(result.text);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`matter admin: ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 1;
  }
}
