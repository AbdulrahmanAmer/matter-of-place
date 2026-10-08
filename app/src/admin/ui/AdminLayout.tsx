import { getRouteApi, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { installClientErrorListeners } from "../../lib/report-error";
import { AdminShell } from "./AdminShell";

const layout = getRouteApi("/admin");

/** The component of `src/routes/admin.tsx`: the chrome around a signed-in page, the bare page on the sign-in screens. */
export function AdminLayout() {
  const { me } = layout.useRouteContext();
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
