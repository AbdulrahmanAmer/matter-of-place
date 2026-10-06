import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { SiteChrome } from "../components/layout/site-chrome";
import { captureAttribution } from "../lib/attribution";
import { installClientErrorListeners } from "../lib/report-error";
import { t } from "../lib/strings";
import appCss from "../styles.css?url";

// The pathless layout of every public page (FE-02): public-only chrome and effects mount here, never in
// `__root.tsx`, so none of them reaches `/admin`.
export const Route = createFileRoute("/_site")({
  head: () => ({ links: [{ rel: "stylesheet", href: appCss }] }),
  component: SiteLayout,
});

function SiteLayout() {
  const router = useRouter();
  useEffect(() => installClientErrorListeners(), []);
  // B15 invariant 4: one page counted on the first client render and on every resolved navigation, public pages only.
  useEffect(() => {
    captureAttribution(router.state.location);
    return router.subscribe("onResolved", (event) => {
      if (event.hrefChanged) captureAttribution(event.toLocation);
    });
  }, [router]);
  return (
    <>
      <a className="skip-link" href="#content">
        {t.header.skipToContent}
      </a>
      <SiteChrome>
        <span id="content" className="skip-target" tabIndex={-1} />
        <Outlet />
      </SiteChrome>
    </>
  );
}
