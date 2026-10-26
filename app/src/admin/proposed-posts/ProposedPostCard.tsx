import { useState } from "react";
import {
  canMove,
  type AdminProposedPost,
  type ProposedPostStatus,
} from "../../domain/proposed-posts";
import { RejectDialog } from "../assets/RejectDialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { ChannelPreview } from "./ChannelPreview";
import { PostHistory } from "./PostHistory";
import { proposedActions, proposedStatusLabels, proposerOf } from "./proposed-posts-labels";
import { useApprovePost, useRejectPost, useRerenderPost } from "./proposed-posts-queries";

const statusTone: Record<ProposedPostStatus, Tone> = {
  proposed: "warning",
  rejected: "danger",
  approved: "ok",
  scheduled: "info",
  posted: "info",
};

type Asking = "approve" | "reject" | "rerender" | null;

/** One proposed post: every channel as it will look there, the decisions open to the actor, and its history. */
export function ProposedPostCard({ post }: { post: AdminProposedPost }) {
  const toast = useToast();
  const approve = useApprovePost();
  const reject = useRejectPost();
  const rerender = useRerenderPost();
  const [asking, setAsking] = useState<Asking>(null);
  // An approve that is refused shows the reason, where the person is looking.
  const [refusal, setRefusal] = useState<string | null>(null);
  const busy = approve.isPending || reject.isPending || rerender.isPending;
  // The status machine is item 10's (`canMove`): a post is approved or rejected from `proposed` only, and a re-render
  // is a reject that asks for new visuals, so it is open where a reject is. A rejected post returns through `/revise`.
  const canApprove = canMove(post.status, "approved");
  const canReject = canMove(post.status, "rejected");
  const title = `${post.title}, revision ${String(post.revision)}`;

  const settle = (done: string) => ({
    onSuccess: () => {
      setAsking(null);
      setRefusal(null);
      toast({ message: done });
    },
    onError: (error: Error) => {
      setAsking(null);
      setRefusal(error.message);
    },
  });

  return (
    <article className="admin-proposed" aria-label={title}>
      <header className="admin-asset__head">
        <h2>{post.title}</h2>
        <StatusPill label={proposedStatusLabels[post.status]} tone={statusTone[post.status]} />
        {post.test ? <StatusPill label="TEST" tone="warning" /> : null}
        <span className="admin-asset__meta">
          Proposed by {proposerOf(post)}, revision {post.revision},{" "}
          <LocalTime value={post.created_at} />
        </span>
      </header>
      <div className="admin-proposed__channels">
        {post.channels.map((channel) => (
          <ChannelPreview key={channel.channel} post={channel} />
        ))}
      </div>
      {post.rejection_note === null ? null : (
        <p className="admin-asset__note">Rejected: {post.rejection_note}</p>
      )}
      {refusal === null ? null : (
        <p className="admin-asset__error" role="alert">
          {refusal}
        </p>
      )}
      <div className="admin-actions">
        {canApprove ? (
          <RoleGate action={proposedActions.approve}>
            <button
              type="button"
              className="admin-button"
              disabled={busy}
              onClick={() => {
                setAsking("approve");
              }}
            >
              Approve
            </button>
          </RoleGate>
        ) : null}
        {canReject ? (
          <RoleGate action={proposedActions.reject}>
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={busy}
              onClick={() => {
                setAsking("reject");
              }}
            >
              Reject
            </button>
          </RoleGate>
        ) : null}
        {canReject ? (
          <RoleGate action={proposedActions.rerender}>
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={busy}
              onClick={() => {
                setAsking("rerender");
              }}
            >
              Ask for a re-render
            </button>
          </RoleGate>
        ) : null}
      </div>
      <PostHistory id={post.id} />
      <ConfirmDialog
        open={asking === "approve"}
        title={`Approve ${title.toLowerCase()}`}
        confirmLabel="Approve"
        pending={approve.isPending}
        onConfirm={() => {
          approve.mutate({ id: post.id, revision: post.revision }, settle("Approved."));
        }}
        onCancel={() => {
          setAsking(null);
        }}
      >
        <p>Approving files each channel's post to go out. It cannot go back to proposed.</p>
      </ConfirmDialog>
      <RejectDialog
        open={asking === "reject"}
        title={`Reject ${title.toLowerCase()}`}
        pending={reject.isPending}
        onReject={(note) => {
          reject.mutate({ id: post.id, note }, settle("Rejected."));
        }}
        onCancel={() => {
          setAsking(null);
        }}
      />
      <RejectDialog
        open={asking === "rerender"}
        title={`Ask for a re-render of ${title.toLowerCase()}`}
        verb="Ask for a re-render"
        hint="Say what to change, so the next revision can fix it."
        missingNote="A re-render needs a note."
        pending={rerender.isPending}
        onReject={(note) => {
          rerender.mutate({ id: post.id, note }, settle("Sent to render again."));
        }}
        onCancel={() => {
          setAsking(null);
        }}
      />
    </article>
  );
}
