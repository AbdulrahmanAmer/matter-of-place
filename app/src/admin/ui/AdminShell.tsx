import { useSyncExternalStore, type ReactNode } from "react";
import { AdminMeContext, type AdminMe } from "./admin-me";
import { isUnavailable, subscribeUnavailable } from "./admin-fetch";
import { NavGroups } from "./NavGroups";
import { ToastProvider } from "./Toast";
import { TopBar } from "./TopBar";

/**
 * The console around a screen: the bar and the navigation (`.admin-shell`, hidden when printed) and the main
 * column. It returns the chrome and the column side by side so the print rule hides the first and keeps the
 * second; the layout puts both in `.admin-frame`. A 503 from the API shows its banner at the top of the column.
 */
export function AdminShell({ me, children }: { me: AdminMe; children: ReactNode }) {
  const unavailable = useSyncExternalStore(subscribeUnavailable, isUnavailable, () => false);
  return (
    <AdminMeContext value={me}>
      <ToastProvider>
        <a className="admin-skip" href="#admin-main">
          Skip to content
        </a>
        <div className="admin-shell" data-print="hide">
          <TopBar />
          <NavGroups />
        </div>
        <main id="admin-main" className="admin-main">
          {unavailable ? (
            <p className="admin-banner" role="status" data-print="hide">
              Service unavailable, retrying
            </p>
          ) : null}
          {children}
        </main>
      </ToastProvider>
    </AdminMeContext>
  );
}
