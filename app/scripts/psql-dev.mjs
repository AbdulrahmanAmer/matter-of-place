// `bun run db:psql -- <psql arguments>`: psql against mop-dev through DEV_DB_URL (session pooler, ASSUMED E4, F6).
// The URL goes to psql as PG* variables, so the password is never printed and never sits on a command line.
import { spawnSync } from "node:child_process";

const dbUrl = process.env["DEV_DB_URL"];
if (dbUrl === undefined || dbUrl === "") {
  console.error("DEV_DB_URL is not set");
  process.exit(1);
}
const url = new URL(dbUrl);
const result = spawnSync("psql", process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port === "" ? "5432" : url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  },
});
if (result.error !== undefined) console.error(result.error.message);
process.exitCode = result.status ?? 1;
