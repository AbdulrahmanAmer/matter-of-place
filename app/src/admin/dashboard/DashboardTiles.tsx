import type { ReactNode } from "react";
import { bounceRate, type Dashboard } from "../../domain/admin-dashboard";
import type { SubmissionState } from "../../domain/contracts";
import { formatNumber, pluralize } from "../../lib/format";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";

/** The states a request waits in for someone's move. */
const waitingStates: readonly SubmissionState[] = [
  "Submitted",
  "Under Review",
  "Awaiting Assets",
  "Invoice Issued",
  "Scheduled",
];

/** E2E-01: a post a takedown flagged is withdrawn within this many hours. */
const WITHDRAW_RULE_HOURS = 24;

const HOUR_MS = 3_600_000;

interface TileLink {
  href: string;
  /** The TanStack id of the list it opens; a list whose route is not built yet gets no link. */
  routeId: string;
}

/** One number and what it counts; it opens its filtered list once that list exists. */
function Tile({
  label,
  value,
  detail,
  link,
  hasRoute,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  link?: TileLink;
  hasRoute: (routeId: string) => boolean;
}) {
  const body = (
    <>
      <span className="admin-tile__label">{label}</span>
      <span className="admin-tile__value">{value}</span>
      {detail === undefined ? null : <span className="admin-tile__detail">{detail}</span>}
    </>
  );
  return (
    <li className="admin-tile" aria-label={label}>
      {link !== undefined && hasRoute(link.routeId) ? <a href={link.href}>{body}</a> : body}
    </li>
  );
}

/** Nothing is waiting on anyone: no request in a waiting state, no failed job, no asset, no post to withdraw. */
function isQuiet(data: Dashboard): boolean {
  return (
    waitingStates.every((state) => (data.counts[state] ?? 0) === 0) &&
    data.jobs.failed_24h === 0 &&
    data.jobs.dead === 0 &&
    data.assets_pending === 0 &&
    data.withdraw.open === 0
  );
}

/**
 * Screen 2's tiles: the requests waiting per state, the jobs and assets that need a person, the next digest, the
 * bounce rate and the posts left to withdraw. A failed health run shows first, in red. `now` dates the oldest post.
 */
export function DashboardTiles({
  data,
  now,
  hasRoute,
}: {
  data: Dashboard;
  now: number;
  hasRoute: (routeId: string) => boolean;
}) {
  const rate = bounceRate(data.email);
  const oldest = data.withdraw.oldest_at;
  const oldestHours = oldest === null ? 0 : Math.floor((now - Date.parse(oldest)) / HOUR_MS);
  return (
    <>
      {data.health?.failed === true ? (
        <div className="admin-banner admin-banner--danger" role="alert">
          The last health check failed
          {data.health.failed_checks.length === 0
            ? ""
            : `: ${data.health.failed_checks.join(", ")}`}
          . <LocalTime value={data.health.at} />
        </div>
      ) : null}
      {isQuiet(data) ? (
        <EmptyState title="Quiet day">Nothing is waiting on anyone.</EmptyState>
      ) : null}
      <ul className="admin-tiles" aria-label="Today">
        {waitingStates.map((state) => (
          <Tile
            key={state}
            label={state}
            value={formatNumber(data.counts[state] ?? 0)}
            link={{
              href: `/admin/requests?workflow_state=${encodeURIComponent(state)}`,
              routeId: "/admin/requests/",
            }}
            hasRoute={hasRoute}
          />
        ))}
        <Tile
          label="Jobs failed in 24 hours"
          value={formatNumber(data.jobs.failed_24h)}
          link={{ href: "/admin/jobs?status=failed", routeId: "/admin/jobs/" }}
          hasRoute={hasRoute}
        />
        <Tile
          label="Dead jobs"
          value={formatNumber(data.jobs.dead)}
          link={{ href: "/admin/jobs?status=dead", routeId: "/admin/jobs/" }}
          hasRoute={hasRoute}
        />
        <Tile
          label="Assets pending"
          value={formatNumber(data.assets_pending)}
          link={{ href: "/admin/assets?status=pending", routeId: "/admin/assets/" }}
          hasRoute={hasRoute}
        />
        <Tile
          label="Next digest"
          value={
            data.digest_next_at === null ? (
              "Not scheduled"
            ) : (
              <LocalTime value={data.digest_next_at} style="date" />
            )
          }
          link={{ href: "/admin/automation/settings", routeId: "/admin/automation/settings" }}
          hasRoute={hasRoute}
        />
        <Tile
          label="Bounce rate, 7 days"
          value={rate === null ? "No mail yet" : `${formatNumber(Math.round(rate * 1000) / 10)}%`}
          detail={
            rate === null
              ? undefined
              : `${formatNumber(data.email.bounced_7d)} of ${formatNumber(data.email.sent_7d)} sent`
          }
          hasRoute={hasRoute}
        />
        {data.withdraw.open === 0 ? null : (
          <Tile
            label="Withdraw by hand"
            value={formatNumber(data.withdraw.open)}
            detail={
              <>
                Oldest {formatNumber(oldestHours)} {pluralize(oldestHours, "hour")}{" "}
                {oldestHours >= WITHDRAW_RULE_HOURS ? (
                  <StatusPill label="Past 24 hours" tone="danger" />
                ) : (
                  <StatusPill label="Within 24 hours" tone="warning" />
                )}
              </>
            }
            link={{ href: "/admin/channels", routeId: "/admin/channels/" }}
            hasRoute={hasRoute}
          />
        )}
      </ul>
    </>
  );
}
