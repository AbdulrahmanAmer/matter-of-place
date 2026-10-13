import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { SiteChrome } from "../components/layout/site-chrome";
import { SiteMotion } from "../components/layout/site-motion";
import { VisionFilters } from "../components/layout/vision-filters";
import { Ga4Loader } from "../components/site/ga4-loader";
import { captureAttribution } from "../lib/attribution";
import { installClientErrorListeners } from "../lib/report-error";
import { t } from "../lib/strings";
import { registerServiceWorker } from "../lib/sw-register";
import { startWebVitals } from "../lib/web-vitals";
import appCss from "../styles.css?url";

// The accessibility widget loads after the page; a stored choice is already drawn by the head script (FE-03).
const AccessPanel = lazy(() =>
  import("../components/layout/access-panel").then((m) => ({ default: m.AccessPanel })),
);

// The pathless layout of every public page (FE-02): public-only chrome and effects mount here, never in
// `__root.tsx`, so none of them reaches `/admin`.
export const Route = createFileRoute("/_site")({
  head: () => ({ links: [{ rel: "stylesheet", href: appCss }] }),
  component: SiteLayout,
});

function SiteLayout() {
  const router = useRouter();
  // The accessibility panel exists only in the browser: rendered on the server, its lazy chunk would suspend and the
  // page would switch to client rendering (csp-inline.test.ts). A stored choice is already drawn by the head script.
  const inBrowser = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  useEffect(() => installClientErrorListeners(), []);
  useEffect(() => {
    startWebVitals();
    registerServiceWorker();
  }, []);
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
      <Ga4Loader />
      <SiteMotion />
      <VisionFilters />
      {inBrowser && (
        <Suspense fallback={null}>
          <AccessPanel />
        </Suspense>
      )}
    </>
  );
}
