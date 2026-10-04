import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SiteChrome } from "../components/layout/site-chrome";
import appCss from "../styles.css?url";

// The pathless layout of every public page (FE-02): public-only chrome and effects mount here, never in
// `__root.tsx`, so none of them reaches `/admin`.
export const Route = createFileRoute("/_site")({
  head: () => ({ links: [{ rel: "stylesheet", href: appCss }] }),
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <SiteChrome>
      <Outlet />
    </SiteChrome>
  );
}
