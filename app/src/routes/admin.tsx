import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { fetchMe } from "../admin/team/team-api";
import { pageHead } from "../lib/seo";

// The admin layout (invariant 20, FE-02): a sibling of the public `_site` layout, so no public chrome,
// consent notice, analytics or public stylesheet reaches `/admin`. Rendered in the browser only, so an
// admin page spends no Worker CPU on server rendering.

// The sign-in screens are the only admin pages a visitor without a session may open.
const OPEN_PATHS = new Set(["/admin/sign-in", "/admin/auth/confirm"]);

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    if (OPEN_PATHS.has(location.pathname.replace(/\/$/, ""))) return { me: null };
    const me = await context.queryClient.ensureQueryData({
      queryKey: ["admin", "me"],
      queryFn: fetchMe,
      staleTime: 60_000,
    });
    if (me === null) {
      throw redirect({ to: "/admin/sign-in", search: { next: location.href } });
    }
    return { me };
  },
  head: () =>
    pageHead({
      title: "Admin",
      description: "The Matter of Place admin.",
      path: "/admin",
      noindex: true,
    }),
  component: Outlet,
});
