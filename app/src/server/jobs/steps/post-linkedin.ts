import { createLinkedInChannel } from "../../channels/linkedin.ts";
import { postStep } from "../../channels/post-to-channel.ts";

// Step `post_linkedin` (B10): the cover, or the carousel set once `settings.linkedin.multi_image` is true.
export const postLinkedIn = postStep("post_linkedin", () => [createLinkedInChannel()]);
