import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { isAllowed, refusedPaths } from "../../../../scripts/audit/scope-check.mjs";

const SCRIPT = fileURLToPath(new URL("../../../../scripts/audit/scope-check.mjs", import.meta.url));
const work: string[] = [];

afterAll(() => {
  for (const dir of work) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  );
  expect({ args, status: result.status }).toEqual({ args, status: 0 });
}

function put(root: string, path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** A repository whose main holds `base`, and whose branch `audit/x` then runs `change`. */
function repo(base: Record<string, string>, change: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "scope-check-"));
  work.push(root);
  git(root, "init", "-q", "-b", "main");
  for (const [path, text] of Object.entries(base)) put(root, path, text);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "switch", "-q", "-c", "audit/x");
  change(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
  return root;
}

function run(root: string): { status: number | null; out: string } {
  const result = spawnSync("node", [SCRIPT, "main", "HEAD"], { cwd: root, encoding: "utf8" });
  return { status: result.status, out: result.stdout };
}

describe("scope-check paths", () => {
  it("allows head, copy, styles, public, docs, the audit folder and GOTCHAS.md", () => {
    expect(
      refusedPaths([
        "app/src/routes/about.tsx",
        "app/src/routes/$market.guide.tsx",
        "app/src/lib/seo.ts",
        "app/src/components/x.tsx",
        "app/src/styles/tokens.css",
        "app/public/robots.txt",
        "app/docs/README.md",
        "workspace/audits/2026-10-03.md",
        "workspace/audits/data/2026-10-03.json",
        "GOTCHAS.md",
      ]),
    ).toEqual([]);
  });

  it("refuses server code, the API routes, deploy config, secrets and the workflows", () => {
    const paths = [
      "app/src/server/x.ts",
      "app/src/routes/api/admin/audit.record-run.ts",
      "app/src/routes/api.contact.ts",
      "app/wrangler.toml",
      "app/supabase/migrations/20261003_x.sql",
      ".github/workflows/ci.yml",
      ".github/CODEOWNERS",
      ".env",
      "app/.env.local",
      "app/public/.env",
      "app/src/lib/.env.production",
    ];
    expect(refusedPaths(paths)).toEqual(paths);
  });

  it("refuses the plans, CLAUDE.md, the agent files and the guard itself", () => {
    const paths = [
      "workspace/05-plans/B2.md",
      "workspace/05-plans/README.md",
      "CLAUDE.md",
      ".claude/agents/mop-auditor.md",
      "scripts/audit/scope-check.mjs",
      "app/package.json",
      "app/GOTCHAS.md",
      "docs/GOTCHAS.md",
    ];
    expect(refusedPaths(paths)).toEqual(paths);
  });

  it("refuses a path that only starts like an allowed folder or climbs out of it", () => {
    const paths = [
      "app/src/libs/x.ts",
      "app/src/routes-api/x.ts",
      "app/src/lib/../server/x.ts",
      "app/src/lib//x.ts",
      "./GOTCHAS.md",
      "app\\src\\lib\\x.ts",
      "/app/src/lib/x.ts",
      "workspace/audits",
    ];
    expect(paths.filter(isAllowed)).toEqual([]);
  });
});

describe("scope-check command", () => {
  it("exits 0 when every changed path is allowed", () => {
    const root = repo({ "app/src/lib/a.ts": "a\n" }, (r) => {
      put(r, "app/src/lib/a.ts", "b\n");
      put(r, "workspace/audits/2026-10-03.md", "report\n");
    });
    expect(run(root)).toEqual({ status: 0, out: "scope-check: OK 2 paths\n" });
  });

  it("exits 1 and names each refused path, one allowed path beside them", () => {
    const root = repo({ "app/src/lib/a.ts": "a\n" }, (r) => {
      put(r, "app/src/lib/a.ts", "b\n");
      put(r, "app/wrangler.toml", "name\n");
      put(r, "workspace/05-plans/README.md", "x\n");
    });
    expect(run(root)).toEqual({
      status: 1,
      out: "scope-check: refused app/wrangler.toml\nscope-check: refused workspace/05-plans/README.md\n",
    });
  });

  it("checks the old path of a renamed file", () => {
    const root = repo({ "app/wrangler.toml": "name = 'a'\nroutes = []\nvars = {}\n" }, (r) => {
      mkdirSync(join(r, "app/src/lib"), { recursive: true });
      git(r, "mv", "app/wrangler.toml", "app/src/lib/wrangler.toml");
    });
    expect(run(root)).toEqual({
      status: 1,
      out: "scope-check: refused app/wrangler.toml\n",
    });
  });

  it("reads the diff from the merge base, not the tip of main", () => {
    const root = repo({ "app/src/lib/a.ts": "a\n" }, (r) => {
      put(r, "app/src/lib/b.ts", "b\n");
    });
    git(root, "switch", "-q", "main");
    put(root, "app/wrangler.toml", "name\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "main moves");
    git(root, "switch", "-q", "audit/x");
    expect(run(root)).toEqual({ status: 0, out: "scope-check: OK 1 paths\n" });
  });

  it("exits 2 with a usage line when a ref is missing", () => {
    const result = spawnSync("node", [SCRIPT, "main"], { encoding: "utf8" });
    expect({ status: result.status, err: result.stderr }).toEqual({
      status: 2,
      err: "usage: node scripts/audit/scope-check.mjs <base> <head>\n",
    });
  });
});
