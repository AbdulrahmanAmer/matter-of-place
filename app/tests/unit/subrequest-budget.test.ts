// E2E-02: a Worker on the free plan may make 50 outbound calls per request. Every Turnstile check, database call and
// Storage signing counts, so the two upload routes and activation are held to 35 at their largest input.
import "../fixtures/worker-env";
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../fixtures/fake-db";
import {
  CSRF_KEY,
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_ID,
  sessionCookie,
  signer,
  SITE,
  stubAuthEnv,
} from "../fixtures/supabase-auth";
import { PROPERTY_ID, STAMP, SUBMISSION_ID } from "./automation/fixtures/entity-rows";

const CEILING = 35;
// Cloudflare's always-pass test secret: with a secret set, the pipeline calls siteverify (here a counted fake).
process.env["TURNSTILE_SECRET"] = "1x0000000000000000000000000000000AA";

async function load() {
  vi.resetModules();
  const siteverify = vi.fn(() => Promise.resolve(Response.json({ success: true })));
  vi.stubGlobal("fetch", siteverify);
  const { handlePublic } = await import("../../src/server/public/pipeline");
  const { uploadToken } = await import("../../src/server/submissions/upload-token");
  return { handlePublic, uploadToken, siteverify };
}

const signing = () =>
  Promise.resolve({
    data: { signedUrl: "https://storage.test/sign", path: "p", token: "t" },
    error: null,
  });

function post(path: string, body: unknown) {
  return new Request(`https://matterofplace.com/api/public${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.50",
      "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX",
    },
    body: JSON.stringify(body),
  });
}

const forty = Array.from({ length: 40 }, (_, index) => ({
  name: `photo-${String(index)}.jpg`,
  size: 1000,
  type: "image/jpeg",
}));

describe("outbound calls per request (E2E-02)", () => {
  it("keeps POST /submissions with 40 photographs at 35 calls or fewer, 20 of them signings", async () => {
    const { handlePublic, siteverify } = await load();
    const id = randomUUID();
    const db = fakeDb({
      rpc: {
        rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        create_submission: () => [
          {
            id,
            received_at: new Date().toISOString(),
            media: forty.map((_, index) => ({
              id: randomUUID(),
              index,
              name: `photo-${String(index)}.jpg`,
              storage_path: `${id}/${String(index)}.jpg`,
            })),
          },
        ],
      },
      storage: { submissions: { createSignedUploadUrl: signing } },
    });
    const response = await handlePublic(
      post("/submissions", {
        address: "12 Cliff Road",
        city: "Malibu",
        state: "California",
        zip: "90265",
        currency: "USD",
        propertyType: "Residence",
        submitterKind: "owner",
        submitterName: "Ada Test",
        submitterEmail: "budget@example.invalid",
        story: "A house on the cliff.",
        significance: "Early coastal modern.",
        package: "Not sure yet",
        rightsConfirmed: true,
        media: forty,
        sourcePath: "/__test",
      }),
      "req-budget-0001",
      db,
    );
    expect(response.status).toBe(201);
    const signings = db.calls.filter((call) => call.kind === "storage").length;
    expect(signings).toBe(20);
    expect(siteverify.mock.calls.length + db.calls.length).toBeLessThanOrEqual(CEILING);
  });

  it("keeps one POST /submissions/:id/uploads call of 10 photographs at 35 calls or fewer", async () => {
    const { handlePublic, uploadToken, siteverify } = await load();
    const id = randomUUID();
    const mediaIds = Array.from({ length: 10 }, () => randomUUID());
    const db = fakeDb({
      rpc: {
        rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
        submission_upload_paths: () =>
          mediaIds.map((mediaId) => ({ media_id: mediaId, storage_path: `${id}/${mediaId}.jpg` })),
      },
      storage: { submissions: { createSignedUploadUrl: signing } },
    });
    const response = await handlePublic(
      post(`/submissions/${id}/uploads`, {
        media_ids: mediaIds,
        upload_token: await uploadToken(id),
      }),
      "req-budget-0002",
      db,
    );
    expect(response.status).toBe(200);
    expect(siteverify.mock.calls.length + db.calls.length).toBeLessThanOrEqual(CEILING);
  });
});

describe("outbound calls of an admin activation (E2E-02, PERF-07)", () => {
  it("keeps POST /api/admin/submissions/:id/activate of 40 photographs at 35 calls or fewer, none to Storage", async () => {
    const key = await signer("kid-budget");
    const auth = fakeAuth([key.jwk]);
    stubAuthEnv();
    vi.resetModules();
    const eventId = randomUUID();
    const copy = () => Promise.resolve({ data: { path: "p" }, error: null });
    const db = rolesDb([{ role: "managing_editor", disabled: false }], {
      rpc: {
        activate_submission: () => [
          { property_id: PROPERTY_ID, event_id: eventId, copy_job_id: randomUUID() },
        ],
        fanout_insert_jobs: () => 0,
      },
      tables: {
        submission_media: forty.map((photo, index) => ({
          id: randomUUID(),
          submission_id: SUBMISSION_ID,
          name: photo.name,
          storage_path: `${SUBMISSION_ID}/${String(index)}.jpg`,
          sort_order: index,
          bytes: photo.size,
          mime: photo.type,
          sha256: null,
          uploaded_at: STAMP,
        })),
        events: [
          {
            id: eventId,
            type: "submission.activated",
            entity: "submission",
            entity_id: SUBMISSION_ID,
            actor_id: null,
            payload: { submission_id: SUBMISSION_ID, property_id: PROPERTY_ID, tier: "Feature" },
            at: STAMP,
            processed_at: null,
          },
        ],
        automation_recipes: [
          {
            id: randomUUID(),
            name: "Submission activated",
            trigger: "submission.activated",
            enabled: true,
            steps: [],
            version: 1,
            created_at: STAMP,
            updated_at: STAMP,
          },
        ],
        jobs: [],
      },
      storage: {
        submissions: { copy, download: copy },
        media: { upload: copy, copy },
      },
    });
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(db);
    const activate = routeHandler(
      await import("../../src/routes/api/admin/submissions.$id.activate"),
      "POST",
    );
    const response = await activate({
      request: new Request(`${SITE}/api/admin/submissions/${SUBMISSION_ID}/activate`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()),
          "x-mop-csrf": createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url"),
        },
      }),
      context: { requestId: "req-budget-0003" },
      params: { id: SUBMISSION_ID },
    });
    expect(response.status).toBe(200);
    expect(auth.calls.length + db.calls.length).toBeLessThanOrEqual(CEILING);
    expect(db.calls.filter((call) => call.kind === "storage")).toEqual([]);
  });
});
