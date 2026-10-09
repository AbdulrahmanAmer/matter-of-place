import { z } from "zod";
import {
  storyDetailSchema,
  storyListRowSchema,
  storySavedSchema,
  type StoryDetail,
  type StoryListInput,
  type StoryListRow,
  type StoryPatch,
  type StorySaved,
} from "../../domain/admin-stories";
import type { Database } from "../../db";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { sniffStaged } from "../media/staging";

// Screen 14 (B7 step 12). Each function authorizes before it touches the database (SEC-04), and each write is one RPC
// that locks the row, checks the copy the editor read and audits in the same transaction.

type SaveStoryArgs = Database["public"]["Functions"]["save_story"]["Args"];

/** A new story has no row to lock and no copy to compare; the generated types mark no argument nullable. */
interface NullableSaveArgs {
  p_id: string | null;
  p_expected_updated_at: string | null;
}

const listRowsSchema = z.array(storyListRowSchema);

/** A page starts after the row it names: its `updated_at` exactly as stored, and its id. */
const STORY_CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

function pageAfter(cursor: string): { p_after_updated_at: string; p_after_id: string } {
  const [, at, id] = STORY_CURSOR.exec(cursor) ?? [];
  if (at === undefined || id === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  return { p_after_updated_at: at, p_after_id: id };
}

/** The cursor of the page that follows `items`: the `updated_at` and id of its last row. */
const cursorAfter = (items: readonly StoryListRow[]) => {
  const last = items.at(-1);
  return last === undefined ? null : `${last.updated_at}~${last.id}`;
};

/** `GET /api/admin/stories`: one page, last edited first, through `list_stories` (invariant 17c). */
export async function listStories(
  actor: AdminActor,
  db: Db,
  input: StoryListInput,
): Promise<{ items: StoryListRow[]; next_cursor: string | null }> {
  authorize(actor, "stories.list");
  const { data, error } = await db.rpc("list_stories", {
    p_limit: input.limit + 1,
    ...(input.editorial_state === undefined ? {} : { p_state: input.editorial_state }),
    ...(input.cursor === undefined ? {} : pageAfter(input.cursor)),
  });
  if (error !== null) throw fromRpcError(error);
  // One row more than the page tells whether another page follows.
  const rows = listRowsSchema.parse(data);
  if (rows.length <= input.limit) return { items: rows, next_cursor: null };
  const items = rows.slice(0, input.limit);
  return { items, next_cursor: cursorAfter(items) };
}

const detailRowSchema = storyDetailSchema.omit({ image_url: true });

/** `GET /api/admin/stories/:id`: the row with its body, linked properties and the address of its image. */
export async function getStory(actor: AdminActor, db: Db, id: string): Promise<StoryDetail> {
  authorize(actor, "stories.get");
  const { data, error } = await db
    .from("stories")
    .select(
      "id, slug, title, deck, category, market_slug, image, body, properties, editorial_state, published_at, archived_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error !== null) throw fromRpcError(error);
  if (data === null) throw new AppError("not_found", undefined, "This story does not exist.");
  const row = detailRowSchema.parse(data);
  return { ...row, image_url: row.image === null ? null : `/media/${row.image}` };
}

/**
 * `POST /api/admin/stories` (`id` null) and `PATCH /api/admin/stories/:id`. A staged image is checked by its first bytes
 * before the one `save_story` call, which queues its render in the same transaction, so a file that is not a photograph
 * leaves no row changed and no job (G51).
 */
export async function saveStory(
  actor: AdminActor,
  db: Db,
  input: {
    id: string | null;
    expected_updated_at?: string | undefined;
    patch: StoryPatch;
    image_staging_path?: string | undefined;
  },
): Promise<StorySaved> {
  authorize(actor, "stories.write");
  if (input.image_staging_path !== undefined) await sniffStaged(db, input.image_staging_path);
  const args: Omit<SaveStoryArgs, "p_id" | "p_expected_updated_at"> & NullableSaveArgs = {
    p_id: input.id,
    p_expected_updated_at: input.expected_updated_at ?? null,
    p_patch: input.patch,
    ...auditContext(actor),
    ...(input.image_staging_path === undefined
      ? {}
      : { p_image_staging_path: input.image_staging_path }),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generated types mark no function argument nullable; save_story inserts a draft when p_id is null and ignores p_expected_updated_at then
  const { data, error } = await db.rpc("save_story", args as SaveStoryArgs);
  if (error !== null) throw fromRpcError(error);
  return storySavedSchema.parse(data);
}

/** `POST /api/admin/stories/:id/publish`: refused while the story has no image (`publish_incomplete`, G55). */
export async function publishStory(
  actor: AdminActor,
  db: Db,
  input: { id: string; expected_updated_at: string },
): Promise<StorySaved> {
  authorize(actor, "stories.publish");
  const { data, error } = await db.rpc("publish_story", {
    p_id: input.id,
    p_expected_updated_at: input.expected_updated_at,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return storySavedSchema.parse(data);
}

/** `POST /api/admin/stories/:id/unpublish`: a live story becomes archived, and the catalog version moves once. */
export async function unpublishStory(actor: AdminActor, db: Db, id: string): Promise<StorySaved> {
  authorize(actor, "stories.unpublish");
  const { data, error } = await db.rpc("unpublish_story", { p_id: id, ...auditContext(actor) });
  if (error !== null) throw fromRpcError(error);
  return storySavedSchema.parse(data);
}
