import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { AdminShell } from "../admin/ui/AdminShell";
import { bindAdminFetch } from "../admin/ui/admin-fetch";
import { adminKeys, installAdminQueryDefaults } from "../admin/query";
import { fetchMe } from "../admin/team/team-api";
import { installClientErrorListeners } from "../lib/report-error";
import { pageHead } from "../lib/seo";
import adminCss from "../styles/admin/index.css?url";

// The admin layout (invariant 20, FE-02): a sibling of the public `_site` layout, so no public chrome, consent
// notice, analytics or public stylesheet reaches `/admin`. It links the admin stylesheet and nothing else.
// Rendered in the browser only, so an admin page spends no Worker CPU on server rendering.

// The sign-in screens are the only admin pages a visitor without a session may open.
const OPEN_PATHS = new Set(["/admin/sign-in", "/admin/auth/confirm"]);

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
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
  component: AdminLayout,
});

function AdminLayout() {
  const { me } = Route.useRouteContext();
  useEffect(() => installClientErrorListeners(), []);
  if (me === null) return <Outlet />;
  return (
    <div className="admin-frame">
      <AdminShell me={me}>
        <Outlet />
      </AdminShell>
    </div>
  );
}
