import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { signInAs } from "./helpers/session";

// H1-45 (CS-03): every admin write verifies CSRF. One admin session sends every session route whose method is not GET
// or HEAD, from the route registry of the files themselves, without `X-MOP-CSRF`; each must answer 403 `csrf` before
// any handler runs. Path parameters are random uuids and the body is `{}`.
const ADMIN = "staff+ceo@matterofplace.com";

// Route modules read `import.meta.env`, which Bun provides and Playwright's loader does not, so Bun lists them.
const LIST = [
  'import "./tests/fixtures/worker-env.ts";',
  'const { loadAdminRoutes } = await import("./tests/fixtures/admin-routes.ts");',
  "console.log(JSON.stringify(await loadAdminRoutes()));",
].join("\n");
const records = z.array(
  z.object({
    path: z.string(),
    method: z.string(),
    tag: z.object({ auth: z.enum(["session", "none"]) }).optional(),
  }),
);
const listed = execFileSync("bun", ["--eval", LIST], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const writes = records
  .parse(JSON.parse(listed.trim().split("\n").at(-1) ?? "[]"))
  .filter(
    (route) => route.method !== "GET" && route.method !== "HEAD" && route.tag?.auth !== "none",
  );

test("every admin write without X-MOP-CSRF answers 403 csrf", async ({ browser }) => {
  expect(writes.length).toBeGreaterThan(0);
  const { context, page } = await signInAs(browser, ADMIN);
  const answers: string[] = [];
  for (const route of writes) {
    const path = route.path.replace(/\$[A-Za-z]+/g, () => crypto.randomUUID());
    const answer = await page.evaluate(
      async ({ url, method }) => {
        const response = await fetch(url, {
          method,
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const body: unknown = await response.json().catch(() => null);
        const error: unknown =
          typeof body === "object" && body !== null ? Reflect.get(body, "error") : null;
        const code: unknown =
          typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
        return `${String(response.status)} ${String(code)}`;
      },
      { url: path, method: route.method },
    );
    answers.push(`${route.method} ${route.path} ${answer}`);
  }
  await context.close();
  process.stdout.write(
    `admin-csrf: probed ${String(answers.length)} routes of ${String(writes.length)}\n`,
  );
  expect(answers.filter((line) => !line.endsWith(" 403 csrf"))).toEqual([]);
  expect(answers).toHaveLength(writes.length);
});
