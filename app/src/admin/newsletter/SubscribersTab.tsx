import type { ReactNode } from "react";
import type { SubscriberCountsView } from "../../domain/admin-newsletter";
import { formatNumber } from "../../lib/format";

function CountTable({
  caption,
  rows,
}: {
  caption: string;
  rows: readonly { label: string; value: number }[];
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col" className="admin-cell--end">
              Subscribers
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="admin-cell--end">{formatNumber(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Screen 13, second tab: how many people are in each state and each audience, never an address. An audience counts
 * confirmed, still subscribed people by the rule of `audiencesFor`; an address on the suppression list is dropped
 * only when a send is made, so a send can reach fewer.
 */
export function SubscribersTab({
  counts,
  loading = false,
  error = null,
  exportHref = null,
}: {
  counts: SubscriberCountsView | undefined;
  loading?: boolean;
  error?: string | null;
  /** The CSV download, offered to the roles that may export. */
  exportHref?: string | null;
}) {
  let body: ReactNode;
  if (error !== null) body = <p role="alert">{error}</p>;
  else if (loading || counts === undefined) body = <div className="admin-skeleton" />;
  else {
    body = (
      <div className="admin-subscribers">
        <CountTable
          caption="Subscribers by state"
          rows={[
            { label: "Confirmed", value: counts.confirmed },
            { label: "Waiting to confirm", value: counts.pending },
            { label: "Unsubscribed", value: counts.unsubscribed },
            { label: "All", value: counts.total },
          ]}
        />
        <CountTable
          caption="Subscribers by audience"
          rows={[
            { label: "Place Notes, all markets", value: counts.audiences["place-notes"] },
            { label: "California", value: counts.audiences["market-ca"] },
            { label: "New York", value: counts.audiences["market-ny"] },
            { label: "Florida", value: counts.audiences["market-fl"] },
          ]}
        />
        <p className="admin-field__hint">
          {formatNumber(counts.interest_only)} of all are interest signups, which are in no
          audience.
        </p>
      </div>
    );
  }
  return (
    <section aria-label="Subscribers">
      {exportHref === null ? null : (
        <div className="admin-toolbar">
          <a className="admin-button admin-button--quiet" href={exportHref} download>
            Export CSV
          </a>
        </div>
      )}
      {body}
    </section>
  );
}
