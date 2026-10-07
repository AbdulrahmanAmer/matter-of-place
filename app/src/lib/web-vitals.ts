import type { Metric } from "web-vitals";
import { track } from "./analytics";
import { reportClientError } from "./report-error";

const report = ({ name, value, id }: Metric): void => {
  track("web_vitals", { name, value, id });
};

/**
 * Field data for the audit robot (ASSUMED G11): the three Core Web Vitals join the analytics batch as
 * `web_vitals` events with `data = { name, value, id }`. The batch is anonymous and has no beacon of its own here.
 * The library loads after hydration in a chunk of its own, so it stays out of the first-load budget (R60); its
 * observers read the entries the browser already buffered.
 */
export function startWebVitals(): void {
  import("web-vitals")
    .then(({ onLCP, onCLS, onINP }) => {
      onLCP(report);
      onCLS(report);
      onINP(report);
    })
    .catch((error: unknown) => {
      reportClientError(error, { route: "web-vitals" });
    });
}
