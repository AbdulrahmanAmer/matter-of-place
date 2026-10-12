import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { messageSchema, postMessageSchema, threadSchema } from "../../../domain/workforce";
import { defineAdminRoute } from "../../../server/lib/admin-route";
import { listMessages, postMessage } from "../../../server/workforce/service";

// W1: the team chat and each employee's direct thread. A post wakes whoever it is for.
export const Route = createFileRoute("/api/admin/workforce/messages")({
  server: {
    handlers: {
      GET: defineAdminRoute({
        method: "GET",
        action: "workforce.messages",
        input: z.object({ thread: threadSchema.default("team") }),
        output: z.object({ items: z.array(messageSchema) }),
        handler: (ctx, input) => listMessages(ctx.actor, ctx.db, input.thread),
      }),
      POST: defineAdminRoute({
        method: "POST",
        action: "workforce.post_message",
        input: postMessageSchema,
        output: z.object({ id: z.string().uuid(), woke: z.array(z.string()) }),
        handler: (ctx, input) => postMessage(ctx.actor, ctx.db, input),
      }),
    },
  },
});
