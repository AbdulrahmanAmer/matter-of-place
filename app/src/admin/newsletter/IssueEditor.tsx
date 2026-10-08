import { useState } from "react";
import { PREHEADER_MAX, SUBJECT_MAX, type Issue } from "../../domain/admin-newsletter";
import { marketTimezone, toUtc } from "../../domain/market-time";
import type { NewsletterBlock } from "../../domain/newsletter";
import { formatNumber, pluralize } from "../../lib/format";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { failureText } from "./failure-text";
import { IssueStatus } from "./IssuesTable";

/** What the editor holds before it is saved: the three things `PUT` takes. */
export interface IssueDraft {
  blocks: NewsletterBlock[];
  subject: string;
  preheader: string;
}

type Confirm = "approve" | "unapprove" | "test" | null;

const blockName = (block: NewsletterBlock) =>
  block.type === "intro" ? "Introduction" : block.title;

/** `blocks` with the one at `from` moved to `to`; the same list when either is out of range. */
function moved(blocks: readonly NewsletterBlock[], from: number, to: number): NewsletterBlock[] {
  const block = blocks[from];
  if (block === undefined || to < 0 || to >= blocks.length) return [...blocks];
  const rest = blocks.filter((_, index) => index !== from);
  return [...rest.slice(0, to), block, ...rest.slice(to)];
}

/** A property or story block keeps no `text` key when the line is empty, so an untouched block stays untouched. */
function withText(block: NewsletterBlock, text: string): NewsletterBlock {
  if (block.type === "intro") return { ...block, text };
  const { text: _old, ...rest } = block;
  return text === "" ? rest : { ...rest, text };
}

function Blocks({
  blocks,
  editable,
  onChange,
}: {
  blocks: readonly NewsletterBlock[];
  editable: boolean;
  onChange: (next: NewsletterBlock[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  if (blocks.length === 0) {
    return <p className="admin-history__none">This issue holds no blocks.</p>;
  }
  return (
    <ol className="admin-blocks" aria-label="Blocks, in reading order">
      {blocks.map((block, index) => {
        const name = blockName(block);
        return (
          <li
            key={block.id}
            className="admin-block"
            draggable={editable}
            data-dragging={dragging === index}
            onDragStart={() => {
              setDragging(index);
            }}
            onDragOver={(event) => {
              if (dragging !== null) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== null) onChange(moved(blocks, dragging, index));
              setDragging(null);
            }}
            onDragEnd={() => {
              setDragging(null);
            }}
          >
            <div className="admin-block__head">
              <div>
                <p className="admin-eyebrow">{block.type}</p>
                <h3>{name}</h3>
                {block.type === "intro" || block.deck === "" ? null : (
                  <p className="admin-block__deck">{block.deck}</p>
                )}
              </div>
              {editable ? (
                <div className="admin-actions">
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Move up: ${name}`}
                    disabled={index === 0}
                    onClick={() => {
                      onChange(moved(blocks, index, index - 1));
                    }}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Move down: ${name}`}
                    disabled={index === blocks.length - 1}
                    onClick={() => {
                      onChange(moved(blocks, index, index + 1));
                    }}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    aria-label={`Remove: ${name}`}
                    onClick={() => {
                      onChange(blocks.filter((_, at) => at !== index));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
            {editable ? (
              <Field
                label={block.type === "intro" ? "Introduction text" : `Your line above ${name}`}
                {...(block.type === "intro" && block.text === ""
                  ? { error: "Write the introduction or remove it." }
                  : {})}
              >
                {(control) => (
                  <textarea
                    {...control}
                    rows={3}
                    maxLength={2000}
                    value={block.text ?? ""}
                    onChange={(event) => {
                      onChange(
                        blocks.map((each) =>
                          each.id === block.id ? withText(each, event.target.value) : each,
                        ),
                      );
                    }}
                  />
                )}
              </Field>
            ) : block.text === undefined || block.text === "" ? null : (
              <p className="admin-prose">{block.text}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const METRIC_LABELS = [
  ["delivered", "Delivered"],
  ["opened", "Opened"],
  ["clicked", "Clicked"],
  ["unsubscribed", "Unsubscribed"],
] as const;

function Metrics({ metrics }: { metrics: Issue["metrics"] }) {
  const shown = METRIC_LABELS.flatMap(([key, label]) => {
    const value = metrics[key];
    return value === undefined ? [] : [{ label, value }];
  });
  if (shown.length === 0) return null;
  return (
    <dl className="admin-metrics" aria-label="Results">
      {shown.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatNumber(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Screen 13, one issue. A draft is edited here and saved whole; an approved one can be taken back to draft; a sending
 * or sent one is read only. Approve stays off while the editor holds no blocks or a change that is not saved. An
 * action that fails shows the refusal inline.
 */
export function IssueEditor({
  issue,
  can,
  onSave,
  onApprove,
  onUnapprove,
  onSendTest,
}: {
  issue: Issue;
  can: { update: boolean; approve: boolean; unapprove: boolean; sendTest: boolean };
  onSave: (draft: IssueDraft) => Promise<unknown>;
  /** `sendAt` is an ISO UTC instant, or undefined to send as soon as the runner takes the job. */
  onApprove: (sendAt: string | undefined) => Promise<unknown>;
  onUnapprove: () => Promise<unknown>;
  onSendTest: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<IssueDraft>({
    blocks: issue.blocks,
    subject: issue.subject ?? "",
    preheader: issue.preheader ?? "",
  });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [sendAt, setSendAt] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const editable = issue.status === "draft" && can.update;
  const current: IssueDraft = {
    blocks: draft.blocks,
    subject: draft.subject.trim(),
    preheader: draft.preheader.trim(),
  };
  const dirty =
    JSON.stringify(current) !==
    JSON.stringify({
      blocks: issue.blocks,
      subject: issue.subject ?? "",
      preheader: issue.preheader ?? "",
    });
  const introEmpty = draft.blocks.some((block) => block.type === "intro" && block.text === "");
  const subjectEmpty = current.subject === "";
  const canSave = editable && dirty && !subjectEmpty && !introEmpty;
  const blockedApproval = ((): string | null => {
    if (draft.blocks.length === 0) return "Add a block before approving.";
    if (dirty) return "Save your changes before approving.";
    return null;
  })();

  const run = (action: () => Promise<unknown>) => {
    setPending(true);
    setFailure(null);
    action().then(
      () => {
        setPending(false);
        setConfirm(null);
      },
      (error: unknown) => {
        setPending(false);
        setConfirm(null);
        setFailure(failureText(error));
      },
    );
  };

  return (
    <section className="admin-issue" aria-label="Issue">
      <div className="admin-issue__state">
        <IssueStatus status={issue.status} />
        {issue.scheduled_for !== null && issue.status === "approved" ? (
          <span>
            Sends <LocalTime value={issue.scheduled_for} />
          </span>
        ) : null}
        {issue.sent_at === null ? null : (
          <span>
            Sent <LocalTime value={issue.sent_at} />
          </span>
        )}
      </div>
      {issue.send_error === null ? null : (
        <p role="alert">The last send did not finish: {issue.send_error}</p>
      )}
      <Metrics metrics={issue.metrics} />
      {failure === null ? null : <p role="alert">{failure}</p>}

      {editable ? (
        <>
          <Field
            label="Subject"
            hint={`Up to ${String(SUBJECT_MAX)} characters.`}
            {...(subjectEmpty ? { error: "Write a subject." } : {})}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={SUBJECT_MAX}
                value={draft.subject}
                onChange={(event) => {
                  setDraft({ ...draft, subject: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Preheader"
            hint={`The line after the subject. Up to ${String(PREHEADER_MAX)} characters.`}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={PREHEADER_MAX}
                value={draft.preheader}
                onChange={(event) => {
                  setDraft({ ...draft, preheader: event.target.value });
                }}
              />
            )}
          </Field>
        </>
      ) : (
        <dl className="admin-issue__fields">
          <div>
            <dt>Subject</dt>
            <dd>{issue.subject ?? "Built from the blocks"}</dd>
          </div>
          <div>
            <dt>Preheader</dt>
            <dd>{issue.preheader}</dd>
          </div>
        </dl>
      )}

      <h2>
        {formatNumber(draft.blocks.length)} {pluralize(draft.blocks.length, "block")}
      </h2>
      {editable && !draft.blocks.some((block) => block.type === "intro") ? (
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => {
            setDraft({
              ...draft,
              blocks: [{ id: crypto.randomUUID(), type: "intro", text: "" }, ...draft.blocks],
            });
          }}
        >
          Add an introduction
        </button>
      ) : null}
      <Blocks
        blocks={draft.blocks}
        editable={editable}
        onChange={(blocks) => {
          setDraft({ ...draft, blocks });
        }}
      />

      <div className="admin-actions">
        {editable ? (
          <button
            type="button"
            className="admin-button"
            disabled={!canSave || pending}
            onClick={() => {
              run(() => onSave(current));
            }}
          >
            Save
          </button>
        ) : null}
        {can.sendTest && (issue.status === "draft" || issue.status === "approved") ? (
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={pending}
            onClick={() => {
              setConfirm("test");
            }}
          >
            Send a test
          </button>
        ) : null}
        {issue.status === "draft" && can.approve ? (
          <button
            type="button"
            className="admin-button"
            disabled={blockedApproval !== null || pending}
            onClick={() => {
              setConfirm("approve");
            }}
          >
            Approve
          </button>
        ) : null}
        {issue.status === "approved" && can.unapprove ? (
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={pending}
            onClick={() => {
              setConfirm("unapprove");
            }}
          >
            Unapprove
          </button>
        ) : null}
      </div>
      {issue.status === "draft" && can.approve && blockedApproval !== null ? (
        <p className="admin-field__hint">{blockedApproval}</p>
      ) : null}

      <ConfirmDialog
        open={confirm === "approve"}
        title="Approve this issue"
        confirmLabel="Approve"
        pending={pending}
        onConfirm={() => {
          run(() => onApprove(sendAt === "" ? undefined : toUtc(sendAt, marketTimezone(null))));
        }}
        onCancel={() => {
          setConfirm(null);
        }}
      >
        <p>
          Approving freezes the issue. A preview is mailed to the team a day before the send, or at
          once when the send is less than a day away.
        </p>
        <Field label="Send at (Eastern time)" hint="Leave empty to send as soon as it is approved.">
          {(control) => (
            <input
              {...control}
              type="datetime-local"
              value={sendAt}
              onChange={(event) => {
                setSendAt(event.target.value);
              }}
            />
          )}
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "unapprove"}
        title="Take this issue back to draft"
        confirmLabel="Unapprove"
        pending={pending}
        onConfirm={() => {
          run(onUnapprove);
        }}
        onCancel={() => {
          setConfirm(null);
        }}
      >
        <p>
          The queued send and preview are cancelled. You can edit the issue and approve it again.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "test"}
        title="Send a test"
        confirmLabel="Send the test"
        pending={pending}
        onConfirm={() => {
          run(onSendTest);
        }}
        onCancel={() => {
          setConfirm(null);
        }}
      >
        <p>A test copy of the saved issue is queued for your sign-in address.</p>
      </ConfirmDialog>
    </section>
  );
}
