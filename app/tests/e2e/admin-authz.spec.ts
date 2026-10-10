import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";
import { meStatus, signInAs } from "./helpers/session";

// H1-15 (API-02, CS-03): one session per role walks every admin route of the registry (`loadAdminRoutes()`, every
// exported handler of `src/routes/api/admin/**`). A role the matrix does not name gets 403 `forbidden`; a role it names
// is never refused and never sent to sign-in. Writes carry the session's CSRF token and the body `{"h1_probe":true}`,
// which every strict input refuses; path parameters are random uuids, so a handler that runs finds no row. Sign-out
// runs last. The commercial session's token, re-signed with another key, is refused; the expired case is B7's
// `session-local.test.ts`, because a live token cannot be aged in a test.

const STAFF = [
  { email: "staff+ceo@matterofplace.com", roles: ["admin", "chief_editor"] },
  { email: "staff+chief@matterofplace.com", roles: ["chief_editor"] },
  { email: "staff+managing@matterofplace.com", roles: ["managing_editor"] },
  { email: "staff+visual@matterofplace.com", roles: ["visual_editor"] },
  { email: "staff+mediaops@matterofplace.com", roles: ["media_ops"] },
  { email: "staff+commercial@matterofplace.com", roles: ["commercial"] },
];
const COMMERCIAL = "staff+commercial@matterofplace.com";
// Held apart from the matrix, so a write the matrix opens to `commercial` by mistake turns this spec red: commercial
// signs out and records an audit run (B14's `audit.record_run`), and every other write is refused.
const COMMERCIAL_WRITES = ["me", "audit.record_run"];
const FORGED_FOR = COMMERCIAL;

// Route modules read `import.meta.env`, which Bun provides and Playwright's loader does not, so Bun lists them.
const LIST = [
  'import "./tests/fixtures/worker-env.ts";',
  'const { loadAdminRoutes } = await import("./tests/fixtures/admin-routes.ts");',
  'const { permission } = await import("./src/server/lib/authz.ts");',
  "const routes = await loadAdminRoutes();",
  "console.log(JSON.stringify(routes.filter((r) => r.tag?.auth === 'session')",
  ".map((r) => ({ ...r, roles: permission(r.tag.action).roles }))));",
].join("\n");

const records = z.array(
  z.object({
    path: z.string(),
    method: z.string(),
    tag: z.object({ action: z.string() }),
    roles: z.array(z.string()),
  }),
);

const signOut = (route: { method: string; tag: { action: string } }) =>
  Number(route.tag.action === "me" && route.method === "POST");
const listed = execFileSync("bun", ["--eval", LIST], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const routes = records
  .parse(JSON.parse(listed.trim().split("\n").at(-1) ?? "[]"))
  .sort((a, b) => signOut(a) - signOut(b));

/** One request from inside the page, which sends the session cookie; a write echoes the CSRF cookie. */
function call(page: Page, url: string, method: string): Promise<string> {
  return page.evaluate(
    async ({ url, method }) => {
      const write = method !== "GET" && method !== "HEAD";
      const csrf = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("mop_csrf="))
        ?.slice("mop_csrf=".length);
      const response = await fetch(url, {
        method,
        redirect: "manual",
        headers: write ? { "content-type": "application/json", "x-mop-csrf": csrf ?? "" } : {},
        ...(write ? { body: JSON.stringify({ h1_probe: true }) } : {}),
      });
      const body: unknown = await response.json().catch(() => null);
      const error: unknown =
        typeof body === "object" && body !== null ? Reflect.get(body, "error") : null;
      const code: unknown =
        typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
      return `${String(response.status)} ${String(code)}`;
    },
    { url, method },
  );
}

/**
 * The status of `GET me` in a new context whose Supabase session cookie holds the access token of `context`
 * re-signed with a throwaway ES256 key under the same header (the project's `kid`): valid claims, a foreign signature.
 */
async function forgedMeStatus(browser: Browser, context: BrowserContext): Promise<number> {
  const parts = (await context.cookies())
    .filter((cookie) => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  const first = parts[0];
  if (first === undefined) throw new Error("admin-authz: no Supabase session cookie");
  const base = first.name.replace(/\.\d+$/, "");
  const encoded = parts.map((cookie) => cookie.value).join("");
  const session = z
    .object({ access_token: z.string() })
    .passthrough()
    .parse(JSON.parse(Buffer.from(encoded.replace(/^base64-/, ""), "base64url").toString("utf8")));
  const { privateKey } = await generateKeyPair("ES256");
  const forged = await new SignJWT(decodeJwt(session.access_token))
    .setProtectedHeader({ ...decodeProtectedHeader(session.access_token), alg: "ES256" })
    .sign(privateKey);
  const json = JSON.stringify({ ...session, access_token: forged });
  const value = `base64-${Buffer.from(json).toString("base64url")}`;
  const chunks = value.match(/.{1,3000}/g) ?? [];
  const other = await browser.newContext();
  await other.addCookies(
    chunks.map((chunk, index) => ({
      ...first,
      name: chunks.length === 1 ? base : `${base}.${String(index)}`,
      value: chunk,
    })),
  );
  const page = await other.newPage();
  await page.goto("/robots.txt");
  const status = await meStatus(page);
  await other.close();
  return status;
}

for (const person of STAFF) {
  const forged =
    person.email === FORGED_FOR ? "; its token re-signed with another key is refused" : "";
  test(`${person.email} reaches exactly the actions of its roles${forged}`, async ({ browser }) => {
    expect(routes.length).toBeGreaterThan(0);
    const { context, page } = await signInAs(browser, person.email);
    if (forged !== "") expect(await forgedMeStatus(browser, context)).toBe(401);
    const wrong: string[] = [];
    for (const route of routes) {
      const write = route.method !== "GET" && route.method !== "HEAD";
      const commercialWrite = person.email === COMMERCIAL && write;
      const allowed = commercialWrite
        ? COMMERCIAL_WRITES.includes(route.tag.action)
        : route.roles.some((role) => person.roles.includes(role));
      const url = route.path.replace(/\$[A-Za-z]+/g, () => crypto.randomUUID());
      const answer = await call(page, url, route.method);
      const status = Number(answer.split(" ")[0]);
      const failed = allowed
        ? status === 401 || status === 403 || (status >= 300 && status < 400)
        : answer !== "403 forbidden";
      if (failed) {
        const verdict = allowed ? "allowed" : "refused";
        wrong.push(`${route.method} ${route.path} (${route.tag.action}, ${verdict}): ${answer}`);
      }
    }
    await context.close();
    process.stdout.write(`admin-authz: ${person.email} probed ${String(routes.length)} routes\n`);
    expect(wrong).toEqual([]);
  });
}
