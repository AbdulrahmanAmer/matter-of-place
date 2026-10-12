import type { AgentApproval } from "../../domain/workforce";
import { useApprovals, useDecide } from "./workforce-queries";

// W1: what the team proposes to send, post or publish. A person approves the exact content shown (W1 invariant 3).

const actionLabel: Record<string, string> = {
  reply_inquiry: "Reply to an inquiry",
  social_post: "Social post",
  newsletter_issue: "Place Notes issue",
};

function Proposal({ item }: { item: AgentApproval }) {
  const decide = useDecide();
  const body =
    typeof item.content["body"] === "string"
      ? item.content["body"]
      : JSON.stringify(item.content, null, 2);
  return (
    <article className={`wf-proposal wf-proposal--${item.state}`}>
      <header>
        <p className="admin-eyebrow">
          {actionLabel[item.action] ?? item.action} · from @{item.agent_slug}
        </p>
        <h2>{item.summary}</h2>
      </header>
      <pre className="wf-proposal__content">{body}</pre>
      {item.state === "pending" ? (
        <div className="wf-proposal__actions">
          <button
            type="button"
            className="admin-button"
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({ id: item.id, decision: "approved", contentHash: item.content_hash })
            }
          >
            Approve
          </button>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({ id: item.id, decision: "rejected", contentHash: item.content_hash })
            }
          >
            Decline
          </button>
        </div>
      ) : (
        <p className="wf-proposal__state">
          {item.state === "approved" ? "Approved" : item.state === "rejected" ? "Declined" : "Void"}
        </p>
      )}
      {decide.isError ? (
        <p className="admin-field__error" role="alert">
          {decide.error.message}
        </p>
      ) : null}
    </article>
  );
}

export function ApprovalsPage() {
  const approvals = useApprovals();
  const items = approvals.data?.items ?? [];
  const pending = items.filter((item) => item.state === "pending");
  const decided = items.filter((item) => item.state !== "pending");
  return (
    <div className="wf-approvals">
      <header className="wf-head">
        <div>
          <p className="admin-eyebrow">The team</p>
          <h1>Approvals</h1>
          <p className="wf-head__line">
            Nothing the team drafts leaves the company until a person approves it here.
          </p>
        </div>
      </header>
      {pending.length === 0 && !approvals.isLoading ? (
        <p className="wf-empty">
          Nothing waits for you. Drafts appear here the moment a colleague proposes one.
        </p>
      ) : null}
      <div className="wf-proposals">
        {pending.map((item) => (
          <Proposal key={item.id} item={item} />
        ))}
      </div>
      {decided.length > 0 ? (
        <section aria-labelledby="wf-decided">
          <h2 id="wf-decided" className="wf-subhead">
            Decided
          </h2>
          <div className="wf-proposals">
            {decided.map((item) => (
              <Proposal key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
