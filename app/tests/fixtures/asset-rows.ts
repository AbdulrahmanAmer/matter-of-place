// Rows and a step context for the B9 unit tests (fakeDb answers whole rows). One published property, its photographs
// with every size rendered, and the asset stub a render step upserts.
import { vi } from "vitest";
import { z } from "zod";
import type { Tables } from "../../src/db";
import type { RunnerEnv, StepContext } from "../../src/server/jobs/types";
import { logLine } from "../../src/server/lib/log";
import type { FakeDb } from "./fake-db";

export const PROPERTY_ID = "3f2a9c1d-0000-4000-8000-000000000001";
export const JOB_ID = "3f2a9c1d-0000-4000-8000-0000000000aa";
export const ASSET_ID = "3f2a9c1d-0000-4000-8000-0000000000bb";
export const NOW = new Date("2026-10-04T12:00:00.000Z");
export const MEDIA_BASE = "https://matter-of-place-dev.holy-meadow-4327.workers.dev/media";
const STAMP = "2026-10-03T09:00:00.000Z";

export const VARIANTS = {
  thumb: { w: 320, h: 213 },
  card: { w: 720, h: 480 },
  hero: { w: 1600, h: 1067 },
  og: { w: 1200, h: 630 },
  carousel: { w: 1080, h: 1350 },
};

export function propertyRow(overrides: Partial<Tables<"properties">> = {}): Tables<"properties"> {
  return {
    address: "1 Test Way",
    architect: null,
    archived_at: null,
    baths: 4.5,
    beds: 5,
    campaign_tier: "Editorial",
    city: "Los Altos Hills",
    coordinates: null,
    country: "United States",
    created_at: STAMP,
    created_by: null,
    currency: "USD",
    designer: null,
    editorial_state: "published",
    featured_rank: null,
    first_published_at: STAMP,
    hero_image: "o/oak-hill/0-aaaaaaaa.webp",
    hero_rank: null,
    id: PROPERTY_ID,
    interior_sq_ft: 4320,
    listing_url: null,
    lot_acres: 0.4,
    market_slug: "california",
    neighborhood: "Elmwood",
    og_image_key: null,
    place: "A quiet street under old oaks. The garden runs to the creek.",
    presented_by_owner: false,
    preview_nonce: "3f2a9c1d-0000-4000-8000-0000000000cc",
    price: 8950000,
    published_at: STAMP,
    region_slug: "east-bay",
    representative_id: null,
    search_text: null,
    slug: "oak-hill",
    source: "Editorial",
    state: "California",
    status: "Active",
    story: [],
    style: "Modern",
    submission_id: null,
    taken_down_at: null,
    title: "A residence",
    type: "Estate",
    unpublish_reason: null,
    unpublished_at: null,
    updated_at: STAMP,
    updated_by: null,
    version: 1,
    video: null,
    year_built: 2021,
    ...overrides,
  };
}

/** Photograph `n`: stored, every size rendered, in gallery position `n`. */
export function mediaRow(
  n: number,
  overrides: Partial<Tables<"property_media">> = {},
): Tables<"property_media"> {
  return {
    alt: `Photograph ${String(n)}`,
    created_at: STAMP,
    id: `3f2a9c1d-0000-4000-8000-1${String(n).padStart(11, "0")}`,
    media_key: `o/oak-hill/${String(n)}-aaaaaaaa.webp`,
    orientation: "landscape",
    property_id: PROPERTY_ID,
    render_job_id: null,
    sort_order: n,
    staging_path: null,
    updated_at: STAMP,
    variants: VARIANTS,
    ...overrides,
  };
}

/** A photograph that is only staged: no key and no sizes yet. */
export function stagedRow(
  n: number,
  overrides: Partial<Tables<"property_media">> = {},
): Tables<"property_media"> {
  return mediaRow(n, {
    media_key: null,
    variants: {},
    orientation: null,
    staging_path: `staging/${PROPERTY_ID}/${String(n).padStart(2, "0")}-original.jpg`,
    render_job_id: JOB_ID,
    ...overrides,
  });
}

export function assetRow(overrides: Partial<Tables<"assets">> = {}): Tables<"assets"> {
  return {
    alt_text: null,
    approved_at: null,
    approved_by: null,
    caption: null,
    created_at: NOW.toISOString(),
    files: [],
    id: ASSET_ID,
    job_id: JOB_ID,
    kind: "cover",
    meta: {},
    property_id: PROPERTY_ID,
    rejection_note: null,
    render_error: null,
    revision: 1,
    status: "pending",
    updated_at: STAMP,
    ...overrides,
  };
}

export const ENV: RunnerEnv = {
  MOP_ENV: "preview",
  GITHUB_DISPATCH_TOKEN: "test-dispatch-token",
  GITHUB_REPO: "AbdulrahmanAmer/matter-of-place",
  RENDER_CALLBACK_URL:
    "https://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/render/callback",
};

export function context(
  db: FakeDb,
  type: string,
  overrides: Partial<StepContext["job"]> = {},
): StepContext {
  return {
    db,
    env: ENV,
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: JOB_ID,
      type,
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
      ...overrides,
    },
  };
}

/** A fetch stub that answers every dispatch with 204; the dispatches it saw are its calls. */
export function stubDispatch(): ReturnType<
  typeof vi.fn<(input: string, init: RequestInit) => Promise<Response>>
> {
  const spy = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();
  spy.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const bodySchema = z.object({ inputs: z.object({ job: z.string() }) });
const jobSchema = z.object({
  job_id: z.string(),
  claim: z.string(),
  payload: z.object({ params: z.unknown(), data: z.record(z.string(), z.unknown()) }),
});

/** The `job` input of the first dispatch the stub saw, parsed. */
export function dispatchedJob(
  spy: ReturnType<typeof stubDispatch>,
  at = 0,
): z.infer<typeof jobSchema> {
  const raw = spy.mock.calls[at]?.[1].body;
  const { inputs } = bodySchema.parse(JSON.parse(typeof raw === "string" ? raw : "null"));
  return jobSchema.parse(JSON.parse(inputs.job));
}
