// Gap audit item 31 (operator, 2026-10-12: "how would he be able to make those changes if he doesn't have those keys"):
// Matter changes the business through the admin website with its own agent key, never with the master keys. Matter's
// answer names the calls it wants; each is checked here against the admin's own route files (method, path and the
// permission the route needs), at most MAX_CALLS a run, and waits in Approvals as `admin_call`. When a person approves
// one, the runner's next pass makes the call with MATTER_AGENT_KEY and writes the outcome back. Ruling H99.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { jsonValue } from "../../src/domain/json-value.ts";

const app = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const MAX_CALLS = 10;
/** What the runner sends with: `fetch`, or a stand-in in a test. */
export type Send = (url: string, init: RequestInit) => Promise<Response>;
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export const adminCallSchema = z.object({
  method: z.enum(WRITE_METHODS),
  path: z
    .string()
    .regex(/^\/api\/admin\/[A-Za-z0-9._~/-]+$/)
    .max(300),
  body: z.record(z.string(), jsonValue).default({}),
  why: z.string().trim().min(1).max(500),
});
export type AdminCall = z.infer<typeof adminCallSchema>;

export interface AdminRoute {
  method: string;
  /** The path with each `$param` as one segment, as a regular expression. */
  pattern: RegExp;
  /** The route's own words, as TanStack names it: `/api/admin/automation/recipes/$trigger`. */
  path: string;
  action: string;
}

/** Every write route of the admin API, read from its file: method, path and the permission it checks. */
export function adminRoutes(dir: string = join(app, "src/routes/api/admin")): AdminRoute[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .flatMap((name) => {
      const path = `/api/admin/${name
        .replace(/\.ts$/, "")
        .replace(/\.index$/, "")
        .replace(/\./g, "/")}`;
      const pattern = new RegExp(
        `^${path
          .split("/")
          .map((part) =>
            part.startsWith("$") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/")}$`,
      );
      const text = readFileSync(join(dir, name), "utf8");
      return [
        ...text.matchAll(
          /(POST|PUT|PATCH|DELETE): defineAdminRoute\(\{\s*method: "\w+",\s*action: "([\w.]+)"/g,
        ),
      ].map((match) => ({ method: match[1] ?? "", pattern, path, action: match[2] ?? "" }));
    });
}

export type CallCheck =
  { ok: true; call: AdminCall; route: AdminRoute } | { ok: false; reason: string };

/** A call Matter may propose: a write route that exists, with that method, and that the agent key may perform. */
export function checkCall(
  raw: unknown,
  routes: readonly AdminRoute[],
  allowed: readonly string[],
): CallCheck {
  const parsed = adminCallSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "not a call the runner can read" };
  const call = parsed.data;
  const route = routes.find(
    (candidate) => candidate.method === call.method && candidate.pattern.test(call.path),
  );
  if (route === undefined)
    return { ok: false, reason: `no admin route answers ${call.method} ${call.path}` };
  if (!allowed.includes(route.action)) {
    return { ok: false, reason: `Matter's key may not do ${route.action}` };
  }
  return { ok: true, call, route };
}

/** The proposal a person reads in Approvals, with the call the runner makes once approved. */
export function callProposal(check: Extract<CallCheck, { ok: true }>) {
  const { call, route } = check;
  return {
    action: "admin_call",
    summary: `${call.why} (${route.action})`.slice(0, 500),
    content: {
      body: [
        call.why,
        "",
        `${call.method} ${call.path}`,
        Object.keys(call.body).length === 0 ? "" : JSON.stringify(call.body, null, 2),
      ]
        .join("\n")
        .trim(),
      call,
      permission: route.action,
    },
  };
}

export interface CallOutcome {
  status: number;
  ok: boolean;
  /** The first line of the answer's error message, when it failed. */
  message: string;
}

/** Makes an approved call with Matter's own key. Never throws: a failure is an outcome. */
export async function makeCall(
  call: AdminCall,
  key: string,
  base: string,
  send: Send = fetch,
): Promise<CallOutcome> {
  try {
    const response = await send(`${base}${call.path}`, {
      method: call.method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return { status: response.status, ok: true, message: "" };
    const text = await response.text();
    const message = /"message"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? text.slice(0, 200);
    return { status: response.status, ok: false, message };
  } catch (error) {
    return { status: 0, ok: false, message: error instanceof Error ? error.message : "no answer" };
  }
}

export const ADMIN_BASE = "https://matterofplace.com";

/** The permissions Matter's key holds, from `GET /api/admin/me`; none when the answer cannot be read. */
export async function allowedActions(
  key: string,
  base: string = ADMIN_BASE,
  send: Send = fetch,
): Promise<string[]> {
  try {
    const response = await send(`${base}/api/admin/me`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return [];
    const me = z.object({ actions: z.array(z.string()) }).safeParse(await response.json());
    return me.success ? me.data.actions : [];
  } catch {
    return [];
  }
}
