import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { activeScreen, areaLabels, areaOf, navEntries } from "../nav";
import { MatterPanel } from "../workforce/MatterPanel";
import { AccountMenu } from "./AccountMenu";
import { AdminSearch } from "./AdminSearch";
import { useAdminMe } from "./admin-me";

/**
 * The bar across the main column: where you are (the group and the screen), the environment (named on preview and
 * local, silent on production), one search across the records (`AdminSearch`), and who is signed in. The
 * search has no route of its own; the wordmark lives at the head of the rail. The account menu (W3) holds the
 * password and sign-out.
 */
export function TopBar() {
  const me = useAdminMe();
  const [chatOpen, setChatOpen] = useState(false);
  const matched = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join("|"),
  });
  const screen = activeScreen(matched.split("|"));
  const here = navEntries.find((entry) => entry.screen === screen);
  const area = areaOf(screen);

  return (
    <header className="admin-bar" data-print="hide">
      {here === undefined ? null : (
        <p className="admin-bar__where">
          {area === null ? null : <span className="admin-eyebrow">{areaLabels[area]}</span>}
          <span className="admin-bar__screen">{here.label}</span>
        </p>
      )}
      {me.environment === "production" ? null : <span className="admin-env">{me.environment}</span>}
      <AdminSearch />
      {me.actions.includes("workforce.post_message") ? (
        <>
          <button
            type="button"
            className="admin-bar__matter"
            onClick={() => {
              setChatOpen(true);
            }}
          >
            Matter
          </button>
          <MatterPanel
            open={chatOpen}
            onClose={() => {
              setChatOpen(false);
            }}
          />
        </>
      ) : null}
      <AccountMenu />
    </header>
  );
}
