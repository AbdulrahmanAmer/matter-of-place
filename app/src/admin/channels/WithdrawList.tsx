import { useState } from "react";
import { socialChannelLabels, type SocialPost } from "../../domain/channels";
import { pluralize } from "../../lib/format";
import { useAdminMe } from "../ui/admin-me";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable, type Column } from "../ui/DataTable";
import { useToast } from "../ui/use-toast";
import { useMarkWithdrawn, useWithdrawList } from "./channels-queries";
import { Permalink } from "./Permalink";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function ageOf(since: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(since));
  const [count, unit] =
    elapsed < DAY_MS
      ? [Math.floor(elapsed / HOUR_MS), "hour"]
      : [Math.floor(elapsed / DAY_MS), "day"];
  return `${String(count)} ${pluralize(count, unit)}`;
}

/**
 * "Withdraw by hand" (invariant 10): posts of a property taken down for a rights reason, which a person deletes on the
 * platform and then marks done. The platforms are never called from here.
 */
export function WithdrawList() {
  const { actions } = useAdminMe();
  const toast = useToast();
  const list = useWithdrawList();
  const done = useMarkWithdrawn();
  const [now] = useState(() => Date.now());
  const [asking, setAsking] = useState<SocialPost | null>(null);
  const failure = list.error;
  const columns: Column<SocialPost>[] = [
    { key: "channel", header: "Channel", render: (row) => socialChannelLabels[row.channel] },
    { key: "post", header: "Post", render: (row) => <Permalink url={row.permalink} /> },
    {
      key: "age",
      header: "Waiting",
      render: (row) =>
        row.withdraw_required_at === null ? "" : ageOf(row.withdraw_required_at, now),
    },
  ];
  if (actions.includes("channels.mark_withdrawn")) {
    columns.push({
      key: "done",
      header: "Deleted",
      render: (row) => (
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={done.isPending}
          onClick={() => {
            setAsking(row);
          }}
        >
          Done
        </button>
      ),
    });
  }
  return (
    <section aria-label="Withdraw by hand" className="admin-withdraw">
      <h2>Withdraw by hand</h2>
      <p>Delete each post on its platform, then press Done.</p>
      <DataTable
        caption="Posts to delete by hand"
        columns={columns}
        rows={list.data?.items ?? []}
        rowId={(row) => row.id}
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
        empty={<p>Nothing to delete by hand</p>}
      />
      <ConfirmDialog
        open={asking !== null}
        title="Mark as deleted"
        confirmLabel="Mark as deleted"
        pending={done.isPending}
        onCancel={() => {
          setAsking(null);
        }}
        onConfirm={() => {
          if (asking === null) return;
          done.mutate(asking.id, {
            onSuccess: () => {
              setAsking(null);
              toast({ message: "Marked as withdrawn." });
            },
            onError: (error) => {
              setAsking(null);
              toast({ message: error.message, tone: "danger" });
            },
          });
        }}
      >
        <p>
          Confirm the {asking === null ? "" : socialChannelLabels[asking.channel]} post is deleted
          on its platform. The row leaves this list.
        </p>
      </ConfirmDialog>
    </section>
  );
}
