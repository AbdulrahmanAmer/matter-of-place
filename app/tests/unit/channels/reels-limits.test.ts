import { describe, expect, it } from "vitest";
import limits from "../../fixtures/graph/reels-limits.json";

// What scripts/render-reel.mjs probes for and refuses to hand on when it differs (B12): a 1080x1920 picture at 30 fps,
// h264 with aac, 15 to 25 seconds, at most MAX_BYTES.
const REEL = {
  width: 1080,
  height: 1920,
  fps: 30,
  video: "h264",
  audio: "aac",
  seconds: { min: 15, max: 25 },
  maxBytes: 12_000_000,
};

describe("the reel against Meta's recorded limits", () => {
  it("keeps the codecs inside the recorded lists", () => {
    expect(limits.video_codecs).toContain(REEL.video);
    expect(limits.audio_codecs).toContain(REEL.audio);
  });

  it("keeps the picture and the frame rate inside the recorded limits", () => {
    const aspect = REEL.width / REEL.height;
    expect(aspect).toBeGreaterThanOrEqual(limits.aspect.min);
    expect(aspect).toBeLessThanOrEqual(limits.aspect.max);
    expect(REEL.width).toBeLessThanOrEqual(limits.max_width_px);
    expect(REEL.fps).toBeGreaterThanOrEqual(limits.fps.min);
    expect(REEL.fps).toBeLessThanOrEqual(limits.fps.max);
  });

  it("keeps the duration and the file size inside the recorded limits", () => {
    expect(REEL.seconds.min).toBeGreaterThanOrEqual(limits.duration_s.min);
    expect(REEL.seconds.max).toBeLessThanOrEqual(limits.duration_s.max);
    expect(REEL.maxBytes).toBeLessThanOrEqual(limits.max_size_mb * 1_000_000);
  });

  it("says where the limits were read", () => {
    expect(["docs", "live"]).toContain(limits.source);
  });
});
