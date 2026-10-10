// `bun run scripts/harden/rls-review.ts --env dev|prod-config|prod` (H1-16, H1 step 3), with the dev profile loaded.
// Every env reads the one database through DEV_DB_URL (ruling H35 (1)); the review only reads. It runs `rls-review.sql`
// inside a transaction that is always rolled back, after MOP_MUTATION_SQL when that is set (the `sql` entries of
// tests/mutations/H1.json replay its watched-fails that way, T-07), and judges the catalog against architecture 3.7 as
// `tests/db/rls-matrix.ts` states it. It fails when (a) a table in `public` has RLS off, (b) `anon` holds any privilege
// on a relation in `public` (3.7: the public reads go through the Worker's service role, never direct, so every table
// is an admin table here), (c) a table and operation of the matrix has no permissive policy that grants one of its
// roles, or a table that is not a partition is missing from the matrix, (d) an insert-only table (`audit_log`,
// `events`, `automation_revisions`) has an update, delete or `for all` policy, (e) a `security definer` function in
// `public` or `app` has no fixed `search_path` or is executable by `anon`. Prints one line per table that is not a
// partition with its policies and `rls ok (...)`, or one line per problem and exit 1.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";
import { z } from "zod";
import {
  rlsMatrix,
  staffRoles,
  tableOperations,
  type StaffRole,
  type TableOperation,
} from "../../tests/db/rls-matrix.ts";
import { guardEnv } from "../lib/guard-env.mjs";

const ENVS = ["dev", "prod-config", "prod"];
const INSERT_ONLY = ["audit_log", "events", "automation_revisions"];
const SQL = readFileSync(new URL("rls-review.sql", import.meta.url), "utf8");
const ROLE_LITERAL = /'([a-z_]+)'::app_role/g;

const review = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      partition: z.boolean(),
      rls: z.boolean(),
      force: z.boolean(),
      anon: z.array(z.string()),
    }),
  ),
  policies: z.array(
    z.object({
      table: z.string(),
      name: z.string(),
      permissive: z.boolean(),
      roles: z.array(z.string()),
      command: z.string(),
      expression: z.string(),
    }),
  ),
  functions: z.array(
    z.object({
      name: z.string(),
      definer: z.boolean(),
      searchPath: z.string().nullable(),
      anon: z.boolean(),
    }),
  ),
});
type Review = z.infer<typeof review>;
type Policy = Review["policies"][number];

const isStaffRole = (name: string): name is StaffRole => staffRoles.some((role) => role === name);

/** The staff roles a policy's expression admits: every role for `app.is_staff()`, else the roles it names. */
function rolesOf(policy: Policy): StaffRole[] {
  if (policy.expression.includes("app.is_staff()")) return [...staffRoles];
  return [...policy.expression.matchAll(ROLE_LITERAL)]
    .map((match) => match[1] ?? "")
    .filter(isStaffRole);
}

/** The permissive policies through which a signed-in user may run `op` on `table`. */
function policiesFor(policies: Policy[], table: string, op: TableOperation): Policy[] {
  return policies.filter(
    (policy) =>
      policy.table === table &&
      policy.permissive &&
      (policy.command === "ALL" || policy.command === op.toUpperCase()) &&
      policy.roles.some((role) => role === "authenticated" || role === "public"),
  );
}

function problems({ tables, policies, functions }: Review): string[] {
  const found: string[] = [];
  const baseTables = tables.filter(({ kind }) => kind === "r" || kind === "p");
  for (const table of baseTables) {
    if (!table.rls) found.push(`(a) RLS off: ${table.name}`);
    if (!table.partition && rlsMatrix[table.name] === undefined) {
      found.push(`(c) not in architecture 3.7 (tests/db/rls-matrix.ts): ${table.name}`);
    }
  }
  for (const { name, anon } of tables) {
    if (anon.length > 0) found.push(`(b) anon holds ${anon.join(", ")} on ${name}`);
  }
  for (const [table, access] of Object.entries(rlsMatrix)) {
    for (const op of tableOperations) {
      const granted = new Set(policiesFor(policies, table, op).flatMap(rolesOf));
      const missing = (access[op] ?? []).filter((role) => !granted.has(role));
      if (missing.length > 0) {
        found.push(`(c) ${table} ${op}: no policy for ${missing.join(", ")}`);
      }
    }
  }
  for (const policy of policies) {
    if (
      INSERT_ONLY.includes(policy.table) &&
      ["UPDATE", "DELETE", "ALL"].includes(policy.command)
    ) {
      found.push(`(d) insert-only ${policy.table}: policy ${policy.name} allows ${policy.command}`);
    }
  }
  for (const fn of functions.filter(({ definer }) => definer)) {
    if (fn.searchPath === null)
      found.push(`(e) security definer without a fixed search_path: ${fn.name}`);
    if (fn.anon) found.push(`(e) security definer executable by anon: ${fn.name}`);
  }
  return found;
}

/** One line per table: each operation with the roles its policies admit and the policy names. */
function listing({ tables, policies }: Review): string[] {
  return tables
    .filter(({ kind, partition }) => (kind === "r" || kind === "p") && !partition)
    .map(({ name }) => {
      const parts = tableOperations.flatMap((op) => {
        const found = policiesFor(policies, name, op);
        if (found.length === 0) return [];
        const roles = new Set(found.flatMap(rolesOf));
        const who = roles.size === staffRoles.length ? "all staff" : [...roles].join(",");
        return [`${op} ${who} (${found.map((policy) => policy.name).join(", ")})`];
      });
      return `${name}: ${parts.length === 0 ? "no policy, service role only" : parts.join("; ")}`;
    });
}

async function read(dbUrl: string): Promise<Review> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query("begin");
    const mutation = process.env["MOP_MUTATION_SQL"];
    if (mutation !== undefined && mutation !== "") await client.query(mutation);
    const result = await client.query<{ review: unknown }>(SQL);
    return review.parse(result.rows[0]?.review);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { env: { type: "string" } } });
  const env = values.env;
  if (env === undefined || !ENVS.includes(env)) {
    console.error(`usage: bun run scripts/harden/rls-review.ts --env ${ENVS.join("|")}`);
    return 64;
  }
  guardEnv();
  const dbUrl = process.env["DEV_DB_URL"];
  if (dbUrl === undefined || dbUrl === "") {
    console.error("rls-review: DEV_DB_URL is not set (load the dev profile)");
    return 1;
  }
  const catalog = await read(dbUrl);
  const found = problems(catalog);
  if (found.length > 0) {
    for (const line of found) console.error(`rls-review: ${line}`);
    return 1;
  }
  for (const line of listing(catalog)) console.log(line);
  const definers = catalog.functions.filter(({ definer }) => definer).length;
  console.log(
    `rls ok (env ${env}: ${String(catalog.tables.length)} relations, ${String(catalog.policies.length)} policies, ${String(definers)} security definer functions)`,
  );
  return 0;
}

process.exitCode = await main();
