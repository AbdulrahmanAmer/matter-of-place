import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import type { TablesInsert } from "../../src/db";
import { publishedPropertyRow } from "../fixtures/factories";
import { holdDevLock } from "../fixtures/dev-lock";
import { serviceClient } from "../fixtures/service";
import { checkpoint } from "./fixtures/a11y";
import { signInAs } from "./helpers/session";

// B9 step 11, screen 10. The rows are a property of its own, `__e2e-assets`, and assets whose files are keys that no
// bucket holds: `page.route` answers `/media/e2e/assets/*` from the step 6 renders in `.tmp/r` (or B2's photograph
// when that folder is absent), so nothing is uploaded. Approve and reject write `audit_log` rows, which are immutable
// by design (`audit_log_immutable`), so those rows stay after the run, naming assets that no longer exist.

const MEDIA_OPS = "staff+mediaops@matterofplace.com";
const SLUG = "__e2e-assets";
const SLIDES = 8;
const RENDERS = join(process.cwd(), ".tmp", "r");
const FALLBACK = join(process.cwd(), "tests", "fixtures", "photo.jpg");

const propertyId = randomUUID();
const ids = {
  cover: randomUUID(),
  carousel: randomUUID(),
  story: randomUUID(),
  block: randomUUID(),
  email: randomUUID(),
};

let release: (() => Promise<void>) | undefined;
let context: BrowserContext | undefined;
let page: Page;

/** The step 6 render named `<name>.<hash8>.jpg`, or B2's photograph where the renders were not made here. */
function jpegFor(name: string): string {
  if (!existsSync(RENDERS)) return FALLBACK;
  const found = readdirSync(RENDERS).find(
    (file) => file.startsWith(`${name}.`) && file.endsWith(".jpg"),
  );
  return found === undefined ? FALLBACK : join(RENDERS, found);
}

const file = (name: string, role: "main" | "slide", w: number, h: number, index?: number) => ({
  role,
  media_key: `e2e/assets/${name}.jpg`,
  w,
  h,
  bytes: 90_000,
  ...(index === undefined ? {} : { index }),
});

// A bulk insert sends null for a key a row lacks, which `files` and `meta` refuse, so every row names both.
const base: Required<
  Pick<TablesInsert<"assets">, "property_id" | "revision" | "status" | "files" | "meta">
> = {
  property_id: propertyId,
  revision: 1,
  status: "pending",
  files: [],
  meta: {},
};
const caption = "A quiet house under old oaks.";
const alt = "A stone house under oaks";

const assets = [
  {
    ...base,
    id: ids.cover,
    kind: "cover",
    files: [file("cover", "main", 1200, 630)],
    caption,
    alt_text: alt,
  },
  {
    ...base,
    id: ids.carousel,
    kind: "carousel",
    files: Array.from({ length: SLIDES }, (_, index) =>
      file(`slide-${String(index)}`, "slide", 1080, 1350, index),
    ),
    caption,
    alt_text: alt,
    meta: { slide_alts: Array.from({ length: SLIDES }, (_, i) => `Slide ${String(i + 1)} alt`) },
  },
  {
    ...base,
    id: ids.story,
    kind: "story",
    files: [file("story", "main", 1080, 1920)],
    caption,
    alt_text: alt,
  },
  {
    ...base,
    id: ids.block,
    kind: "newsletter_block",
    alt_text: alt,
    meta: {
      block: {
        title: "Oak Hill",
        deck: "A house by the creek.",
        image_key: "e2e/assets/cover.jpg",
        image_url: "/media/e2e/assets/cover.jpg",
      },
    },
  },
  {
    ...base,
    id: ids.email,
    kind: "standalone_email",
    meta: {
      subject: "A house by the creek",
      preheader: "Oak Hill, Los Altos Hills.",
      block: { title: "Oak Hill" },
    },
  },
] satisfies TablesInsert<"assets">[];

/** One query on its own connection to `DEV_DB_URL`, the one the guard and the lock use (P-431). */
async function query<Row extends pg.QueryResultRow>(
  sql: string,
  params: unknown[],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
  await client.connect();
  try {
    return (await client.query<Row>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Deletes the property, its assets and the events they emitted in one transaction: the service role may not delete a
 * property without `mop.retention` (B2's `refuse_hard_delete`), so this never goes through `serviceClient()`.
 */
async function removeRows(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('mop.retention', 'on', true)");
    await client.query("delete from public.events where entity_id::text = any($1)", [
      Object.values(ids),
    ]);
    await client.query(
      "delete from public.assets where property_id in (select id from public.properties where slug = $1)",
      [SLUG],
    );
    await client.query("delete from public.properties where slug = $1", [SLUG]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

const rowOf = async (id: string) =>
  (
    await query<{ status: string; rejection_note: string | null }>(
      "select status, rejection_note from public.assets where id = $1",
      [id],
    )
  )[0];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await assertNotProduction();
  release = await holdDevLock();
  await removeRows();
  const db = serviceClient();
  const inserted = await db.from("properties").insert({
    ...publishedPropertyRow({ n: 9001 }),
    id: propertyId,
    slug: SLUG,
    editorial_state: "draft",
  });
  expect(inserted.error).toBeNull();
  const seeded = await db.from("assets").insert(assets);
  expect(seeded.error).toBeNull();
  ({ context, page } = await signInAs(browser, MEDIA_OPS));
  await context.route("**/media/e2e/assets/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()?.replace(".jpg", "");
    await route.fulfill({ path: jpegFor(name ?? "cover"), contentType: "image/jpeg" });
  });
});

test.afterAll(async () => {
  try {
    await context?.close();
    await removeRows();
    const left = await query<{ n: number }>(
      "select (select count(*) from public.assets where property_id = $1)::int + (select count(*) from public.properties where id = $1)::int as n",
      [propertyId],
    );
    expect(left[0]?.n).toBe(0);
  } finally {
    await release?.();
  }
});

const card = (name: string) => page.getByRole("article", { name });

test("the Work group of the navigation links Assets for a media_ops session", async () => {
  await page.goto("/admin");
  const work = page.locator(".admin-nav__group", { has: page.getByText("Work", { exact: true }) });
  await expect(work.getByRole("link", { name: "Assets", exact: true })).toHaveAttribute(
    "href",
    "/admin/assets",
  );
});

test("screen 10 draws a card for each kind of the open property, with its picture loaded", async () => {
  await page.goto(`/admin/assets?property_id=${propertyId}`);
  await expect(page.getByRole("article")).toHaveCount(5);
  for (const name of [
    "Cover, revision 1",
    "Carousel, revision 1",
    "Story, revision 1",
    "Newsletter block, revision 1",
    "Standalone email, revision 1",
  ]) {
    await expect(card(name)).toBeVisible();
  }
  for (const name of ["Cover, revision 1", "Story, revision 1", "Carousel, revision 1"]) {
    const image = card(name).locator("img").first();
    await expect(image).toBeVisible();
    expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  }
  await checkpoint(page, "/admin/assets");
});

test("the carousel goes through all eight slides by button and back by a swipe", async () => {
  await page.goto(`/admin/assets?property_id=${propertyId}`);
  const viewer = card("Carousel, revision 1");
  await expect(viewer.getByText(`Slide 1 of ${String(SLIDES)}`)).toBeVisible();
  for (let slide = 2; slide <= SLIDES; slide += 1) {
    await viewer.getByRole("button", { name: "Next slide" }).click();
    await expect(viewer.getByText(`Slide ${String(slide)} of ${String(SLIDES)}`)).toBeVisible();
  }
  await expect(viewer.getByRole("button", { name: "Next slide" })).toBeDisabled();
  const box = await viewer.locator("img").boundingBox();
  if (box === null) throw new Error("the slide has no box");
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + (box.width * 3) / 4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(viewer.getByText(`Slide ${String(SLIDES - 1)} of ${String(SLIDES)}`)).toBeVisible();
});

test("approving a pending card turns it to approved", async () => {
  await page.goto(`/admin/assets?property_id=${propertyId}`);
  const email = card("Standalone email, revision 1");
  await expect(email.getByText("Pending")).toBeVisible();
  await email.getByRole("button", { name: "Approve" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve standalone email, revision 1" });
  await checkpoint(page, "/admin/assets approve dialog");
  expect((await rowOf(ids.email))?.status).toBe("pending");
  await dialog.getByRole("button", { name: "Approve" }).click();
  await expect(email.getByText("Approved")).toBeVisible();
  await expect(email.getByRole("button", { name: "Approve" })).toHaveCount(0);
  expect((await rowOf(ids.email))?.status).toBe("approved");
});

test("a reject asks for a note and turns the card to rejected once it has one", async () => {
  await page.goto(`/admin/assets?property_id=${propertyId}`);
  const story = card("Story, revision 1");
  await story.getByRole("button", { name: "Reject" }).click();
  const dialog = page.getByRole("dialog", { name: "Reject story, revision 1" });
  await checkpoint(page, "/admin/assets reject dialog");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A reject needs a note.");
  expect((await rowOf(ids.story))?.status).toBe("pending");
  await dialog.getByLabel("Note").fill("The crop cuts the roofline.");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(story.getByText("Rejected", { exact: true })).toBeVisible();
  expect(await rowOf(ids.story)).toEqual({
    status: "rejected",
    rejection_note: "The crop cuts the roofline.",
  });
});
