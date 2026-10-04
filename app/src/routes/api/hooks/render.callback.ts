import { createFileRoute } from "@tanstack/react-router";
import { handleRenderCallback } from "../../../server/hooks/render";
import { getDb } from "../../../server/lib/db";

export const Route = createFileRoute("/api/hooks/render/callback")({
  server: {
    handlers: {
      POST: ({ request, context }) =>
        handleRenderCallback(getDb(), request, process.env, context.requestId),
    },
  },
});
