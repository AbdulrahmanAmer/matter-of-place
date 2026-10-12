import { useRouter, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { activeScreen, visibleNav } from "../nav";
import { Emblem } from "../../components/brand/emblem";
import { Wordmark } from "../../components/brand/wordmark";
import { useAdminMe } from "./admin-me";
import { NavIcon } from "./NavIcon";

/**
 * The left rail, on Obsidian from the top of the window to the foot: the emblem and the wordmark, then six groups of
 * links drawn from `nav.ts`, each with its icon, the open screen's link marked.
 */
export function NavGroups() {
  const router = useRouter();
  const { actions } = useAdminMe();
  const matched = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join("|"),
  });
  const active = activeScreen(matched.split("|"));
  const sections = visibleNav({ hasRoute: (routeId) => routeId in router.routesById, actions });
  // On a phone the groups fold under a Menu button; a wide screen always shows them (admin.css).
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
                      setOpen(false);
                      void router.navigate({ href: entry.path });
                    }}
                  >
                    <NavIcon path={entry.path} />
                    {entry.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
