import { postStep } from "../../channels/post-to-channel.ts";
import { createXChannel } from "../../channels/x.ts";

// Step `post_x` (B10): the cover with the short caption (invariant 2 and Contract, "Which asset goes where").
export const postX = postStep("post_x", () => [createXChannel()]);
