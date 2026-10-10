import { EmptyState } from "../ui/EmptyState";

export function StoryNotFound() {
  return (
    <EmptyState title="Story not found">
      This story does not exist, or the link is no longer valid.
    </EmptyState>
  );
}
