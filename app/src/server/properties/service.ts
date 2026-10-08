import { z } from "zod";
import {
  createFromSubmissionAnswerSchema,
  propertyDetailSchema,
  propertyListRowSchema,
  publishChecklist,
  representativeSchema,
  type PropertyDetail,
  type PropertyListInput,
  type PropertyListRow,
  type Representative,
  type RepresentativeListInput,
  type RepresentativePut,
  type featuresInputSchema,
  type propertyUpdateInputSchema,
  type publishInputSchema,
  type rankInputSchema,
  type relatedInputSchema,
} from "../../domain/admin-properties";
import type { DecisionAnswer, TimelineEntry } from "../../domain/admin-submissions";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { signPreview } from "../lib/preview-token";
import { entityTimeline } from "../lib/timeline";
import { afterDecision } from "../submissions/service";

// Screens 7 and 8 (B7 step 7). Each function authorizes before it touches the database (SEC-04), and each write is one
// RPC that locks the row, checks the version the editor read (GD-01) and audits in the same transaction.

const invalidCursor = () =>
  new AppError("validation", undefined, "This page link is no longer valid.");
const notFound = () => new AppError("not_found", undefined, "This property does not exist.");

/** A page starts after the row it names: its `updated_at` exactly as stored, and its id. */
const PROPERTY_CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;
/** A representatives page starts after its last row: the id, then the name as listed. */
const REPRESENTATIVE_CURSOR = /^([0-9a-f-]{36})~([\s\S]*)$/;

const listRowsSchema = z.array(propertyListRowSchema);
const representativeRowsSchema = z.array(representativeSchema);
const publishedSchema = z.object({ event_id: z.string().uuid(), version: z.number().int() });

function propertyCursor(cursor: string) {
  const [, at, id] = PROPERTY_CURSOR.exec(cursor) ?? [];
  if (at === undefined || id === undefined) throw invalidCursor();
  return { p_after_updated_at: at, p_after_id: id };
}

function representativeCursor(cursor: string) {
  const [, id, name] = REPRESENTATIVE_CURSOR.exec(cursor) ?? [];
  if (id === undefined || name === undefined) throw invalidCursor();
  return { p_after_id: id, p_after_name: name };
}

/** One page of `limit` rows from a function asked for `limit + 1`, and the cursor of the next page. */
function page<Row>(rows: Row[], limit: number, cursorOf: (row: Row) => string) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: rows.length > limit && last !== undefined ? cursorOf(last) : null,
  };
}

/** `GET /api/admin/properties`: one page, last edited first, through `list_properties` (invariant 17c). */
export async function listProperties(
  actor: AdminActor,
  db: Db,
  input: PropertyListInput,
): Promise<{ items: PropertyListRow[]; next_cursor: string | null }> {
  authorize(actor, "properties.list");
  const { data, error } = await db.rpc("list_properties", {
    p_limit: input.limit + 1,
    ...(input.editorial_state === undefined ? {} : { p_states: [input.editorial_state] }),
    ...(input.market === undefined ? {} : { p_market: input.market }),
    ...(input.cursor === undefined ? {} : propertyCursor(input.cursor)),
  });
  if (error !== null) throw fromRpcError(error);
  return page(listRowsSchema.parse(data), input.limit, (row) => `${row.updated_at}~${row.id}`);
}

async function readDetail(db: Db, id: string): Promise<PropertyDetail> {
  const { data, error } = await db.rpc("property_detail", { p_property_id: id });
  if (error !== null) throw fromRpcError(error);
  if (data === null) throw notFound();
  return propertyDetailSchema.parse(data);
}

/** `GET /api/admin/properties/:id`: the row with its version, photographs, lists and representative. */
export async function getProperty(actor: AdminActor, db: Db, id: string): Promise<PropertyDetail> {
  authorize(actor, "properties.get");
  return readDetail(db, id);
}

/** `GET /api/admin/properties/:id/timeline`: audit rows and job events of the property, newest first. */
export async function propertyTimeline(
  actor: AdminActor,
  db: Db,
  id: string,
): Promise<{ items: TimelineEntry[] }> {
  authorize(actor, "properties.timeline");
  return { items: await entityTimeline(db, "property", id) };
}

/**
 * `POST /api/admin/properties/from-submission`: the draft from an accepted request, in one RPC. The photographs are
 * copied by the `copy_submission_media` job it queues, so the request's subrequests do not grow with the photo count
 * (E2E-02); a second call answers the same property and job.
 */
export async function createFromSubmission(
  actor: AdminActor,
  db: Db,
  submissionId: string,
): Promise<z.infer<typeof createFromSubmissionAnswerSchema>> {
  authorize(actor, "properties.create_from_submission");
  const { data, error } = await db.rpc("create_property_from_submission", {
    p_submission_id: submissionId,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return createFromSubmissionAnswerSchema.parse(data);
}

/** `PATCH /api/admin/properties/:id`: the changed fields at the version the editor read; answers the next version. */
export async function updateProperty(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof propertyUpdateInputSchema>,
): Promise<{ version: number }> {
  authorize(actor, "properties.update");
  const { data, error } = await db.rpc("update_property", {
    p_id: input.id,
    p_expected_version: input.expected_version,
    p_patch: input.patch,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { version: data };
}

/**
 * `POST /api/admin/properties/:id/publish`: the checklist first (invariant 8), then `publish_property`, which gates
 * the same in SQL, counts an agent's daily publishes and emits `property.published`.
 */
export async function publishProperty(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof publishInputSchema>,
): Promise<DecisionAnswer & { version: number }> {
  authorize(actor, "properties.publish");
  const detail = await readDetail(db, input.id);
  const failing = publishChecklist(detail.property, detail.media, detail.representative).filter(
    (item) => !item.passed,
  );
  if (failing.length > 0) {
    const named = failing.map((item) =>
      item.missing.length > 0 ? `${item.label} (${item.missing.join(", ")})` : item.label,
    );
    throw new AppError("publish_incomplete", undefined, `Not ready: ${named.join("; ")}.`);
  }
  const { data, error } = await db.rpc("publish_property", {
    p_property_id: input.id,
    p_expected_version: input.expected_version,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  const published = publishedSchema.parse(data);
  return { ...(await afterDecision(db, published.event_id)), version: published.version };
}

/** `PUT /api/admin/properties/:id/rank`: a rank another property holds is swapped, so each stays unique. */
export async function setRanks(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof rankInputSchema>,
): Promise<{ version: number }> {
  authorize(actor, "properties.rank");
  const { data, error } = await db.rpc("set_ranks", {
    p_property_id: input.id,
    p_expected_version: input.expected_version,
    ...auditContext(actor),
    ...(input.hero_rank === null ? {} : { p_hero_rank: input.hero_rank }),
    ...(input.featured_rank === null ? {} : { p_featured_rank: input.featured_rank }),
  });
  if (error !== null) throw fromRpcError(error);
  return { version: data };
}

/** `PUT /api/admin/properties/:id/related`: the whole ordered list of related slugs. */
export async function setRelated(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof relatedInputSchema>,
): Promise<{ version: number }> {
  authorize(actor, "properties.update");
  const { data, error } = await db.rpc("set_related", {
    p_property_id: input.id,
    p_expected_version: input.expected_version,
    p_related: input.related,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { version: data };
}

/** `PUT /api/admin/properties/:id/features`: the whole ordered features list. */
export async function setFeatures(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof featuresInputSchema>,
): Promise<{ version: number }> {
  authorize(actor, "properties.update");
  const { data, error } = await db.rpc("set_features", {
    p_property_id: input.id,
    p_expected_version: input.expected_version,
    p_features: input.features,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { version: data };
}

/** `GET /api/admin/properties/representatives?q=`: one page in name order through `list_representatives`. */
export async function listRepresentatives(
  actor: AdminActor,
  db: Db,
  input: RepresentativeListInput,
): Promise<{ items: Representative[]; next_cursor: string | null }> {
  authorize(actor, "properties.representatives");
  const { data, error } = await db.rpc("list_representatives", {
    p_limit: input.limit + 1,
    ...(input.q === undefined || input.q === "" ? {} : { p_search: input.q }),
    ...(input.cursor === undefined ? {} : representativeCursor(input.cursor)),
  });
  if (error !== null) throw fromRpcError(error);
  return page(representativeRowsSchema.parse(data), input.limit, (row) => `${row.id}~${row.name}`);
}

/** `POST /api/admin/properties/representatives`: creates a row, or edits the one `id` names. */
export async function putRepresentative(
  actor: AdminActor,
  db: Db,
  input: RepresentativePut,
): Promise<{ id: string }> {
  authorize(actor, "properties.representative_put");
  const { id, ...fields } = input;
  const { data, error } = await db.rpc("upsert_representative", {
    p_fields: fields,
    ...auditContext(actor),
    ...(id === undefined ? {} : { p_id: id }),
  });
  if (error !== null) throw fromRpcError(error);
  return { id: data };
}

/**
 * `POST /api/admin/properties/:id/preview-token`: the public page of the property with a 15 minute draft token for the
 * Preview tab's iframe. `key` is PREVIEW_TOKEN_SECRET as the route read it from `env.ts`.
 */
export async function issuePreviewToken(
  actor: AdminActor,
  db: Db,
  id: string,
  key: string | undefined,
): Promise<{ url: string; expires_at: string }> {
  authorize(actor, "properties.preview_token");
  const { data, error } = await db.rpc("preview_property", { p_property_id: id });
  if (error !== null) throw fromRpcError(error);
  const found = z
    .object({ preview_nonce: z.string(), property: z.object({ slug: z.string() }) })
    .nullable()
    .parse(data);
  if (found === null) throw notFound();
  const { token, expiresAt } = await signPreview(key, id, found.preview_nonce, "editor");
  return {
    url: `/property/${encodeURIComponent(found.property.slug)}?preview=${encodeURIComponent(token)}`,
    expires_at: expiresAt.toISOString(),
  };
}
