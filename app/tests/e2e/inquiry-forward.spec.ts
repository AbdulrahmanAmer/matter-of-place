import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { hashKey } from "../../src/server/lib/ids";
import { t } from "../../src/lib/strings";
import { committed, type Db } from "../fixtures/db";

// B15 steps 5a and 6: a visitor's inquiry is answered the moment its row is written, with no receiver running
// (invariant 5). The row carries the attribution captured on arrival. Delivery is proved by step 5; this spec only
// submits. Run it from the dev-loader shell with the live adapter and the Turnstile test keys (P-1706).

const RECEIVER_PORT = 8787;
const first = z.object({ utm_source: z.string(), landing_path: z.string() });
const stored = z.object({
  source_path: z.string(),
  attribution: z.object({ first_touch: first, pages_viewed: z.number() }),
});

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function remove(db: Db, email: string): Promise<void> {
  const salt = process.env["RATE_LIMIT_SALT"];
  if (salt === undefined || salt === "") throw new Error("RATE_LIMIT_SALT is not set");
  const found = await db.query<{ id: string; ip_hash: string | null }>(
    "select id, ip_hash from public.inquiries where email = $1",
    [email],
  );
  const keys = [await hashKey(salt, email), ...found.rows.flatMap((row) => row.ip_hash ?? [])];
  const ids = found.rows.map((row) => row.id);
  await db.query("begin");
  await db.query("select set_config('mop.retention', 'on', true)");
  await db.query("delete from public.jobs where payload->'data'->>'inquiry_id' = any ($1)", [ids]);
  await db.query("delete from public.events where entity_id = any ($1)", [ids]);
  await db.query("delete from public.inquiries where id = any ($1)", [ids]);
  await db.query("delete from public.rate_limits where key_hash = any ($1)", [keys]);
  await db.query("commit");
}

test("an inquiry is answered 201 with no receiver running, and its row holds the attribution", async ({
  page,
}) => {
  expect(await listening(RECEIVER_PORT), `nothing may listen on ${RECEIVER_PORT.toString()}`).toBe(
    false,
  );
  const email = `inquiry-forward+${randomUUID()}@example.invalid`;

  await committed(
    async (db) => {
      await page.goto("/contact?utm_source=test");
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Your name").fill("B15 forward test");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Message").fill("A test inquiry from the forward spec.");
      const posted = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/public/inquiries") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: t.common.send }).click();
      expect((await posted).status()).toBe(201);

      const sent = page.getByRole("status");
      await expect(sent.getByRole("heading", { name: t.forms.thankYou })).toBeVisible();
      await expect(sent).toContainText(t.forms.liveSent);

      const result = await db.query(
        "select source_path, attribution from public.inquiries where email = $1",
        [email],
      );
      expect(result.rows).toHaveLength(1);
      const row = stored.parse(result.rows[0]);
      expect(row.source_path).toBe("/contact");
      expect(row.attribution.first_touch).toMatchObject({
        utm_source: "test",
        landing_path: "/contact",
      });
      expect(row.attribution.pages_viewed).toBeGreaterThanOrEqual(1);
    },
    (db) => remove(db, email),
  );
});
