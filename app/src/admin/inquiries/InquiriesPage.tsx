import { getRouteApi } from "@tanstack/react-router";
import { AdminApiError } from "../ui/admin-fetch";
import { useUrlFilters } from "../ui/use-url-filters";
import { InquiriesTable } from "./InquiriesTable";
import { InquiryDrawer } from "./InquiryDrawer";
import { inquiryFilterNames, useAssignees, useInquiries } from "./inquiries-queries";

const route = getRouteApi("/admin/inquiries/");

/** The open inquiry lives in the address beside the filters: `?id=` is the link of the `inquiry.received` mail (B5). */
function useOpenInquiry() {
  const { id } = route.useSearch();
  const navigate = route.useNavigate();
  const show = (next: string | undefined) => {
    void navigate({ search: (search) => ({ ...search, id: next }) });
  };
  return { id: id ?? null, show };
}

/** Screen 11: the list, narrowed by state in the address, and the drawer of the inquiry `?id=` names. */
export function InquiriesPage() {
  const filters = useUrlFilters(inquiryFilterNames);
  const openInquiry = useOpenInquiry();
  const list = useInquiries({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const assignees = useAssignees().data?.items ?? [];
  const names = new Map(assignees.map((assignee) => [assignee.id, assignee.name]));
  const page = list.data;
  const failure = list.error;
  return (
    <>
      <h1>Inquiries</h1>
      <InquiriesTable
        filters={{ values: filters.values, onChange: filters.setFilters }}
        assigneeName={(id) => names.get(id) ?? "A former editor"}
        rows={page?.items ?? []}
        loading={list.isPending}
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
          openInquiry.show(row.id);
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: page?.next_cursor != null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (page?.next_cursor != null) filters.goNext(page.next_cursor);
          },
        }}
      />
      {openInquiry.id === null ? null : (
        <InquiryDrawer
          key={openInquiry.id}
          id={openInquiry.id}
          assignees={assignees}
          onClose={() => {
            openInquiry.show(undefined);
          }}
        />
      )}
    </>
  );
}
