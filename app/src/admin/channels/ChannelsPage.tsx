import { socialPostPageSize } from "../../domain/channels";
import { AdminApiError } from "../ui/admin-fetch";
import { useUrlFilters } from "../ui/use-url-filters";
import { channelFilterNames, usePosts } from "./channels-queries";
import { ChannelCards } from "./ChannelCards";
import { PostsTable } from "./PostsTable";
import { WithdrawList } from "./WithdrawList";

/**
 * Screen 12. The posts table pages by number: the address's `cursor` holds the page, so the Next and Previous of the
 * shared table work as they do on the keyset screens. A `post` in the address (the link of a failure mail) narrows the
 * table to that one row, with its error and Retry.
 */
export function ChannelsPage() {
  const filters = useUrlFilters(channelFilterNames);
  const page = Math.max(1, Number(filters.cursor) || 1);
  const posts = usePosts(filters.values, page);
  const failure = posts.error;
  const one = filters.values.post !== undefined;
  const lastPage = Math.ceil((posts.data?.total ?? 0) / socialPostPageSize);
  return (
    <>
      <h1>Channels</h1>
      <ChannelCards />
      <WithdrawList />
      {one ? (
        <p>
          One post, from a link. <a href="/admin/channels">Show every post</a>
        </p>
      ) : null}
      <PostsTable
        filters={{
          values: filters.values,
          onChange: ({ channel, status }) => {
            filters.setFilters({
              ...(channel === undefined ? {} : { channel }),
              ...(status === undefined ? {} : { status }),
            });
          },
        }}
        rows={posts.data?.items ?? []}
        loading={posts.isPending}
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
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: !one && page < lastPage,
          onPrevious: filters.goPrevious,
          onNext: () => {
            filters.goNext(String(page + 1));
          },
        }}
      />
    </>
  );
}
