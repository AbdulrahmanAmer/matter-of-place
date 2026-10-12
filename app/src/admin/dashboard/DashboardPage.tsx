import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { formatWeekday } from "../../lib/format";
import { AdminApiError } from "../ui/admin-fetch";
import { RoleGate } from "../ui/RoleGate";
import { ChannelHealthTile } from "./ChannelHealthTile";
import { DashboardTiles } from "./DashboardTiles";
import { useDashboard } from "./dashboard-queries";
import { GaugesTile } from "./GaugesTile";
import { TeamStrip } from "./TeamStrip";
import { TodayFeed } from "./TodayFeed";

/**
 * The component of `src/routes/admin/index.tsx`: the day in one screen, from one `GET /api/admin/dashboard`, read top
 * to bottom as what to do: the date, one sentence, the requests in motion, what needs a person, the team, then the
 * channels, the free-tier limits and the day's record.
 */
export function DashboardPage() {
  const router = useRouter();
  const dashboard = useDashboard();
  const [now] = useState(() => Date.now());
  const data = dashboard.data;
  const failure = dashboard.error;
  return (
    <>
      <header className="admin-dash-head">
        <p className="admin-eyebrow">{formatWeekday(now)}</p>
        <h1>Today</h1>
      </header>
      {failure === null ? null : (
        <p role="alert">
          {failure.message}
          {failure instanceof AdminApiError && failure.requestId !== undefined
            ? ` Request ${failure.requestId}.`
            : null}
        </p>
      )}
      {data === undefined ? (
        failure === null ? (
          <div className="admin-skeleton" />
        ) : null
      ) : (
        <>
          <DashboardTiles
            data={data}
            now={now}
            hasRoute={(routeId) => routeId in router.routesById}
          />
          <RoleGate action="workforce.office">
            <TeamStrip />
          </RoleGate>
          <div className="admin-dashboard__columns">
            <RoleGate action="channels.health">
              <ChannelHealthTile />
            </RoleGate>
            <GaugesTile data={data} />
          </div>
          <TodayFeed entries={data.today} />
        </>
      )}
    </>
  );
}
