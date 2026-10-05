// Take the `src/db/types.ts` that CI's db job generated on its own stack when its type-drift step failed, and
// put it in the working tree.
//
//   bun run types:from-ci -- <pr-number>   # from app/: finds the PR's latest CI run, downloads the db-types artifact
//
// Why a script (B7 g1, 2026-10-05): a branch whose migration changes the schema must commit the regenerated types,
// but no lane can run the generator against a stack that holds its migration (no Docker, S50; mop-dev never gets a
// lane's migration, H1). CI's db job regenerates the file and uploads it as the artifact `db-types` when the drift
// check fails; copying it in is the designed path (ci.yml, "A lane commits the generated file").
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const pr = process.argv[2];
if (pr === undefined || !/^\d+$/.test(pr)) {
  process.stderr.write("usage: bun run types:from-ci -- <pr-number>\n");
  process.exit(2);
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 26 });
}
function findTypes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return findTypes(path);
    return name === "types.ts" ? [path] : [];
  });
}

const head = z
  .object({ headRefOid: z.string(), headRefName: z.string() })
  .parse(JSON.parse(gh(["pr", "view", pr, "--json", "headRefOid,headRefName"])));
const runs = z
  .array(
    z.object({
      databaseId: z.number(),
      headSha: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  )
  .parse(
    JSON.parse(
      gh([
        "run",
        "list",
        "--branch",
        head.headRefName,
        "--workflow",
        "ci.yml",
        "--limit",
        "10",
        "--json",
        "databaseId,headSha,status,conclusion",
      ]),
    ),
  );
const run = runs.find((r) => r.headSha === head.headRefOid);
if (run === undefined) {
  process.stderr.write(
    `types-from-ci: no ci.yml run for ${head.headRefName} at ${head.headRefOid.slice(0, 7)}; push first or wait for CI\n`,
  );
  process.exit(1);
}
if (run.status !== "completed") {
  process.stderr.write(
    `types-from-ci: run ${String(run.databaseId)} is ${run.status}; wait for it\n`,
  );
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "db-types-"));
try {
  gh(["run", "download", String(run.databaseId), "-n", "db-types", "-D", dir]);
} catch {
  process.stderr.write(
    `types-from-ci: run ${String(run.databaseId)} has no db-types artifact: its drift step did not fail, so the committed types are current (or the db job never ran: a draft PR skips it, P-2001)\n`,
  );
  process.exit(1);
}
const [file] = findTypes(dir);
if (file === undefined) {
  process.stderr.write("types-from-ci: artifact holds no types.ts\n");
  process.exit(1);
}
copyFileSync(file, "src/db/types.ts");
const stat =
  execFileSync("git", ["diff", "--stat", "--", "src/db/types.ts"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .pop() ?? "";
process.stdout.write(
  `types-from-ci: src/db/types.ts from run ${String(run.databaseId)} (${head.headRefOid.slice(0, 7)}); ${stat || "no change"}\n`,
);
