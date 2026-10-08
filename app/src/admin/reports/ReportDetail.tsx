import { formatMoney } from "../../lib/format";
import { AdminApiError } from "../ui/admin-fetch";
import { useAdminMe } from "../ui/admin-me";
import { StatusPill } from "../ui/StatusPill";
import {
  count,
  NOT_MEASURED,
  percent,
  reportState,
  stateLabel,
  stateTone,
  weekLabel,
} from "./figures";
import { useEmailReport, useReport } from "./reports-queries";

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube",
};

/** Print starts the browser's own dialog, which saves a PDF; there is no server render (G22). */
function exportReport() {
  window.print();
}

function EmailButton({ id }: { id: string }) {
  const send = useEmailReport();
  const failure = send.error;
  const queued =
    send.data === undefined ? null : send.data.duplicate === true ? "Already queued" : "Queued";
  return (
    <>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={send.isPending}
        onClick={() => {
          send.mutate(id);
        }}
      >
        Email to submitter
      </button>
      <p role="status">
        {queued}
        {failure === null ? null : failure.message}
        {failure instanceof AdminApiError && failure.requestId !== undefined
          ? ` Request ${failure.requestId}.`
          : null}
      </p>
    </>
  );
}

/**
 * The open report of screen 22: its figures, the channel mix and the owned distribution. Export is the browser's print
 * (the print sheet shows this section alone); Email to submitter queues the `campaign_report` message.
 */
export function ReportDetail({ id }: { id: string }) {
  const { actions } = useAdminMe();
  const report = useReport(id);
  const data = report.data;
  if (report.error !== null) return <p role="alert">{report.error.message}</p>;
  if (data === undefined) return <div className="admin-skeleton" />;
  const state = reportState(data);
  return (
    <section className="admin-report" aria-label="Report">
      <header>
        <div>
          <h2>{data.property_name}</h2>
          <p>{weekLabel(data)}</p>
        </div>
        <StatusPill label={stateLabel[state]} tone={stateTone[state]} />
      </header>
      <div className="admin-actions" data-print="hide">
        {actions.includes("reports.export") ? (
          <button type="button" className="admin-button admin-button--quiet" onClick={exportReport}>
            Export
          </button>
        ) : null}
        {actions.includes("reports.email") ? <EmailButton id={id} /> : null}
      </div>
      <dl className="admin-report__facts">
        <div>
          <dt>Media spend</dt>
          <dd>{data.media_spend === 0 ? "Not tracked" : formatMoney(data.media_spend, "USD")}</dd>
        </div>
        <div>
          <dt>Impressions</dt>
          <dd>{count(data.impressions)}</dd>
        </div>
        <div>
          <dt>Reach</dt>
          <dd>{count(data.reach)}</dd>
        </div>
        <div>
          <dt>Clicks</dt>
          <dd>{count(data.clicks)}</dd>
        </div>
        <div>
          <dt>Video views</dt>
          <dd>{count(data.video_views)}</dd>
        </div>
        <div>
          <dt>CTR</dt>
          <dd>{percent(data.ctr)}</dd>
        </div>
        <div>
          <dt>Geography</dt>
          <dd>{Object.keys(data.geography).length === 0 ? NOT_MEASURED : "Measured"}</dd>
        </div>
        <div>
          <dt>Top creative</dt>
          <dd>{data.top_creative ?? "None yet"}</dd>
        </div>
        <div>
          <dt>Place Notes</dt>
          <dd>
            {count(data.owned_distribution.newsletter_issues)} issues,{" "}
            {count(data.owned_distribution.newsletter_clicks)} clicks
          </dd>
        </div>
      </dl>
      <h3>Channel mix</h3>
      {Object.keys(data.channel_mix).length === 0 ? (
        <p>No post went out this week.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>Channel mix</caption>
            <thead>
              <tr>
                <th scope="col">Channel</th>
                <th scope="col" className="admin-cell--end">
                  Posts
                </th>
                <th scope="col" className="admin-cell--end">
                  Reach
                </th>
                <th scope="col" className="admin-cell--end">
                  Views
                </th>
                <th scope="col" className="admin-cell--end">
                  Clicks
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.channel_mix).map(([channel, figures]) => (
                <tr key={channel}>
                  <th scope="row">{CHANNEL_LABELS[channel] ?? channel}</th>
                  <td className="admin-cell--end">{count(figures["posts"] ?? 0)}</td>
                  <td className="admin-cell--end">{count(figures["reach"])}</td>
                  <td className="admin-cell--end">{count(figures["views"])}</td>
                  <td className="admin-cell--end">{count(figures["clicks"] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
