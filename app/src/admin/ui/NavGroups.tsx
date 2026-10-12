import { useRouter, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { activeScreen, areaLabels, areaOf, visibleNav, type navGroups } from "../nav";
import { Emblem } from "../../components/brand/emblem";
import { Wordmark } from "../../components/brand/wordmark";
import { useAdminMe } from "./admin-me";
import { NavIcon } from "./NavIcon";
import { WaitingCount } from "./AreaTabs";
import { useWaitingCounts } from "./waiting-counts";

/** The icon each area borrows from one of its screens. */
const areaIcon: Record<(typeof navGroups)[number], string> = {
  Today: "/admin",
  Inbox: "/admin/requests",
  Listings: "/admin/properties",
  Publishing: "/admin/channels",
  Clients: "/admin/invoices",
  Automation: "/admin/automation/recipes",
  Settings: "/admin/settings",
  System: "/admin/jobs",
};

/**
 * The left rail, on Obsidian from the top of the window to the foot: the emblem and the wordmark, then one link per
 * area (W3), each opening the area's first screen; the screens of the area are the tabs above the page (AreaTabs).
 */
export function NavGroups() {
  const router = useRouter();
  const { actions } = useAdminMe();
  const matched = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join("|"),
  });
  const area = areaOf(activeScreen(matched.split("|")));
  const sections = visibleNav({ hasRoute: (routeId) => routeId in router.routesById, actions });
  const counts = useWaitingCounts();
  // On a phone the areas fold under a Menu button; a wide screen always shows them (admin.css).
  const [open, setOpen] = useState(false);

  return (
    <nav className="admin-nav" aria-label="Admin" data-print="hide">
      <p className="admin-nav__brand">
        <Emblem className="admin-nav__emblem" />
        <Wordmark />
      </p>
      <button
        type="button"
        className="admin-nav__toggle"
        aria-expanded={open}
        aria-controls="admin-nav-groups"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? "Close" : "Menu"}
      </button>
      <div id="admin-nav-groups" className="admin-nav__groups" data-open={open ? "" : undefined}>
        <ul className="admin-nav__group">
          {sections.map(({ group, entries }) => {
            const first = entries[0];
            if (first === undefined) return null;
            return (
              <li key={group}>
                <a
                  className="admin-nav__link"
                  href={first.path}
                  aria-current={group === area ? "page" : undefined}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
                      return;
                    event.preventDefault();
                    setOpen(false);
                    void router.navigate({ href: first.path });
                  }}
                >
                  <NavIcon path={areaIcon[group]} />
                  {areaLabels[group]}
                  <WaitingCount
                    count={entries.reduce((sum, entry) => sum + (counts[entry.screen] ?? 0), 0)}
                  />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
