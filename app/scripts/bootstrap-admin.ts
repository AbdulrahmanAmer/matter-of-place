// `bun run scripts/bootstrap-admin.ts --email <owner>` with the dev profile loaded: the first real admin of the one
// project (ruling H35 (4)). Sign-ups are closed (E9) and screen 23 needs an admin, so this makes one auth user through
// the auth admin API with the roles `admin` and `chief_editor` and prints only the user id. It refuses with
// `admin exists` and exit 1 while any enabled `admin` row exists. No stage check: it writes a real user, never a test
// row, and runs inside the launch switch after the last reset.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/index.ts";
import { oneDatabaseValue } from "./lib/one-database.mjs";

const LABEL = "bootstrap-admin";

function emailArgument(): string {
  const at = process.argv.indexOf("--email");
  const email = at === -1 ? undefined : process.argv[at + 1]?.trim().toLowerCase();
  if (email === undefined || !email.includes("@")) {
    throw new Error(`usage: bun run scripts/${LABEL}.ts --email <owner>`);
  }
  return email;
}

/** The service-role client of the one project; the two values are read, never printed (G-901). */
function projectClient() {
  const url = oneDatabaseValue("SUPABASE_URL", LABEL);
  const key = oneDatabaseValue("SUPABASE_SERVICE_ROLE_KEY", LABEL);
  if (url === undefined || key === undefined) throw new Error(`${LABEL}: no project values`);
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main(): Promise<number> {
  const email = emailArgument();
  const db = projectClient();
  const admins = await db
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .is("disabled_at", null)
    .limit(1);
  if (admins.error !== null) throw new Error(`${LABEL}: reading user_roles failed`);
  if (admins.data.length > 0) {
    console.log("admin exists");
    return 1;
  }
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.error !== null) throw new Error(`${LABEL}: ${created.error.message}`);
  const id = created.data.user.id;
  const roles = await db.from("user_roles").insert([
    { user_id: id, role: "admin" },
    { user_id: id, role: "chief_editor" },
  ]);
  if (roles.error !== null) {
    // An account without its roles could never sign in; it is removed so the next run starts clean.
    await db.auth.admin.deleteUser(id);
    throw new Error(`${LABEL}: writing the roles failed, the account was removed`);
  }
  console.log(id);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
