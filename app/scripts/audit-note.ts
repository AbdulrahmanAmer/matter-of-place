// B8 step 8a: after a manual rotation (docs/runbooks/jobs.md), writes the one `secret.rotated` audit row through the
// service role. `bun run scripts/audit-note.ts --secret <NAME> [--note <text>] --i-mean-it`, the name as tech-stack
// section 4 writes it (G33). Without --i-mean-it or --secret it exits 1 and writes nothing.
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/index.ts";

const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

export interface AuditNoteRow {
  action: "secret.rotated";
  entity: string;
  note: string | null;
  actor_id: null;
  actor_kind: null;
}

/** The row this script inserts: the system wrote it, so it has no actor. */
export function auditNoteRow({ secret, note }: { secret: string; note?: string }): AuditNoteRow {
  return {
    action: "secret.rotated",
    entity: secret,
    note: note ?? null,
    actor_id: null,
    actor_kind: null,
  };
}

function parse(argv: string[]): { secret: string; note?: string } {
  const { values } = parseArgs({
    args: argv,
    options: {
      secret: { type: "string" },
      note: { type: "string" },
      "i-mean-it": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values["i-mean-it"]) throw new Error("audit-note: --i-mean-it is required, nothing written");
  const { secret, note } = values;
  if (secret === undefined || !SECRET_NAME.test(secret)) {
    throw new Error("audit-note: --secret <NAME> is required, nothing written");
  }
  return note === undefined ? { secret } : { secret, note };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`audit-note: ${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const db = createClient<Database>(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await db.from("audit_log").insert(auditNoteRow(args));
  if (error !== null) throw new Error(`audit-note: insert failed: ${error.message}`);
  console.log(`audit-note: secret.rotated for ${args.secret}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
