import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Dialog } from "../ui/Dialog";
import { LocalTime } from "../ui/LocalTime";
import { presenceOf } from "./presence";
import { useMessages, useOffice, usePostMessage } from "./workforce-queries";

/**
 * The side chat with Matter (plan W2, operator 2026-10-12: "I can talk to it from a side chat that I can open"): one
 * thread, `matter`, the same from every admin screen and from the desktop office. It says plainly when the laptop is
 * off and the message waits, and when Matter is still working on the last line.
 */
export function SideChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const messages = useMessages("matter");
  const post = usePostMessage("matter");
  const office = useOffice();
  const [text, setText] = useState("");
  const [now] = useState(() => Date.now());
  const end = useRef<HTMLLIElement>(null);
  const items = messages.data?.items ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items.length, open]);

  const matter = office.data?.agents.find((agent) => agent.slug === "matter");
  const waiting = items.at(-1)?.author_kind === "human";
  const presence = presenceOf({
    onTeam: matter !== undefined,
    lastSeen: matter?.last_seen_at ?? null,
    now,
    waiting,
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (body === "") return;
    post.mutate(body, {
      onSuccess: () => {
        setText("");
      },
    });
  };

  return (
    <Dialog open={open} onClose={onClose} label="Matter" variant="drawer">
      <section className="side-chat" aria-label="Matter">
        <header className="side-chat__head">
          <h2>Matter</h2>
          <p className="side-chat__presence" role="status">
            {presence.kind === "absent" ? (
              "Matter is not on the team yet."
            ) : presence.kind === "working" ? (
              "Working on your last message."
            ) : presence.kind === "online" ? (
              "Online."
            ) : presence.since === null ? (
              "Offline. Your message waits until the laptop is on."
            ) : (
              <>
                Offline since <LocalTime value={presence.since} />. Your message waits until the
                laptop is on.
              </>
            )}
          </p>
          <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <ol className="side-chat__list" aria-live="polite">
          {items.map((message) => (
            <li key={message.id} data-from={message.author_kind}>
              <span className="side-chat__who">
                {message.author_kind === "human" ? "You" : message.author_name}
              </span>
              <p>{message.body}</p>
            </li>
          ))}
          {items.length === 0 && !messages.isLoading ? (
            <li className="side-chat__empty">
              Ask Matter for anything: today&apos;s requests, a draft, a change to the site, a
              voiceover.
            </li>
          ) : null}
          <li ref={end} aria-hidden="true" />
        </ol>
        <form className="side-chat__composer" onSubmit={submit}>
          <label className="admin-visually-hidden" htmlFor="side-chat-text">
            Message to Matter
          </label>
          <textarea
            id="side-chat-text"
            rows={3}
            value={text}
            placeholder="Tell Matter what you need"
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }}
          />
          <button
            type="submit"
            className="admin-button"
            disabled={post.isPending || text.trim() === ""}
          >
            Send
          </button>
        </form>
      </section>
    </Dialog>
  );
}
