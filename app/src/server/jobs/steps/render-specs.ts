import { z } from "zod";
import { ogStaticKeys } from "../../../domain/assets.ts";

// The `heavy`, `maxAttempts` and `paramsSchema` of the five render steps. B8b invariant 1 puts every step spec in
// src/server/automation/step-specs.ts, which is not on main yet.
// STUB(B8b step 2): each module imports its own spec from step-specs.ts, and this file is deleted
export const renderSpecs = {
  render_variants: { heavy: true, maxAttempts: 12, paramsSchema: z.object({}).strict() },
  render_cover: { heavy: true, maxAttempts: 12, paramsSchema: z.object({}).strict() },
  render_carousel: {
    heavy: true,
    maxAttempts: 12,
    paramsSchema: z.object({ max_slides: z.number().int().min(6).max(8).optional() }).strict(),
  },
  render_story: { heavy: true, maxAttempts: 12, paramsSchema: z.object({}).strict() },
  render_og_static: {
    heavy: true,
    maxAttempts: 12,
    paramsSchema: z.object({ pages: z.array(z.enum(ogStaticKeys)).optional() }).strict(),
  },
} as const;
