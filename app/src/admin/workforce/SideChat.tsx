import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Dialog } from "../ui/Dialog";
import { LocalTime } from "../ui/LocalTime";
import type { AgentMessage } from "../../domain/workforce";
import { presenceOf } from "./presence";
import { useMessages, useOffice, usePostMessage } from "./workforce-queries";

/**
 * The side chat with Matter (plan W2, operator 2026-10-12: "I can talk to it from a side chat that I can open"): one
 * thread, `matter`, the same from every admin screen and from the desktop office. It says plainly when the laptop is
 * off and the message waits, and when Matter is still working on the last line.
 */
type Tab = "chat" | "tasks" | "team";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "chat", label: "Matter" },
  { id: "tasks", label: "Tasks" },
  { id: "team", label: "Team talk" },
];

export function SideChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const messages = useMessages("matter");
  const team = useMessages("team");
  const post = usePostMessage("matter");
  const office = useOffice();
  const [tab, setTab] = useState<Tab>("chat");
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
          {matter?.state === "working" && matter.current_task !== null ? (
            // W5 item 7: what Matter is running at this moment, as the live supervisor reports it.
            <p className="side-chat__now">
              <span className="side-chat__who">Now</span> {matter.current_task}
            </p>
          ) : null}
          <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="side-chat__tabs" role="tablist" aria-label="Side chat">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`side-chat-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`side-chat-panel-${item.id}`}
              className="side-chat__tab"
              onClick={() => {
                setTab(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ol
          className="side-chat__list side-chat__tasks"
          role="tabpanel"
          id="side-chat-panel-tasks"
          aria-labelledby="side-chat-tab-tasks"
          hidden={tab !== "tasks"}
        >
          {(office.data?.activity ?? []).map((task) => (
            <li key={task.id} data-state={task.state}>
              <span className="side-chat__who">
                {task.state === "running" ? "Running" : task.state === "done" ? "Done" : "Stopped"}
              </span>
              <p>
                {task.label}{" "}
                <span className="side-chat__time">
                  started <LocalTime value={task.started_at} />
                </span>
                {task.finished_at === null ? null : (
                  <span className="side-chat__time">
                    , ended <LocalTime value={task.finished_at} />
                  </span>
                )}
              </p>
            </li>
          ))}
          {(office.data?.activity ?? []).length === 0 ? (
            <li className="side-chat__empty">No background task yet.</li>
          ) : null}
        </ol>
        <ol
          className="side-chat__list"
          role="tabpanel"
          id="side-chat-panel-team"
          aria-labelledby="side-chat-tab-team"
          hidden={tab !== "team"}
        >
          <MessageRows messages={team.data?.items ?? []} />
          {(team.data?.items ?? []).length === 0 && !team.isLoading ? (
            <li className="side-chat__empty">The team has not talked yet.</li>
          ) : null}
        </ol>
        <ol
          className="side-chat__list"
          aria-live="polite"
          role="tabpanel"
          id="side-chat-panel-chat"
          aria-labelledby="side-chat-tab-chat"
          hidden={tab !== "chat"}
        >
          <MessageRows messages={items} />
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

/** One line per message, the person's own shown as "You": the chat and the team talk alike. */
function MessageRows({ messages }: { messages: readonly AgentMessage[] }) {
  return (
    <>
      {messages.map((message) => (
        <li key={message.id} data-from={message.author_kind}>
          <span className="side-chat__who">
            {message.author_kind === "human" ? "You" : message.author_name}
          </span>
          <p>{message.body}</p>
        </li>
      ))}
    </>
  );
}
