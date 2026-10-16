import { useUrlFilters } from "../ui/use-url-filters";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { ProposedPostCard } from "./ProposedPostCard";
import { proposedStatuses, proposedStatusLabels } from "./proposed-posts-contract";
import { proposedFilterNames, useProposedPosts } from "./proposed-posts-queries";

/**
 * The Publishing screen for posts a colleague proposed: each shown the way it will look on each channel, with the
 * decisions open to the actor. Nothing here writes except the three decisions, and each goes through the item-10 routes.
 */
export function ProposedPostsPage() {
  const filters = useUrlFilters(proposedFilterNames);
  const posts = useProposedPosts(filters.values);
  return (
    <>
      <h1>Proposed posts</h1>
      <p className="admin-lead">
        What the team proposes to post, as it will look on each channel. Nothing goes out until a
        person approves it.
      </p>
      <form className="admin-filters" aria-label="Filter the proposed posts">
        <Field label="Status">
          {(control) => (
            <select
              {...control}
              value={filters.values.status ?? ""}
              onChange={(event) => {
                filters.setFilters({ status: event.target.value });
              }}
            >
              <option value="">Every status</option>
              {proposedStatuses.map((status) => (
                <option key={status} value={status}>
                  {proposedStatusLabels[status]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>
      {posts.isPending ? <p className="admin-asset__note">Loading.</p> : null}
      {posts.error === null ? null : (
        <p className="admin-asset__error" role="alert">
          {posts.error.message}
        </p>
      )}
      {posts.data?.items.length === 0 ? (
        <EmptyState title="No proposed posts">
          Posts the team proposes for the channels appear here.
        </EmptyState>
      ) : null}
      <div className="admin-proposed__list">
        {posts.data?.items.map((post) => (
          <ProposedPostCard key={post.id} post={post} />
        ))}
      </div>
    </>
  );
}
