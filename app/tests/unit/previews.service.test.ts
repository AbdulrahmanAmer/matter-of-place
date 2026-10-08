import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../src/db";
import { getDraftProperty } from "../../src/server/previews/service";
import { signPreview } from "../../src/server/lib/preview-token";
import { fakeDb } from "../fixtures/fake-db";

// B7 invariant 17 (f): the one public read of a draft. A bad, expired or unsigned token costs no database call; every
// failure is the same 404.

const KEY = "preview-test-key";
const PROPERTY = "00000000-0000-4000-8000-0000000000b1";
const NONCE = "00000000-0000-4000-8000-0000000000c1";
const SLUG = "sea-cliff-00000000";

function previewRow(nonce = NONCE, changes: Record<string, Json> = {}): Json {
  return {
    preview_nonce: nonce,
    representative: null,
    property: {
      id: PROPERTY,
      slug: SLUG,
      title: "A House Above the Water",
      market_slug: "california",
      region_slug: "bay-area",
      city: "San Francisco",
      neighborhood: "Sea Cliff",
      state: "California",
      country: "United States",
      address: "1 Fixture Lane",
      coordinates: null,
      price: 4200000,
      currency: "USD",
      beds: 4,
      baths: 3.5,
      interior_sq_ft: 3400,
      lot_acres: 0.3,
      year_built: 1931,
      type: "Residence",
      style: "Mediterranean",
      architect: null,
      designer: null,
      status: "Active",
      hero_image: "o/sea-cliff/1-0a1b2c3d.webp",
      video: null,
      og_image_key: null,
      story: ["One.", "Two."],
      place: "Above the water.",
      representative_id: null,
      presented_by_owner: true,
      listing_url: null,
      hero_rank: null,
      featured_rank: null,
      published_at: "2026-10-07T12:00:00Z",
      updated_at: "2026-10-07T12:00:00Z",
      media: [],
      features: [],
      related: [],
      ...changes,
    },
  };
}

const served = (row: Json = previewRow()) => fakeDb({ rpc: { preview_property: () => row } });

const NOT_FOUND = { code: "not_found", status: 404 };

describe("getDraftProperty", () => {
  it("answers the draft for a live token of the property at that slug", async () => {
    const db = served();
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    const property = await getDraftProperty(db, SLUG, token, KEY);
    expect(property).toMatchObject({ id: PROPERTY, slug: SLUG, title: "A House Above the Water" });
    expect(db.calls.map((call) => call.name)).toEqual(["preview_property"]);
  });

  it("a malformed signature is 404 with no database call", async () => {
    const db = served();
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    await expect(getDraftProperty(db, SLUG, `${token}=`, KEY)).rejects.toMatchObject(NOT_FOUND);
    await expect(
      getDraftProperty(db, SLUG, "garbage-token-of-some-length", KEY),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(db.calls).toEqual([]);
  });

  it("a well formed signature under another key is 404 after the one read of the nonce", async () => {
    const db = served();
    const { token } = await signPreview("another-key", PROPERTY, NONCE, "editor");
    await expect(getDraftProperty(db, SLUG, token, KEY)).rejects.toMatchObject(NOT_FOUND);
    expect(db.calls.map((call) => call.name)).toEqual(["preview_property"]);
  });

  it("an expired token and an unset key are 404 with no database call", async () => {
    const db = served();
    const expired = `${PROPERTY}.1000.${"a".repeat(43)}`;
    await expect(getDraftProperty(db, SLUG, expired, KEY)).rejects.toMatchObject(NOT_FOUND);
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    await expect(getDraftProperty(db, SLUG, token, undefined)).rejects.toMatchObject(NOT_FOUND);
    expect(db.calls).toEqual([]);
  });

  it("a rotated nonce is 404", async () => {
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    await expect(
      getDraftProperty(
        served(previewRow("00000000-0000-4000-8000-0000000000c2")),
        SLUG,
        token,
        KEY,
      ),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("a token of the property opened under another slug is 404", async () => {
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    await expect(getDraftProperty(served(), "another-slug", token, KEY)).rejects.toMatchObject(
      NOT_FOUND,
    );
  });

  it("a property that is gone, or a draft the public page cannot show yet, is 404", async () => {
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    await expect(getDraftProperty(served(null), SLUG, token, KEY)).rejects.toMatchObject(NOT_FOUND);
    await expect(
      getDraftProperty(served(previewRow(NONCE, { style: null })), SLUG, token, KEY),
    ).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("GET /api/public/properties/:slug?draft_token=", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function load() {
    vi.resetModules();
    vi.stubEnv("PREVIEW_TOKEN_SECRET", KEY);
    return import("../../src/server/public/pipeline");
  }

  const get = (path: string) => new Request(`https://matterofplace.com/api/public${path}`);
  const keep = () => undefined;

  it("answers the draft no-store, bypass and noindex, and never reads the catalog state", async () => {
    const { handlePublic } = await load();
    const db = served();
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    const response = await handlePublic(
      get(`/properties/${SLUG}?draft_token=${encodeURIComponent(token)}`),
      "req-preview",
      db,
      keep,
    );
    expect(response.status).toBe(200);
    expect({
      control: response.headers.get("cache-control"),
      cache: response.headers.get("x-mop-cache"),
      robots: response.headers.get("x-robots-tag"),
    }).toEqual({ control: "no-store", cache: "bypass", robots: "noindex, nofollow" });
    expect(db.calls.map((call) => call.name)).toEqual(["preview_property"]);
  });

  it("answers a wrong token 404 without a database call", async () => {
    const { handlePublic } = await load();
    const db = served();
    const response = await handlePublic(
      get(`/properties/${SLUG}?draft_token=${"x".repeat(40)}`),
      "req-preview",
      db,
      keep,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-mop-cache")).toBe("bypass");
    expect(db.calls).toEqual([]);
  });
});
