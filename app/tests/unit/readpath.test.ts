import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Architecture 13 rule 1 and R15: the public read path asks the database for two things only, `public_state()` and
// `public_catalog_snapshot()`, and both calls live in `state.ts`. Every other file reads through it (S52).
const APP = fileURLToPath(new URL("../..", import.meta.url));

function typescriptFiles(dir: string): string[] {
  const absolute = join(APP, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(dir, name).replaceAll("\\", "/"));
}

const read = (file: string) => readFileSync(join(APP, file), "utf8");
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
const READ_PATH = [
  "src/server/public",
  "src/server/catalog",
  "src/server/search",
  "src/server/concierge",
].flatMap(typescriptFiles);
const STATE = "src/server/public/state.ts";
const QUERY = /\.(?:from|rpc)\(/;
const TABLE_WRITE = /\.from\(\s*["'][a-z_]+["']\s*\)\s*\.(?:insert|update|upsert|delete)\(/;

describe("the public read path", () => {
  it("scans the files it is meant to guard", () => {
    expect(READ_PATH).toContain(STATE);
    expect(READ_PATH).toContain("src/server/public/redirects.ts");
    expect(READ_PATH).toContain("src/server/catalog/service.ts");
  });

  it("calls `.from(` or `.rpc(` nowhere but state.ts", () => {
    const offenders = READ_PATH.filter((file) => file !== STATE && QUERY.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("asks state.ts for the two RPCs and no table", () => {
    const source = read(STATE);
    const rpcs = [...source.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
    expect(rpcs.sort()).toEqual(["public_catalog_snapshot", "public_state"]);
    expect(source).not.toMatch(/\.from\(/);
  });

  it("maps the snapshot with no request, cookie or header in sight (rule 5)", () => {
    for (const file of ["src/server/public/mappers.ts", "src/server/catalog/service.ts"]) {
      expect(code(file)).not.toMatch(/\b(?:Request|cookie|headers)\b/i);
    }
  });
});

describe("table writes", () => {
  it("never go through `.from(<table>).insert|update|upsert|delete(`: a write is a SQL function (G43)", () => {
    const offenders = typescriptFiles("src/server").filter((file) => TABLE_WRITE.test(read(file)));
    expect(offenders).toEqual([]);
  });
});
