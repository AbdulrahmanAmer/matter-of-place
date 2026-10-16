import { useState } from "react";
import type { InstructionVersion } from "../../domain/admin-team-memory";
import { cappedNote, momentOf } from "./memory-format";
import { useInstructionText, useInstructionVersions } from "./workforce-queries";

// W7 item 4: the history of each colleague's instructions, newest first. The text of a version is read on demand and
// shown as plain text: a colleague wrote it, so it is never HTML.

function VersionText({ id }: { id: string }) {
  const text = useInstructionText(id);
  if (text.isError) return <p className="wf-empty">That version could not be read.</p>;
  if (text.isLoading) return <p className="wf-empty">Opening the version.</p>;
  const body = text.data?.instructions ?? "";
  return body === "" ? (
    <p className="wf-empty">This version holds no text.</p>
  ) : (
    <pre className="wf-mem__text">{body}</pre>
  );
}

function Version({ version }: { version: InstructionVersion }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="wf-mem__version">
      <p className="wf-mem__version-head">
        <strong>{`Version ${String(version.version)}`}</strong>
        <time dateTime={version.created_at}>{momentOf(version.created_at)}</time>
        {version.approval_id === null ? null : <span>Approved in Approvals</span>}
      </p>
      <p className="wf-mem__reason">{version.reason}</p>
      <button
        type="button"
        className="wf-link"
        aria-expanded={open}
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        {open ? "Hide the text" : "Show the text"}
      </button>
      {open ? <VersionText id={version.id} /> : null}
    </li>
  );
}

export function InstructionHistoryPanel() {
  const history = useInstructionVersions();
  const items = history.data?.items ?? [];
  const note = cappedNote(items.length, history.data?.total ?? 0, "versions");
  // The list arrives newest first: a colleague's group sits where their latest version is, versions in the same order.
  const colleagues = [...new Set(items.map((item) => item.agent_slug))];

  return (
    <section className="wf-mem" aria-labelledby="wf-history-title">
      <h2 id="wf-history-title">Instruction history</h2>
      <p className="wf-mem__lead">
        Every version of each colleague's instructions, with the reason it was written.
      </p>
      {history.isError ? (
        <p className="wf-empty">The history could not be read. Try again in a moment.</p>
      ) : history.isLoading ? (
        <p className="wf-empty">Opening the history.</p>
      ) : items.length === 0 ? (
        <p className="wf-empty">
          No version yet. The first change to a colleague's instructions starts their history.
        </p>
      ) : (
        <>
          {note === null ? null : <p className="wf-mem__lead">{note}</p>}
          {colleagues.map((slug) => {
            const own = items.filter((item) => item.agent_slug === slug);
            return (
              <div key={slug} className="wf-mem__colleague">
                <h3>{own[0]?.agent_name ?? slug}</h3>
                <ol>
                  {own.map((version) => (
                    <Version key={version.id} version={version} />
                  ))}
                </ol>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
