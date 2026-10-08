import { createFileRoute } from "@tanstack/react-router";
import { uploadUrlAnswerSchema, uploadUrlInputSchema } from "../../../domain/admin-media";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { createUploadUrl } from "../../../server/media/service";

export const Route = createFileRoute("/api/admin/media/upload-url")({
  server: {
    handlers: {
      POST: defineAdminRoute({
        method: "POST",
        action: "media.upload_url",
        input: uploadUrlInputSchema,
        output: uploadUrlAnswerSchema,
        handler: (ctx, input) => createUploadUrl(ctx.actor, ctx.db, input),
      }),
    },
  },
});
