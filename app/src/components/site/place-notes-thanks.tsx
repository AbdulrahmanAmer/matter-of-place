import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { track } from "../../lib/analytics";
import { t } from "../../lib/strings";
import { Emblem } from "../brand/emblem";

export type ThanksStatus = "confirmed" | "expired";

/**
 * Where the confirm link of Place Notes or of a market's interest signup lands (operator, 2026-10-19): one centred note
 * between the header and the footer on the not-found band. The emblem assembles as in the launch film (M5), then the
 * title rises and a hairline draws across; CSS only, so it runs before any script and stops under reduced motion.
 */
export function PlaceNotesThanks({ status }: { status: ThanksStatus }) {
  const copy = t.newsletter.thanks[status];
  useEffect(() => {
    if (status === "confirmed") track("newsletter_confirmed");
  }, [status]);
  return (
    <main className="thanks">
      <div>
        <Emblem className="thanks-emblem" />
        <p className="eyebrow">{t.newsletter.thanks.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>
        <span className="thanks-rule" aria-hidden="true" />
        <div className="not-found-links thanks-links">
          <Link to={status === "confirmed" ? "/stories" : "/place-notes"} className="text-link">
            {copy.action}
          </Link>
          <Link to="/" className="text-link">
            {t.newsletter.thanks.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
