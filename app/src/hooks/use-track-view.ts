import { useEffect } from "react";
import { track, type AnalyticsEvent } from "../lib/analytics";

/** Fires a view event once per `key` (a slug or name), after the page renders. */
export function useTrackView(event: AnalyticsEvent, key: string, data: Record<string, unknown>) {
  useEffect(() => {
    track(event, data);
    // `key` is the identity of the viewed thing; `data` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fire only when the viewed thing changes
  }, [event, key]);
}
