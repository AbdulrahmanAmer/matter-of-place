import { describe, expect, it } from "vitest";
import {
  gateError,
  MAX_BYTES,
  PROVISIONAL,
  probeError,
  reelFiles,
  reelInput,
  resultFor,
} from "../../../scripts/render-reel.mjs";

const PASSED = { name: "duration", ok: true, value: "18.0s" };
const report = (checks: { name: string; ok: boolean; value: string }[]) => ({
  pass: checks.every((check) => check.ok),
  checks,
  coverage: 97.2,
  longest_static_s: 0.5,
  cuts: 3,
  avg_shot_s: 4.5,
  lufs: -18.23,
  true_peak: -2.29,
  flatness: 0.16,
});
const reel = {
  width: 1080,
  height: 1920,
  fps: 30,
  video: "h264",
  audio: "aac",
  duration: 18,
  bytes: 9_000_000,
};
const shots = ["a", "b", "c", "d"].map((key) => ({ key: `media/${key}.jpg` }));
const job = (data: unknown) => ({
  job_id: "3f2a9c1d-0000-4000-8000-000000000001",
  claim: "7d1e0c52-0000-4000-8000-000000000002",
  type: "render_reel",
  env: "preview",
  callback_url: "https://matterofplace.com/api/hooks/render/callback",
  payload: { params: {}, data },
});

describe("render-reel.mjs", () => {
  it("makes the first failed gate check a final gate_failed error", () => {
    const failed = report([
      PASSED,
      { name: "format", ok: false, value: "1080x1080" },
      { name: "cuts", ok: false, value: "9" },
    ]);
    const message = gateError(failed) ?? "";
    expect({
      message,
      result: resultFor(new Error(message)),
      passed: gateError(report([PASSED])),
    }).toEqual({
      message: "gate_failed: format 1080x1080",
      result: { status: "failed", error: "gate_failed: format 1080x1080", retryable: false },
      passed: null,
    });
  });

  it("reads the spec from job.payload.data.spec", () => {
    const spec = { kind: "reel", shots, sound: { bed: "wind", seed: 7 } };
    const input = reelInput(job({ property_id: "p1", revision: 2, spec, spec_hash: "h" }));
    expect(input).toEqual({ fixture: false, propertyId: "p1", revision: 2, spec });
  });

  it("retries a Storage outage and a failed download", () => {
    expect([
      resultFor(new Error("storage_unavailable")),
      resultFor(new Error("media-store: read of media/x.jpg answered 404")),
    ]).toEqual([
      { status: "failed", error: "storage_unavailable", retryable: true },
      {
        status: "failed",
        error: "media-store: read of media/x.jpg answered 404",
        retryable: true,
      },
    ]);
  });

  it("refuses a file over 12,000,000 bytes as a final probe size failure (H33 (8))", () => {
    const over = probeError({ ...reel, bytes: MAX_BYTES + 1 }) ?? "";
    expect({
      within: [probeError(reel), probeError({ ...reel, bytes: MAX_BYTES })],
      over,
      result: resultFor(new Error(over)),
    }).toEqual({
      within: [null, null],
      over: "gate_failed: probe size 12000001",
      result: { status: "failed", error: "gate_failed: probe size 12000001", retryable: false },
    });
  });

  it("leaves a final reel_timeout as the provisional result", () => {
    expect(PROVISIONAL).toEqual({ status: "failed", error: "reel_timeout", retryable: false });
  });

  it("names the files reel.<hash8>.mp4 and poster.<hash8>.jpg", () => {
    const files = reelFiles({
      propertyId: "p1",
      revision: 2,
      video: new Uint8Array([1, 2, 3]),
      poster: new Uint8Array([4, 5]),
    });
    expect(
      files.map(({ media_key, ...file }) => [media_key.replace(/[0-9a-f]{8}/, "<hash8>"), file]),
    ).toEqual([
      ["assets/p1/reel/r2/reel.<hash8>.mp4", { role: "video", w: 1080, h: 1920, bytes: 3 }],
      ["assets/p1/reel/r2/poster.<hash8>.jpg", { role: "poster", w: 1080, h: 1920, bytes: 2 }],
    ]);
  });
});
