import { createFileRoute, redirect } from "@tanstack/react-router";

/** Place Notes became Stories; the old address stays valid. */
export const Route = createFileRoute("/place-notes")({
  beforeLoad: () => {
    throw redirect({ to: "/stories", statusCode: 301 });
  },
});
