import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";
import { RoleGate } from "../ui/RoleGate";
import { ChannelHealthTile } from "./ChannelHealthTile";
import { DashboardTiles } from "./DashboardTiles";
import { useDashboard } from "./dashboard-queries";
import { GaugesTile } from "./GaugesTile";
import { TodayFeed } from "./TodayFeed";

/** The component of `src/routes/admin/index.tsx`: the day in one screen, from one `GET /api/admin/dashboard`. */
export function DashboardPage() {
  const router = useRouter();
  const dashboard = useDashboard();
  const [now] = useState(() => Date.now());
  const data = dashboard.data;
  const failure = dashboard.error;
  return (
    <>
      <h1>Dashboard</h1>
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
