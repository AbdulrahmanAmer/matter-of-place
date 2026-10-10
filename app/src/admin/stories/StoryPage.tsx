import { getRouteApi, notFound } from "@tanstack/react-router";
import { AdminApiError } from "../ui/admin-fetch";
import { AdminPending } from "../ui/AdminPending";
import { StoryEditor } from "./StoryEditor";
import { useStory } from "./stories-queries";

const route = getRouteApi("/admin/stories/$id");

/** Screen 14, one story. The route has no loader: the page reads its own story, and one that is not there is not found. */
export function StoryPage() {
  const { id } = route.useParams();
  const story = useStory(id);
  const detail = story.data;
  if (detail === undefined) {
    if (story.error === null) return <AdminPending />;
    if (story.error instanceof AdminApiError && story.error.status === 404) throw notFound();
    throw story.error;
  }
  return (
    <StoryEditor
      key={detail.id}
      story={detail}
      onReload={() =>
        story.refetch({ throwOnError: true }).then(({ data }) => {
          if (data === undefined) throw new Error("The story could not be reloaded.");
          return data;
        })
      }
    />
  );
}
