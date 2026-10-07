import { createFileRoute } from "@tanstack/react-router";
import { changePassword } from "../server/public/identity";

export const Route = createFileRoute("/.well-known/change-password")({
  server: {
    handlers: { ANY: ({ request, context }) => changePassword(request, context.requestId) },
  },
});
