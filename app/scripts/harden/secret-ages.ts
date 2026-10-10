// `bun run scripts/harden/secret-ages.ts --env dev|prod-config|prod` (H1-38, GS-01), with the dev profile loaded. It reads
// the one database through DEV_DB_URL and prints one line per inventory secret, red lines first, then a summary. A line is red
// when an agent key without `revoked_at` is older than 90 days, when `settings.meta`, `settings.x` or `settings.linkedin`
// holds a `token_expires_at` within 7 days (or past), or when the newest `secret.rotated` audit row of a secret named in
// the inventory of `docs/runbooks/rotation.md` is older than that row's cadence. A secret with no `secret.rotated` row
// is printed as `unrecorded` and is not red; one whose cadence has no days of its own or its parent's is printed as not aged. It writes nothing, so it takes no writer lock. Exits 1 when a line is red.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import pg from "pg";

const ENVS = ["dev", "prod-config", "prod"];
const AGENT_KEY_DAYS = 90;
const CHANNEL_WARN_DAYS = 7;
const DAY_MS = 86_400_000;
const MONTH_DAYS = 365 / 12;
const INVENTORY = new URL("../../docs/runbooks/rotation.md", import.meta.url);

interface Line {
  red: boolean;
  text: string;
}

const days = (from: number, to: number) => Math.floor((to - from) / DAY_MS);

/**
 * Name and cadence in days of each row of the inventory table. A cadence "with `PARENT`" takes the parent's days; a
 * cadence with no number of days or months and no parent (refreshed by a job, on a suspected leak) is null.
 */
function cadences(): Map<string, number | null> {
  const own = new Map<string, number | null>();
  const parents = new Map<string, string>();
  const lines = readFileSync(INVENTORY, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^#+\s+(?:\d+\.\s+)?Cadence and inventory\s*$/.test(line),
  );
  for (const line of lines.slice(start + 1)) {
    if (/^#+\s/.test(line)) break;
    const [, name, , cadence] = line.split("|").map((cell) => cell.trim());
    const key = /^`([A-Z][A-Z0-9_]*)`$/.exec(name ?? "")?.[1];
    if (key === undefined) continue;
    const amount = /(\d+)\s*(day|month)/.exec(cadence ?? "");
    own.set(
      key,
      amount?.[1] === undefined
        ? null
        : Math.round(Number(amount[1]) * (amount[2] === "month" ? MONTH_DAYS : 1)),
    );
    const parent = /^with\s+`([A-Z][A-Z0-9_]*)`/.exec(cadence ?? "")?.[1];
    if (parent !== undefined) parents.set(key, parent);
  }
  return new Map(
    [...own].map(([name, days]) => [name, days ?? own.get(parents.get(name) ?? "") ?? null]),
  );
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { env: { type: "string" } } });
  if (values.env === undefined || !ENVS.includes(values.env)) {
    console.error(`usage: bun run scripts/harden/secret-ages.ts --env ${ENVS.join("|")}`);
    return 64;
  }
  const dbUrl = process.env["DEV_DB_URL"];
  if (dbUrl === undefined || dbUrl === "") throw new Error("secret-ages: DEV_DB_URL is not set");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const lines: Line[] = [];
  try {
    const clock = await client.query<{ now: Date }>("select now()");
    const now = clock.rows[0]?.now.getTime();
    if (now === undefined) throw new Error("secret-ages: the database gave no time");
    const channels = await client.query<{ key: string; expires: string | null }>(
      "select key, value ->> 'token_expires_at' as expires from public.settings where key in ('meta', 'x', 'linkedin') order by key",
    );
    for (const { key, expires } of channels.rows) {
      if (expires === null) {
        lines.push({ red: false, text: `ok   channel ${key}: token does not expire` });
        continue;
      }
      const left = Math.floor((Date.parse(expires) - now) / DAY_MS);
      if (Number.isNaN(left))
        throw new Error(`secret-ages: settings.${key}.token_expires_at is not a date`);
      lines.push({
        red: left < CHANNEL_WARN_DAYS,
        text: `${left < CHANNEL_WARN_DAYS ? "RED " : "ok  "} channel ${key}: token expires in ${String(left)} days`,
      });
    }
    const keys = await client.query<{ id: string; label: string; created: Date }>(
      "select id::text as id, label, created_at as created from public.agent_keys where revoked_at is null order by created_at",
    );
    for (const { id, label, created } of keys.rows) {
      const age = days(created.getTime(), now);
      const red = age > AGENT_KEY_DAYS;
      lines.push({
        red,
        text: `${red ? "RED " : "ok  "} agent key ${label} (${id.slice(0, 8)}): ${String(age)} days old`,
      });
    }
    const rotated = await client.query<{ entity: string; at: Date }>(
      "select distinct on (entity) entity, at from public.audit_log where action = 'secret.rotated' order by entity, at desc",
    );
    const last = new Map(rotated.rows.map((row) => [row.entity, row.at.getTime()]));
    const inventory = cadences();
    for (const [name, cadence] of inventory) {
      const at = last.get(name);
      if (cadence === null) {
        lines.push({ red: false, text: `ok   ${name}: no cadence in days, not aged` });
        continue;
      }
      if (at === undefined) {
        lines.push({ red: false, text: `unrecorded ${name}: no secret.rotated row` });
        continue;
      }
      const age = days(at, now);
      const red = age > cadence;
      lines.push({
        red,
        text: `${red ? "RED " : "ok  "} ${name}: rotated ${String(age)} days ago, cadence ${String(cadence)} days`,
      });
    }
    for (const [entity, at] of last) {
      if (!inventory.has(entity)) {
        lines.push({
          red: false,
          text: `ok   ${entity}: rotated ${String(days(at, now))} days ago, not in the inventory`,
        });
      }
    }
  } finally {
    await client.end();
  }
  const red = lines.filter((line) => line.red);
  for (const line of [...red, ...lines.filter((entry) => !entry.red)]) console.log(line.text);
  console.log(
    `secret ages (${values.env}): ${String(lines.length)} lines, ${String(red.length)} red`,
  );
  return red.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
