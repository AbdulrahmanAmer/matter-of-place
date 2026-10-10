// `bun run scripts/harden/rotation-drill.ts --env dev --base <dev>` (H1-38), with the dev profile loaded, against a Worker
// that serves the one database. It rehearses an agent key rotation (GS-01): it inserts two keys A and B for the dev agent,
// expects `200` from `GET <base>/api/admin/me` for each, revokes A and expects `401` for A and `200` for B,
// then deletes both rows and records the rotation with `scripts/audit-note.ts --secret AGENT_KEY` and expects its `secret.rotated` row. It
// commits rows to the one database, so it refuses production first (ruling H35 (5)) and holds the writer lock (G34).
// Prints `rotation ok`, or the failing check and exit 1.
import { execFileSync } from "node:child_process";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import {
  deleteAgentKey,
  drillBase,
  insertAgentKey,
  meStatus,
  revokeAgentKey,
  type DrillKey,
} from "./drill-lib.ts";
import { openProbeDb, type ProbeDb } from "./probe-db.ts";

const SECRET = "AGENT_KEY";

function expectStatus(label: string, got: number, want: number): void {
  if (got !== want) {
    throw new Error(`rotation drill: ${label} answered ${String(got)}, expected ${String(want)}`);
  }
}

async function rotate(db: ProbeDb, base: string): Promise<void> {
  const run = Date.now().toString();
  const keys: DrillKey[] = [];
  try {
    const a = await insertAgentKey(db, `h1 rotation drill A ${run}`);
    keys.push(a);
    const b = await insertAgentKey(db, `h1 rotation drill B ${run}`);
    keys.push(b);
    expectStatus("key A", await meStatus(base, a.key), 200);
    expectStatus("key B", await meStatus(base, b.key), 200);
    await revokeAgentKey(db, a.id);
    expectStatus("revoked key A", await meStatus(base, a.key), 401);
    expectStatus("key B after A was revoked", await meStatus(base, b.key), 200);
  } finally {
    for (const key of keys) await deleteAgentKey(db, key.id);
  }
}

async function main(): Promise<number> {
  const base = drillBase("rotation-drill.ts");
  if (base === null) return 64;
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const db = await openProbeDb(dbUrl ?? "");
  try {
    const start = await db.now();
    await rotate(db, base);
    execFileSync(
      "bun",
      [
        "run",
        "scripts/audit-note.ts",
        "--secret",
        SECRET,
        "--note",
        "h1 rotation drill",
        "--i-mean-it",
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const [recorded] = await db.rows(
      "select count(*)::text as n from audit_log where action = 'secret.rotated' and entity = $1 and at >= $2",
      [SECRET, start],
    );
    if (Number(recorded?.["n"] ?? "0") < 1) {
      throw new Error(`rotation drill: no secret.rotated row for ${SECRET}`);
    }
  } finally {
    await db.close();
  }
  console.log("rotation ok");
  return 0;
}

let code: number;
try {
  code = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  code = 1;
}
// An exit, not exitCode: a writer-lock wait that the database cancels leaves its pg client open, and an open client keeps
// the process alive forever (H1-36, H1-38 and H1-39 would never finish under run-all).
process.exit(code);
