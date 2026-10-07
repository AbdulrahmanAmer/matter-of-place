import type { Channel } from "./types.ts";

// The YouTube block (B10 invariant 7, S48): it exists so the registry and screen 20 can name the channel, and it
// posts nothing. It has no network code; its step and its calls come by PR when YouTube is switched on.

/** The adapter of `youtube`: supports no kind, and every call answers `skipped_disabled` or `disabled`. */
export function createYouTubeChannel(): Channel {
  return {
    id: "youtube",
    supports: () => false,
    publish: () => Promise.resolve({ status: "skipped_disabled" }),
    metrics: () => Promise.resolve({ status: "skipped_disabled" }),
    health: () => Promise.resolve({ state: "disabled" }),
  };
}
