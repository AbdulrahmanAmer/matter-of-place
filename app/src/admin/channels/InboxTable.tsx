import { inboxStateLabels, type InboxItem } from "../../domain/channels";
import { AdminApiError } from "../ui/admin-fetch";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { useInbox } from "./channels-queries";

// W8 item 4: the comments on our Instagram posts and the messages of our conversations, under the posts they belong
// to on screen 12, because a person who looks at a post looks here for what people said about it. With a `post` in the
// address (the table's one-post link) only that post's comments show. The words are a person's own, shown as text and
// never as markup; a reply is drafted by the Social colleague and decided in Approvals.

const stateTone: Record<InboxItem["state"], Tone> = {
  new: "info",
  proposed: "warning",
  answered: "ok",
  ignored: "neutral",
};

const replyWords: Record<NonNullable<InboxItem["reply_state"]>, string> = {
  sending: "Sending",
  sent: "Sent",
  refused: "Not sent: posting is off here",
  failed: "Not sent",
  unknown: "Not known: check Instagram",
};

function ReplyCell({ item }: { item: InboxItem }) {
  if (item.reply_state === null) return item.state === "proposed" ? "Waits in Approvals" : "None";
  const words = replyWords[item.reply_state];
  if (item.reply_state === "sent" && item.replied_at !== null)
    return (
      <>
        {words} <LocalTime value={item.replied_at} />
      </>
    );
  return item.reply_error === null || item.reply_state === "refused"
    ? words
    : `${words}: ${item.reply_error}`;
}

const columns: Column<InboxItem>[] = [
  {
    key: "kind",
    header: "Kind",
    render: (row) => (row.kind === "comment" ? "Comment" : "Message"),
  },
  {
    key: "post",
    header: "Post",
    render: (row) =>
      row.social_post_id === null ? (
        "Conversation"
      ) : (
        <a href={`/admin/channels?post=${row.social_post_id}`}>Show this post</a>
      ),
  },
  {
    key: "from",
    header: "From",
    render: (row) => (row.author_handle === "" ? "Not given" : `@${row.author_handle}`),
  },
  { key: "text", header: "Text", render: (row) => row.body },
  { key: "received", header: "Received", render: (row) => <LocalTime value={row.received_at} /> },
  {
    key: "state",
    header: "State",
    render: (row) => <StatusPill label={inboxStateLabels[row.state]} tone={stateTone[row.state]} />,
  },
  { key: "reply", header: "Reply", render: (row) => <ReplyCell item={row} /> },
];

/** Screen 12, under the posts: the comments and messages with their state, newest first. */
export function InboxTable({ post }: { post: string | undefined }) {
  const inbox = useInbox(post);
  const failure = inbox.error;
  return (
    <DataTable
      caption={post === undefined ? "Comments and messages" : "Comments on this post"}
      columns={columns}
      rows={inbox.data?.items ?? []}
      rowId={(row) => row.id}
      loading={inbox.isPending}
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
      empty={
        <EmptyState title="No comments or messages yet">
          They are read from Instagram every 15 minutes once Instagram is on.
        </EmptyState>
      }
    />
  );
}
