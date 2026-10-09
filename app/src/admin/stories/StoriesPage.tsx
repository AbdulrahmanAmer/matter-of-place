import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";
import { RoleGate } from "../ui/RoleGate";
import { useUrlFilters } from "../ui/use-url-filters";
import { StoriesTable } from "./StoriesTable";
import { StoryEditor } from "./StoryEditor";
import { storyFilterNames, useStories } from "./stories-queries";

/** Screen 14: the stories, narrowed by state in the address, and the form of a new one. */
export function StoriesPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const filters = useUrlFilters(storyFilterNames);
  const list = useStories({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const failure = list.error;
  const next = list.data?.next_cursor ?? null;
  const open = (id: string) => {
    void router.navigate({ href: `/admin/stories/${id}` });
  };
  if (creating) {
    return <StoryEditor story={null} onCreated={open} />;
  }
  return (
    <>
      <h1>Stories</h1>
      <RoleGate action="stories.write">
        <div className="admin-actions">
          <button
            type="button"
            className="admin-button"
            onClick={() => {
              setCreating(true);
            }}
          >
            New story
          </button>
        </div>
      </RoleGate>
      <StoriesTable
        filters={{ values: filters.values, onChange: filters.setFilters }}
        rows={list.data?.items ?? []}
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
          open(row.id);
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: next !== null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (next !== null) filters.goNext(next);
          },
        }}
      />
    </>
  );
}
