import { useState } from "react";
import type { AgentApproval } from "../../domain/workforce";
import { useApprovals, useDecide } from "./workforce-queries";

// W1: what the team proposes to send, post or publish. A person approves the exact content shown (W1 invariant 3).
// W2 step 6: the decision teaches. A decline says why, and an edit approves the person's own version; both become a
// lesson for the colleague who drafted it.

const actionLabel: Record<string, string> = {
  reply_inquiry: "Reply to an inquiry",
  social_post: "Social post",
  newsletter_issue: "Place Notes issue",
  instructions_change: "Change to a colleague's instructions",
  campaign_plan: "Paid campaign plan",
  hire: "A new colleague",
};

type Mode = "view" | "decline" | "edit";

function bodyOf(content: Record<string, unknown>): string {
  return typeof content["body"] === "string" ? content["body"] : JSON.stringify(content, null, 2);
}

function Proposal({ item }: { item: AgentApproval }) {
  const decide = useDecide();
  const [mode, setMode] = useState<Mode>("view");
  const [reason, setReason] = useState("");
  const original = bodyOf(item.content);
  const [draft, setDraft] = useState(original);
  // An instructions change is read and approved as a whole: its body only describes it.
  const editable =
    typeof item.content["body"] === "string" &&
    item.action !== "instructions_change" &&
    item.action !== "hire";
  const shown = item.edited_content === null ? original : bodyOf(item.edited_content);
  const decided =
    item.state === "approved"
      ? item.edited_content === null
        ? "Approved"
        : "Approved with your changes"
      : item.state === "rejected"
        ? "Declined"
        : "Void";

  return (
    <article className={`wf-proposal wf-proposal--${item.state}`}>
      <header>
        <p className="admin-eyebrow">
          {actionLabel[item.action] ?? item.action} · from @{item.agent_slug}
        </p>
        <h2>{item.summary}</h2>
      </header>
      {mode === "edit" ? (
        <label className="wf-proposal__edit">
          <span className="admin-field__hint">
            Your version. Approving it also teaches @{item.agent_slug} how you want it written.
          </span>
          <textarea
            value={draft}
            rows={Math.min(18, Math.max(6, draft.split("\n").length + 1))}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </label>
      ) : (
        <pre className="wf-proposal__content">{shown}</pre>
      )}
      {item.state === "pending" ? (
        <>
          {mode === "decline" ? (
            <label className="wf-proposal__reason">
              <span>Why? (it teaches @{item.agent_slug})</span>
              <textarea
                value={reason}
                rows={3}
                maxLength={1000}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            </label>
          ) : null}
          <div className="wf-proposal__actions">
            {mode === "view" ? (
              <>
                <button
                  type="button"
                  className="admin-button"
                  disabled={decide.isPending}
                  onClick={() => {
                    decide.mutate({
                      id: item.id,
                      decision: "approved",
                      contentHash: item.content_hash,
                    });
                  }}
                >
                  Approve
                </button>
                {editable ? (
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    onClick={() => {
                      setMode("edit");
                    }}
                  >
                    Edit, then approve
                  </button>
                ) : null}
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  onClick={() => {
                    setMode("decline");
                  }}
                >
                  Decline
                </button>
              </>
            ) : null}
            {mode === "edit" ? (
              <button
                type="button"
                className="admin-button"
                disabled={decide.isPending || draft.trim() === ""}
                onClick={() => {
                  decide.mutate({
                    id: item.id,
                    decision: "approved",
                    contentHash: item.content_hash,
                    ...(draft.trim() === original.trim() ? {} : { editedBody: draft.trim() }),
                  });
                }}
              >
                Approve my version
              </button>
            ) : null}
            {mode === "decline" ? (
              <button
                type="button"
                className="admin-button"
                disabled={decide.isPending}
                onClick={() => {
                  decide.mutate({
                    id: item.id,
                    decision: "rejected",
                    contentHash: item.content_hash,
                    ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
                  });
                }}
              >
                Decline
              </button>
            ) : null}
            {mode === "view" ? null : (
              <button
                type="button"
                className="admin-button admin-button--quiet"
                disabled={decide.isPending}
                onClick={() => {
                  setMode("view");
                  setDraft(original);
                  setReason("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="wf-proposal__state">
          {decided}
          {item.reason === null ? null : <span className="wf-proposal__why"> · {item.reason}</span>}
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
            Nothing the team drafts leaves the company until a person approves it here. Your reasons
            and your edits teach the colleague who drafted it.
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
