import type { ComponentProps } from "react";
import type { Report } from "../../domain/reports";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { StatusPill } from "../ui/StatusPill";
import { count, percent, reportState, stateLabel, stateTone, weekLabel } from "./figures";

type TableProps = ComponentProps<typeof DataTable<Report>>;

const columns: Column<Report>[] = [
  { key: "property", header: "Property", render: (row) => row.property_name },
  { key: "week", header: "Week", render: (row) => weekLabel(row) },
  {
    key: "state",
    header: "State",
    render: (row) => {
      const state = reportState(row);
      return <StatusPill label={stateLabel[state]} tone={stateTone[state]} />;
    },
  },
  {
    key: "impressions",
    header: "Impressions",
    align: "end",
    render: (row) => count(row.impressions),
  },
  { key: "reach", header: "Reach", align: "end", render: (row) => count(row.reach) },
  { key: "clicks", header: "Clicks", align: "end", render: (row) => count(row.clicks) },
  { key: "video", header: "Video views", align: "end", render: (row) => count(row.video_views) },
  { key: "ctr", header: "CTR", align: "end", render: (row) => percent(row.ctr) },
];

/** Screen 22, top: one row per campaign and week, newest first; a row opens the report below it. */
export function ReportTable(table: Omit<TableProps, "caption" | "columns" | "rowId" | "empty">) {
  return (
    <DataTable
      caption="Reports"
      columns={columns}
      rowId={(row) => row.id}
      empty={
        <EmptyState title="No reports yet">
          A report appears for each week once the first post of a property has gone out.
        </EmptyState>
      }
      {...table}
    />
  );
}
