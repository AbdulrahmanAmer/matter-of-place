import { useRouter, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { roleLabels } from "../../domain/contracts";
import { activeScreen, navEntries } from "../nav";
import { PasswordDialog } from "../team/PasswordDialog";
import { SideChat } from "../workforce/SideChat";
import { ActorBadge } from "./ActorBadge";
import { useAdminMe } from "./admin-me";

/**
 * The bar across the main column: where you are (the group and the screen), the environment (named on preview and
 * local, silent on production), a search that opens the request list with its text, and who is signed in. The
 * search has no route of its own; the wordmark lives at the head of the rail.
 */
export function TopBar() {
  const router = useRouter();
  const me = useAdminMe();
  const [text, setText] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const matched = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join("|"),
  });
  const screen = activeScreen(matched.split("|"));
  const here = navEntries.find((entry) => entry.screen === screen);

  return (
    <header className="admin-bar" data-print="hide">
      {here === undefined ? null : (
        <p className="admin-bar__where">
          {here.group === undefined ? null : <span className="admin-eyebrow">{here.group}</span>}
          <span className="admin-bar__screen">{here.label}</span>
        </p>
      )}
      {me.environment === "production" ? null : <span className="admin-env">{me.environment}</span>}
      <form
        className="admin-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const search = text.trim();
          if (search === "") return;
          void router.navigate({ href: `/admin/requests?search=${encodeURIComponent(search)}` });
        }}
      >
        <input
          type="search"
          name="search"
          aria-label="Search requests"
          placeholder="Search requests"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </form>
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
          <SideChat
            open={chatOpen}
            onClose={() => {
              setChatOpen(false);
            }}
          />
        </>
      ) : null}
      <ActorBadge name={me.roles.map((role) => roleLabels[role]).join(", ")} kind={me.kind} />
      {me.kind === "human" && me.actions.includes("dashboard.password") ? (
        <>
          <button
            type="button"
            className="admin-bar__password"
            onClick={() => {
              setPasswordOpen(true);
            }}
          >
            Password
          </button>
          <PasswordDialog
            open={passwordOpen}
            onClose={() => {
              setPasswordOpen(false);
            }}
          />
        </>
      ) : null}
    </header>
  );
}
