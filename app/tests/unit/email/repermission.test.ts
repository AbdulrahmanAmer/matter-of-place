import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { enqueueRepermissionEmail, lapseSubscribers } from "../../../src/server/email/repermission";
import { sha256Hex, toBase64Url } from "../../../src/server/lib/crypto";
import { openToken } from "../../../src/server/subscribers/confirm-email";
import { emailWorld } from "../../fixtures/email-send";
import { fakeDb } from "../../fixtures/fake-db";

// The re-permission helpers of B11's hygiene job (GG-05, invariant 12): one ask is one sealed `send_email` job whose
// key carries the token's hash, and nothing is enqueued for a suppressed address or a row the database refuses.

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));
const SUBSCRIBER_ID = "66666666-6666-4666-8666-666666666666";
const READER = "reader@gmail.com";

const enqueued = z.object({
  p_type: z.string(),
  p_idempotency_key: z.string(),
  p_payload: z.object({
    params: z.object({ template: z.string(), to: z.string() }).strict(),
    data: z.object({ subscriber_id: z.string(), sealed_token: z.string() }).strict(),
  }),
});

/** A database with one subscriber; `issued` is what `issue_repermission` answers. */
function world({ suppressed = false, issued = true } = {}) {
  const hashes: string[] = [];
  const jobs: z.infer<typeof enqueued>[] = [];
  const { db } = emailWorld({
    suppressed: suppressed ? [READER] : [],
    tables: { subscribers: [{ id: SUBSCRIBER_ID, email: READER }] },
    rpc: {
      issue_repermission: (args) => {
        hashes.push(args.p_token_hash);
        return issued;
      },
      enqueue_job: (args) => {
        jobs.push(enqueued.parse(args));
        return "job-1";
      },
    },
  });
  return { db, hashes, jobs };
}

/** Every token made: a token is 32 bytes of `crypto.getRandomValues`, an IV is 12. */
function captureTokens(): string[] {
  const tokens: string[] = [];
  const original = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(
    <T extends ArrayBufferView | null>(array: T): T => {
      const filled = original(array);
      if (filled instanceof Uint8Array && filled.length === 32) tokens.push(toBase64Url(filled));
      return filled;
    },
  );
  return tokens;
}

describe("enqueueRepermissionEmail", () => {
  it("gives a candidate one job whose payload holds the sealed token and no raw token", async () => {
    const tokens = captureTokens();
    const { db, hashes, jobs } = world();
    expect(await enqueueRepermissionEmail(db, SUBSCRIBER_ID, KEY)).toBe("asked");
    const [raw] = tokens;
    const [hash] = hashes;
    const [job] = jobs;
    if (raw === undefined || hash === undefined || job === undefined) {
      throw new Error("no token, hash or job");
    }
    expect(jobs).toHaveLength(1);
    expect(hash).toBe(await sha256Hex(raw));
    expect(job.p_type).toBe("send_email");
    expect(job.p_idempotency_key).toBe(`send_email:${SUBSCRIBER_ID}:rp:${hash.slice(0, 12)}`);
    expect(job.p_payload.params).toEqual({ template: "repermission", to: "subscriber" });
    expect(job.p_payload.data.subscriber_id).toBe(SUBSCRIBER_ID);
    expect(await openToken(job.p_payload.data.sealed_token, KEY)).toBe(raw);
    expect(JSON.stringify(job)).not.toContain(raw);
  });

  it("skips a suppressed candidate: no ask and no job", async () => {
    const { db, hashes, jobs } = world({ suppressed: true });
    expect(await enqueueRepermissionEmail(db, SUBSCRIBER_ID, KEY)).toBe("suppressed");
    expect([hashes, jobs]).toEqual([[], []]);
  });

  it("enqueues nothing when issue_repermission returns false", async () => {
    const { db, hashes, jobs } = world({ issued: false });
    expect(await enqueueRepermissionEmail(db, SUBSCRIBER_ID, KEY)).toBe("not_consenting");
    expect([hashes.length, jobs]).toEqual([1, []]);
  });

  it("a key that cannot seal throws before the ask is stored", async () => {
    const { db, hashes, jobs } = world();
    await expect(enqueueRepermissionEmail(db, SUBSCRIBER_ID, "")).rejects.toThrow();
    expect([hashes, jobs]).toEqual([[], []]);
  });
});

describe("lapseSubscribers", () => {
  it("returns the count lapse_subscribers returned", async () => {
    const db = fakeDb({ rpc: { lapse_subscribers: () => 3 } });
    expect(await lapseSubscribers(db)).toBe(3);
  });
});
