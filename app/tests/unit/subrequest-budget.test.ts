// E2E-02: a Worker on the free plan may make 50 outbound calls per request. Every Turnstile check, database call and
// Storage signing counts, so the two upload routes are held to 35 at their largest input.
import "../fixtures/worker-env";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../fixtures/fake-db";

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
