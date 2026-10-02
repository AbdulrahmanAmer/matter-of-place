import { useEffect, useRef } from "react";
import { track, type AnalyticsEvent } from "../lib/analytics";

/**
 * Fires a view event once per `key` (a slug or name), after the page renders. `data` is derived
 * from `key`, so it is read at fire time and never restarts the effect.
 */
export function useTrackView(event: AnalyticsEvent, key: string, data: Record<string, unknown>) {
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });
  useEffect(() => {
    track(event, latest.current);
  }, [event, key]);
}
