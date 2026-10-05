// `bun run scripts/seed-admin-users.ts` with the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile
// dev)"`): the staff test accounts of mop-dev, before the launch switch only (ruling H35 (5)). One user per role
// (the CEO account holds `admin` and `chief_editor`) and one agent with a key, made through the auth admin API
// because sign-ups are closed (E9). A second run reuses the users and issues a new key. The key is printed once.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Database } from "../src/db/index.ts";
import { generateKey, hashAgentKey } from "../src/server/lib/agent-keys.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

type Role = Database["public"]["Enums"]["app_role"];

// Real addresses of our own domain, so a sign-in mail can reach a person once B5's SMTP is on.
const STAFF: { email: string; name: string; roles: Role[] }[] = [
  { email: "staff+ceo@matterofplace.com", name: "Seed CEO", roles: ["admin", "chief_editor"] },
  { email: "staff+chief@matterofplace.com", name: "Seed Chief Editor", roles: ["chief_editor"] },
  {
    email: "staff+managing@matterofplace.com",
    name: "Seed Managing Editor",
    roles: ["managing_editor"],
  },
  { email: "staff+visual@matterofplace.com", name: "Seed Visual Editor", roles: ["visual_editor"] },
  { email: "staff+mediaops@matterofplace.com", name: "Seed Media Ops", roles: ["media_ops"] },
  { email: "staff+commercial@matterofplace.com", name: "Seed Commercial", roles: ["commercial"] },
];
const AGENT = { email: "seed-agent@matterofplace.invalid", name: "Seed Agent" };
const AGENT_SCOPES = ["submissions", "properties", "media"];
// G34: one writer at a time on mop-dev.
const LOCK = "hashtext('mop-dev-tests')";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`seed-admin-users: ${name} is not set`);
  return value;
}

/** Built from the dev profile's own names, never SUPABASE_URL, which a shell may hold for another project (P-331). */
function devAuth() {
  return createClient<Database>(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.admin;
}

/** The id of the auth user with `email`, created confirmed when it does not exist. */
async function userId(db: pg.Client, email: string): Promise<string> {
  const found = await db.query<{ id: string }>(
    "select id from auth.users where lower(email) = lower($1)",
    [email],
  );
  const existing = found.rows[0]?.id;
  if (existing !== undefined) return existing;
  const { data, error } = await devAuth().createUser({ email, email_confirm: true });
  if (error !== null)
    throw new Error(`seed-admin-users: creating ${email} failed: ${error.message}`);
  return data.user.id;
}

async function grant(
  db: pg.Client,
  id: string,
  roles: Role[],
  kind: "human" | "agent",
  name: string,
): Promise<void> {
  await db.query(
    `insert into public.user_roles (user_id, role, actor_kind, display_name)
     select $1, unnest($2::public.app_role[]), $3::public.actor_kind, $4
     on conflict (user_id, role) do update set disabled_at = null, display_name = excluded.display_name`,
    [id, roles, kind, name],
  );
}

async function seed(db: pg.Client): Promise<void> {
  for (const person of STAFF) {
    const id = await userId(db, person.email);
    await grant(db, id, person.roles, "human", person.name);
    console.log(`staff ${person.roles.join("+")} ${person.email}`);
  }
  const agentId = await userId(db, AGENT.email);
  await grant(db, agentId, ["managing_editor"], "agent", AGENT.name);
  const key = generateKey("dev");
  await db.query(
    "insert into public.agent_keys (user_id, key_hash, label, scopes) values ($1, $2, $3, $4)",
    [agentId, await hashAgentKey(key), `seed ${new Date().toISOString()}`, AGENT_SCOPES],
  );
  console.log(`agent ${AGENT.email} scopes ${AGENT_SCOPES.join(",")}`);
  console.log(`agent key (shown once): ${key}`);
}

async function main(): Promise<void> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const db = new pg.Client({ connectionString: requiredEnv("DEV_DB_URL") });
  await db.connect();
  try {
    await db.query(`select pg_advisory_lock(${LOCK})`);
    await seed(db);
  } finally {
    await db.query(`select pg_advisory_unlock(${LOCK})`);
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
