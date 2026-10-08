import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { pageHead } from "../lib/seo";
import adminCss from "../styles/admin/index.css?url";

// The admin layout (invariant 20, FE-02): a sibling of the public `_site` layout, so no public chrome, consent
// notice, analytics or public stylesheet reaches `/admin`. It links the admin stylesheet and nothing else.
// Rendered in the browser only, so an admin page spends no Worker CPU on server rendering.
// A shell (ruling H66): the public entry loads this file, so everything but the router, `pageHead` and the
// stylesheet address is imported inside `beforeLoad` or by the lazy component.

// The sign-in screens are the only admin pages a visitor without a session may open.
const OPEN_PATHS = new Set(["/admin/sign-in", "/admin/auth/confirm"]);

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const [{ adminKeys, installAdminQueryDefaults }, { bindAdminFetch }, { fetchMe }] =
      await Promise.all([
        import("../admin/query"),
        import("../admin/ui/admin-fetch"),
        import("../admin/team/team-api"),
      ]);
    installAdminQueryDefaults(context.queryClient);
    bindAdminFetch({
      queryClient: context.queryClient,
      currentPath: () => `${window.location.pathname}${window.location.search}`,
      navigate: (to) => {
        window.location.assign(to);
      },
    });
    if (OPEN_PATHS.has(location.pathname.replace(/\/$/, ""))) return { me: null };
    const me = await context.queryClient.ensureQueryData({
      queryKey: adminKeys.me(),
      queryFn: fetchMe,
      staleTime: 60_000,
    });
    if (me === null) {
      throw redirect({ to: "/admin/sign-in", search: { next: location.href } });
    }
    return { me };
  },
  head: () => {
    const head = pageHead({
      title: "Admin",
      description: "The Matter of Place admin.",
      path: "/admin",
      noindex: true,
    });
    return { ...head, links: [...head.links, { rel: "stylesheet", href: adminCss }] };
  },
  component: lazyRouteComponent(() => import("../admin/ui/AdminLayout"), "AdminLayout"),
});
