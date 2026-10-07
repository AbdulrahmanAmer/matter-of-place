import { z } from "zod";
import { createMetaChannel } from "../../channels/meta.ts";
import { postStep } from "../../channels/post-to-channel.ts";

// Step `post_meta` (B10): Instagram now, Facebook once its channel is switched on. `from_settings` tries both and
// `postToChannel` skips a channel the kind does not target or whose row is off.

const META_CHANNELS = ["instagram", "facebook"] as const;
const channelsSchema = z.object({
  channels: z.union([z.literal("from_settings"), z.array(z.enum(META_CHANNELS))]),
});

export const postMeta = postStep("post_meta", (params) => {
  const { channels } = channelsSchema.parse(params);
  return (channels === "from_settings" ? META_CHANNELS : channels).map((channel) =>
    createMetaChannel(channel),
  );
});
