import type { ComponentProps } from "react";
import { campaignChannels, type Campaign } from "../../domain/admin-campaigns";
import { formatMoney } from "../../lib/format";
import { marketName } from "../newsletter/interest-names";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { StatusPill } from "../ui/StatusPill";
import {
  campaignState,
  channelLabel,
  channelStatusLabel,
  channelStatusTone,
  datesLabel,
  stateLabel,
  stateTone,
} from "./figures";

type TableProps = ComponentProps<typeof DataTable<Campaign>>;

const money = (amount: number) => formatMoney(amount, "USD");

/** The five channels, each as its name and its status in words; a pill's colour never carries the status alone. */
function Channels({ campaign }: { campaign: Campaign }) {
  return (
    <>
      {campaignChannels.map((channel) => (
        <span key={channel}>
          <StatusPill
            label={`${channelLabel[channel]}: ${channelStatusLabel[campaign.channels[channel]]}`}
            tone={channelStatusTone[campaign.channels[channel]]}
          />{" "}
        </span>
      ))}
    </>
  );
}

/** `today` is the ISO date the states are read against; it is a prop so a test can fix it. */
export function CampaignsTable({
  today,
  ...table
}: { today: string } & Omit<TableProps, "caption" | "columns" | "rowId" | "empty">) {
  const columns: Column<Campaign>[] = [
    {
      key: "property",
      header: "Property",
      render: (row) => (
        <a className="admin-link" href={`/admin/properties/${row.property_id}`}>
          {row.property_title}
        </a>
      ),
    },
    { key: "market", header: "Market", render: (row) => marketName(row.market_slug) },
    { key: "package", header: "Package", render: (row) => row.package },
    {
      key: "state",
      header: "State",
      render: (row) => {
        const state = campaignState(row, today);
        return <StatusPill label={stateLabel[state]} tone={stateTone[state]} />;
      },
    },
    { key: "dates", header: "Dates", render: (row) => datesLabel(row) },
    { key: "budget", header: "Media budget", align: "end", render: (row) => money(row.media_budget) },
    {
      key: "fee",
      header: "Management fee",
      align: "end",
      render: (row) => money(row.management_fee),
    },
    { key: "channels", header: "Channels", render: (row) => <Channels campaign={row} /> },
    {
      key: "report",
      header: "Report",
      render: (row) =>
        row.report_count > 0 ? (
          <a className="admin-link" href={`/admin/reports?campaign=${row.id}`}>
            {row.report_count === 1 ? "1 weekly report" : `${String(row.report_count)} weekly reports`}
          </a>
        ) : (
          "None yet"
        ),
    },
  ];
  return (
    <DataTable
      caption="Campaigns"
      columns={columns}
      rowId={(row) => row.id}
      empty={
        <EmptyState title="No campaigns yet">
          A campaign appears here once a property has been paid for or waived and activated.
        </EmptyState>
      }
      {...table}
    />
  );
}
