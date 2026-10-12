import { useRouter, useRouterState } from "@tanstack/react-router";
import { activeScreen, areaTabs, visibleNav } from "../nav";
import { useAdminMe } from "./admin-me";

/**
 * The screens of the open area as tabs across the top of the page (W3): Inbox reads Approvals, Requests, Inquiries;
 * the open one is marked. An area with one screen draws nothing.
 */
export function AreaTabs() {
  const router = useRouter();
  const { actions } = useAdminMe();
  const matched = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join("|"),
  });
  const screen = activeScreen(matched.split("|"));
  const tabs = areaTabs(
    visibleNav({ hasRoute: (routeId) => routeId in router.routesById, actions }),
    screen,
  );
  if (tabs.length === 0) return null;
  return (
    <nav className="admin-area-tabs" aria-label="In this area" data-print="hide">
      {tabs.map((tab) => (
        <a
          key={tab.screen}
          className="admin-area-tabs__tab"
          href={tab.path}
          aria-current={tab.screen === screen ? "page" : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            void router.navigate({ href: tab.path });
          }}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
