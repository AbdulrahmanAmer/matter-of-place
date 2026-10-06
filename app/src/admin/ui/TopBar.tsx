import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Wordmark } from "../../components/brand/wordmark";
import { roleLabels } from "../../domain/contracts";
import { ActorBadge } from "./ActorBadge";
import { useAdminMe } from "./admin-me";

/**
 * The bar across the top: the wordmark, the environment (named on preview and local, silent on production), a
 * search that opens the request list with its text, and who is signed in. The search has no route of its own.
 */
export function TopBar() {
  const router = useRouter();
  const me = useAdminMe();
  const [text, setText] = useState("");

  return (
    <header className="admin-bar" data-print="hide">
      <span className="admin-wordmark">
        <Wordmark />
      </span>
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
      <ActorBadge name={me.roles.map((role) => roleLabels[role]).join(", ")} kind={me.kind} />
    </header>
  );
}
