// `bun scripts/matter/key.ts`: gives Matter its own audited admin key, once (plan W2, step 3). It makes Matter's
// agent account (an `.invalid` address, the admin role as an agent) and one key holding every agent scope; team and
// settings stay person-only (the database refuses them to any key). The key goes straight into the workspace's
// `.env` as MATTER_AGENT_KEY and is printed nowhere. Run again: it does nothing while the name is already set.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db/types.ts";
import { agentScopes } from "../../src/domain/admin-team.ts";
import { generateKey, hashAgentKey } from "../../src/server/lib/agent-keys.ts";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "../../../.env");

function envValue(text: string, name: string): string | undefined {
  const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).replace(/^"(.*)"$/, "$1");
}

async function main(): Promise<void> {
  const text = readFileSync(envFile, "utf8");
  if (envValue(text, "MATTER_AGENT_KEY") !== undefined) {
    console.log("matter key: MATTER_AGENT_KEY is already in .env; nothing done");
    return;
  }
  const ref = envValue(text, "DEV_SUPABASE_PROJECT_REF");
  const service = envValue(text, "DEV_SUPABASE_SERVICE_ROLE_KEY");
  if (ref === undefined || service === undefined)
    throw new Error("matter key: the database names are not in .env");
  const db = createClient<Database>(`https://${ref}.supabase.co`, service, {
    auth: { persistSession: false },
  });

  const made = await db.auth.admin.createUser({
    email: `agent-matter-${crypto.randomUUID()}@matterofplace.invalid`,
    email_confirm: true,
  });
  if (made.error !== null)
    throw new Error(`matter key: the account was refused (${made.error.message})`);
  const userId = made.data.user.id;
  const system = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the generated Args type lists the actor as non-null; null is the system actor
    p_actor: null as unknown as string,
    p_actor_kind: "human" as const,
    p_request_id: "matter-key",
  };
  const role = await db.rpc("grant_role", {
    p_user: userId,
    p_role: "admin",
    p_note: "W2: Matter, the operator's owner-level agent",
    p_user_kind: "agent",
    p_display_name: "Matter",
    ...system,
  });
  if (role.error !== null) {
    await db.auth.admin.deleteUser(userId);
    throw new Error(
      `matter key: the role was refused (${role.error.message}); the account was removed`,
    );
  }
  const key = generateKey("production");
  const issued = await db.rpc("create_agent_key", {
    p_user: userId,
    p_hash: await hashAgentKey(key),
    p_label: "Matter",
    p_scopes: [...agentScopes],
    ...system,
  });
  if (issued.error !== null) {
    await db.auth.admin.deleteUser(userId);
    throw new Error(
      `matter key: the key was refused (${issued.error.message}); the account was removed`,
    );
  }
  appendFileSync(envFile, `${text.endsWith("\n") ? "" : "\n"}MATTER_AGENT_KEY=${key}\n`);
  console.log("matter key: MATTER_AGENT_KEY written to .env (value not shown)");
}

await main();
