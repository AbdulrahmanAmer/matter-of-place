import { useRouter, useRouterState } from "@tanstack/react-router";
import { activeScreen, visibleNav } from "../nav";
import { useAdminMe } from "./admin-me";

/** The left navigation: six groups of links, drawn from `nav.ts`, the open screen's link marked. */
export function NavGroups() {
  const router = useRouter();
  const { actions } = useAdminMe();
  const matched = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join("|"),
  });
  const active = activeScreen(matched.split("|"));
  const sections = visibleNav({ hasRoute: (routeId) => routeId in router.routesById, actions });

  return (
    <nav className="admin-nav" aria-label="Admin" data-print="hide">
      {sections.map(({ group, entries }) => (
        <div key={group} className="admin-nav__group">
          <p className="admin-eyebrow admin-nav__label">{group}</p>
          <ul>
            {entries.map((entry) => (
              <li key={entry.screen}>
                <a
                  className="admin-nav__link"
                  href={entry.path}
                  aria-current={entry.screen === active ? "page" : undefined}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
                      return;
                    event.preventDefault();
                    void router.navigate({ href: entry.path });
                  }}
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
