import { useState, type ComponentProps } from "react";
import {
  disabledChannels,
  liveChannels,
  socialChannelLabels,
  socialPostStatusLabels,
  socialPostStatuses,
  type SocialPost,
} from "../../domain/channels";
import { useAdminMe } from "../ui/admin-me";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { useCancel, useRefreshMetrics, useRetry, type ChannelFilterName } from "./channels-queries";
import { MetricsCell } from "./MetricsCell";
import { Permalink } from "./Permalink";

type Values = Readonly<Partial<Record<ChannelFilterName, string>>>;

type TableProps = ComponentProps<typeof DataTable<SocialPost>>;

const statusTone: Record<SocialPost["status"], Tone> = {
  scheduled: "info",
  posted: "ok",
  failed: "danger",
};

function ActionButton({
  label,
  pending,
  onClick,
}: {
  label: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="admin-button admin-button--quiet"
      disabled={pending}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

type Asking = "retry" | "cancel" | null;

/**
 * Retry for a failed row, Cancel for a scheduled one and a metrics refresh for a posted one, each for its own roles.
 * Retry and Cancel confirm first: Retry sends the post to a public platform, and its "post again" box is the
 * deliberate repost of invariant 2.
 */
function PostActions({ post }: { post: SocialPost }) {
  const { actions } = useAdminMe();
  const toast = useToast();
  const retry = useRetry();
  const cancel = useCancel();
  const refresh = useRefreshMetrics();
  const [asking, setAsking] = useState<Asking>(null);
  const [force, setForce] = useState(false);
  const label = socialChannelLabels[post.channel];
  const close = () => {
    setAsking(null);
    setForce(false);
  };
  const settle = (done: string) => ({
    onSuccess: () => {
      close();
      toast({ message: done });
    },
    onError: (error: Error) => {
      close();
      toast({ message: error.message, tone: "danger" });
    },
  });
  return (
    <div className="admin-actions">
      {post.status === "failed" && actions.includes("channels.retry") ? (
        <ActionButton
          label="Retry"
          pending={retry.isPending}
          onClick={() => {
            setAsking("retry");
          }}
        />
      ) : null}
      {post.status === "scheduled" && actions.includes("channels.cancel") ? (
        <ActionButton
          label="Cancel"
          pending={cancel.isPending}
          onClick={() => {
            setAsking("cancel");
          }}
        />
      ) : null}
      {post.status === "posted" && actions.includes("channels.metrics_refresh") ? (
        <ActionButton
          label="Refresh metrics"
          pending={refresh.isPending}
          onClick={() => {
            refresh.mutate(post.id, settle("Metrics refresh queued."));
          }}
        />
      ) : null}
      <ConfirmDialog
        open={asking === "retry"}
        title={`Retry the ${label} post`}
        confirmLabel="Retry"
        pending={retry.isPending}
        onCancel={close}
        onConfirm={() => {
          retry.mutate({ id: post.id, force }, settle("Retry queued."));
        }}
      >
        <p>The post is sent to {label} again.</p>
        <Field
          label="Post again even if this property is already posted on this channel"
          hint="Only for a deliberate repost, or when the first try ended with an unknown outcome."
        >
          {(control) => (
            <input
              {...control}
              type="checkbox"
              checked={force}
              onChange={(event) => {
                setForce(event.target.checked);
              }}
            />
          )}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "cancel"}
        title={`Cancel the ${label} post`}
        confirmLabel="Cancel post"
        danger
        pending={cancel.isPending}
        onCancel={close}
        onConfirm={() => {
          cancel.mutate(post.id, settle("Post cancelled."));
        }}
      >
        <p>The scheduled post is marked failed and will not be sent.</p>
      </ConfirmDialog>
    </div>
  );
}

const baseColumns: Column<SocialPost>[] = [
  { key: "channel", header: "Channel", render: (row) => socialChannelLabels[row.channel] },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <StatusPill label={socialPostStatusLabels[row.status]} tone={statusTone[row.status]} />
    ),
  },
  {
    key: "scheduled",
    header: "Scheduled",
    render: (row) => <LocalTime value={row.scheduled_at} />,
  },
  {
    key: "post",
    header: "Post",
    render: (row) => (row.posted_at === null ? "Not posted" : <Permalink url={row.permalink} />),
  },
  { key: "metrics", header: "Metrics", render: (row) => <MetricsCell metrics={row.metrics} /> },
  { key: "error", header: "Error", render: (row) => row.error ?? "None" },
];

function PostFilters({ values, onChange }: { values: Values; onChange: (next: Values) => void }) {
  return (
    <>
      <Field label="Channel">
        {(control) => (
          <select
            {...control}
            value={values.channel ?? ""}
            onChange={(event) => {
              onChange({ ...values, channel: event.target.value });
            }}
          >
            <option value="">All</option>
            {[...liveChannels, ...disabledChannels].map((channel) => (
              <option key={channel} value={channel}>
                {socialChannelLabels[channel]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Status">
        {(control) => (
          <select
            {...control}
            value={values.status ?? ""}
            onChange={(event) => {
              onChange({ ...values, status: event.target.value });
            }}
          >
            <option value="">All</option>
            {socialPostStatuses.map((status) => (
              <option key={status} value={status}>
                {socialPostStatusLabels[status]}
              </option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

/** Screen 12, below the cards: every post with its status, permalink, metrics and error, newest first. */
export function PostsTable({
  filters,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "empty" | "toolbar"> & {
  filters: { values: Values; onChange: (next: Values) => void };
}) {
  const { actions } = useAdminMe();
  const canAct = ["channels.retry", "channels.cancel", "channels.metrics_refresh"].some((action) =>
    actions.includes(action),
  );
  const columns: Column<SocialPost>[] = canAct
    ? [
        ...baseColumns,
        { key: "actions", header: "Actions", render: (row) => <PostActions post={row} /> },
      ]
    : baseColumns;
  const filtered = filters.values.channel !== undefined || filters.values.status !== undefined;
  return (
    <DataTable
      caption="Posts"
      columns={columns}
      rowId={(row) => row.id}
      toolbar={<PostFilters values={filters.values} onChange={filters.onChange} />}
      empty={
        filtered ? (
          <EmptyState title="No posts match">Nothing matches these filters.</EmptyState>
        ) : (
          <EmptyState title="Nothing has been posted yet">
            A post appears here once an approved asset is scheduled.
          </EmptyState>
        )
      }
      {...table}
    />
  );
}
