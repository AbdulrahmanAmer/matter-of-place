// `E2E_TARGET=built E2E_MODE=live bun run test:e2e:coming-soon`: sets `coming_soon_global` to true on the database,
// runs the coming-soon specs against the built Worker, and puts the flag back (F17, G34). It holds the writer lock for
// the whole run, so the Playwright run it spawns takes none (MOP_DEV_LOCK_HELD).
import { spawn } from "node:child_process";
import { z } from "zod";
import { holdDevLock } from "../tests/fixtures/dev-lock";
import { serviceClient } from "../tests/fixtures/service";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const KEY = "coming_soon_global";
const settingRow = z.object({ value: z.boolean() });

await assertNotProduction();
const db = serviceClient();
const release = await holdDevLock();

async function readFlag(): Promise<boolean> {
  const { data, error } = await db.from("settings").select("value").eq("key", KEY).single();
  if (error !== null) throw new Error(`reading ${KEY}: ${error.message}`);
  return settingRow.parse(data).value;
}

async function writeFlag(value: boolean): Promise<void> {
  const { error } = await db.from("settings").update({ value }).eq("key", KEY);
  if (error !== null) throw new Error(`writing ${KEY}: ${error.message}`);
}

let playwright: ReturnType<typeof spawn> | undefined;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    playwright?.kill(signal);
  });
}

function runPlaywright(): Promise<number> {
  if (interrupted) return Promise.resolve(1);
  return new Promise((done) => {
    playwright = spawn(
      "bunx playwright test --project=coming-soon-desktop --project=coming-soon-phone",
      { stdio: "inherit", shell: true, env: { ...process.env, MOP_DEV_LOCK_HELD: "1" } },
    );
    playwright.on("exit", (code) => {
      done(code ?? 1);
    });
  });
}

let exitCode = 1;
try {
  const original = await readFlag();
  try {
    await writeFlag(true);
    exitCode = await runPlaywright();
  } finally {
    await writeFlag(original);
    const restored = await readFlag();
    process.stdout.write(`${KEY} restored to ${String(restored)}\n`);
    if (restored !== original) exitCode = 1;
  }
} finally {
  await release();
}
process.exitCode = exitCode;
