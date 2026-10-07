import { createFileRoute } from "@tanstack/react-router";
import { securityTxt } from "../server/public/identity";

// ANY, not GET and HEAD: a method with no handler renders the page shell as 200 (G-022).
export const Route = createFileRoute("/.well-known/security.txt")({
  server: {
    handlers: { ANY: ({ request, context }) => securityTxt(request, context.requestId) },
  },
});
