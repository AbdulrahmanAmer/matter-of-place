import { useState } from "react";
import { reportPageSize } from "../../domain/admin-reports";
import { AdminApiError } from "../ui/admin-fetch";
import { useUrlFilters } from "../ui/use-url-filters";
import { ReportDetail } from "./ReportDetail";
import { ReportTable } from "./ReportTable";
import { reportFilterNames, useReports } from "./reports-queries";

/**
 * Screen 22. The table pages by number (the address's `cursor` holds the page) and may be narrowed to one campaign
 * with `?campaign=`; a row opens its report below, and the print sheet shows that report alone.
 */
export function ReportsPage() {
  const filters = useUrlFilters(reportFilterNames);
  const page = Math.max(1, Number(filters.cursor) || 1);
  const reports = useReports(filters.values.campaign, page);
  const [open, setOpen] = useState<string | null>(null);
  const failure = reports.error;
  const lastPage = Math.ceil((reports.data?.total ?? 0) / reportPageSize);
  return (
    <>
      <div data-print="hide">
        <h1>Reports</h1>
        <ReportTable
          rows={reports.data?.items ?? []}
          loading={reports.isPending}
          error={
            failure === null
              ? null
              : {
                  message: failure.message,
                  ...(failure instanceof AdminApiError && failure.requestId !== undefined
                    ? { requestId: failure.requestId }
                    : {}),
                }
          }
          onOpen={(row) => {
            setOpen(row.id);
          }}
          pager={{
            hasPrevious: filters.hasPrevious,
            hasNext: page < lastPage,
            onPrevious: filters.goPrevious,
            onNext: () => {
              filters.goNext(String(page + 1));
            },
          }}
        />
      </div>
      {open === null ? null : <ReportDetail key={open} id={open} />}
    </>
  );
}
