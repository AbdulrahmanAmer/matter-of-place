import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Dialog } from "../ui/Dialog";
import type { AgentMessage, Allowance } from "../../domain/workforce";
import { formatInZone, marketTimezone, OFFICE_ZONE } from "../../domain/market-time";
import { MessageText } from "./MessageText";
import { presenceOf, type Presence } from "./presence";
import { ago, took } from "./when";
import { useMessages, useOffice, usePostMessage } from "./workforce-queries";

/*
 * Matter's panel (remade from scratch 2026-10-15; operator: "this needs to be remade properly"). One drawer, four
 * fixed bands: who and how he is, the tabs, one scrolling body (only the open tab is rendered), and the composer on
 * the chat tab. The old side chat stacked all three lists at once ([hidden] lost to a display rule), read "offline"
 * while the laptop was busy, and printed markdown raw.
 */

type PanelTab = "chat" | "tasks" | "team";

interface PanelTask {
  id: string;
  label: string;
  state: "running" | "done" | "stopped";
  started_at: string;
  finished_at: string | null;
}

export interface MatterPanelViewProps {
  presence: Presence;
  chat: readonly AgentMessage[];
  team: readonly AgentMessage[];
  tasks: readonly PanelTask[];
  allowance: Allowance | null;
  now: number;
  tab: PanelTab;
  draft: string;
  sending: boolean;
  loading: boolean;
  onTab: (tab: PanelTab) => void;
  onDraft: (text: string) => void;
  onSend: () => void;
  onClose: () => void;
}

const DAY = 24 * 60 * 60_000;

function statusLine(presence: Presence) {
  switch (presence.kind) {
    case "absent":
      return { tone: "off", text: "Not on the team yet." };
    case "working":
      return {
        tone: "busy",
        text: presence.task === null ? "Working" : `Working: ${presence.task}`,
      };
    case "online":
      return { tone: "on", text: "Online, ready for your next line" };
    case "offline":
      return {
        tone: "off",
        text:
          presence.since === null
            ? "Offline. Your message waits for the laptop."
            : `Offline since ${formatInZone(presence.since, marketTimezone(null), "dayTime")}. Your message waits for the laptop.`,
      };
  }
}

/** W6 item 2: how much of the weekly Claude allowance the staff have used, as the runner last read it. */
function allowanceLine(allowance: Allowance | null): string {
  return allowance === null
    ? "Allowance not measured"
    : `Week ${String(Math.round(allowance.week))}% used, resets ${formatInZone(allowance.resets_at, OFFICE_ZONE, "dayTime")}`;
}

function Lines({ messages, now }: { messages: readonly AgentMessage[]; now: number }) {
  return (
    <ol className="mp-lines">
      {messages.map((message) => (
        <li key={message.id} className="mp-line" data-from={message.author_kind}>
          <p className="mp-line__meta">
            <span className="mp-line__who">
              {message.author_kind === "human" ? "You" : message.author_name}
            </span>
            <time dateTime={message.created_at}>{ago(message.created_at, now)}</time>
          </p>
          <MessageText text={message.body} />
        </li>
      ))}
    </ol>
  );
}

function Tasks({ tasks, now }: { tasks: readonly PanelTask[]; now: number }) {
  const running = tasks.filter((task) => task.state === "running");
  const recent = tasks.filter(
    (task) => task.state !== "running" && now - Date.parse(task.started_at) < DAY,
  );
  const older = tasks.filter(
    (task) => task.state !== "running" && now - Date.parse(task.started_at) >= DAY,
  );
  const row = (task: PanelTask) => (
    <li key={task.id} className="mp-task" data-state={task.state}>
      <span className="mp-task__label">{task.label}</span>
      <span className="mp-task__meta">
        {task.state === "running"
          ? `running ${took(task.started_at, null, now)}`
          : task.state === "stopped"
            ? `stopped, ${ago(task.started_at, now)}`
            : `took ${took(task.started_at, task.finished_at, now)}, ${ago(task.started_at, now)}`}
      </span>
    </li>
  );
  if (tasks.length === 0)
    return (
      <p className="mp-empty">
        Nothing is running. What Matter starts in the background shows here, with how long it took.
      </p>
    );
  return (
    <div className="mp-tasks">
      <section aria-label="Running now">
        <h3 className="mp-heading">Running now</h3>
        {running.length === 0 ? (
          <p className="mp-empty">Nothing at the moment.</p>
        ) : (
          <ul>{running.map(row)}</ul>
        )}
      </section>
      {recent.length > 0 ? (
        <section aria-label="Last 24 hours">
          <h3 className="mp-heading">Last 24 hours</h3>
          <ul>{recent.map(row)}</ul>
        </section>
      ) : null}
      {older.length > 0 ? (
        <details className="mp-older">
          <summary>Earlier ({older.length})</summary>
          <ul>{older.map(row)}</ul>
        </details>
      ) : null}
    </div>
  );
}

/** The panel as it looks for given data; no fetching, so every state can be drawn and tested on its own. */
export function MatterPanelView(props: MatterPanelViewProps) {
  const { presence, chat, team, tasks, now, tab, draft, sending, loading } = props;
  const body = useRef<HTMLDivElement>(null);
  const status = statusLine(presence);
  const running = tasks.filter((task) => task.state === "running").length;
  const waiting = chat.at(-1)?.author_kind === "human" && presence.kind !== "offline";
  const shown = tab === "chat" ? chat : tab === "team" ? team : null;

  useEffect(() => {
    const node = body.current;
    if (node !== null && tab !== "tasks") node.scrollTop = node.scrollHeight;
  }, [tab, shown?.length]);

  const tabs: readonly { id: PanelTab; label: string; count?: number }[] = [
    { id: "chat", label: "Chat" },
    { id: "tasks", label: "Tasks", count: running },
    { id: "team", label: "Team" },
  ];

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (draft.trim() !== "" && !sending) props.onSend();
  };

  return (
    <section className="matter-panel" aria-label="Matter">
      <header className="mp-head">
        <h2 className="mp-head__name">Matter</h2>
        <p className="mp-head__status" role="status" data-tone={status.tone}>
          <span className="mp-dot" aria-hidden="true" />
          <span className="mp-head__text" title={status.text}>
            {status.text}
          </span>
        </p>
        <p className="mp-head__allowance">{allowanceLine(props.allowance)}</p>
        <button
          type="button"
          className="admin-button admin-button--quiet mp-head__close"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>

      <div className="mp-tabs" role="tablist" aria-label="Matter">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`mp-tab-${item.id}`}
            aria-selected={tab === item.id}
            {...(tab === item.id ? { "aria-controls": "mp-body" } : {})}
            className="mp-tab"
            onClick={() => {
              props.onTab(item.id);
            }}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 ? (
              <span className="mp-tab__count"> {item.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        ref={body}
        className="mp-body"
        id="mp-body"
        role="tabpanel"
        aria-labelledby={`mp-tab-${tab}`}
        aria-live={tab === "chat" ? "polite" : "off"}
        tabIndex={0}
      >
        {tab === "tasks" ? (
          <Tasks tasks={tasks} now={now} />
        ) : shown !== null && shown.length > 0 ? (
          <>
            <Lines messages={shown} now={now} />
            {tab === "chat" && waiting ? (
              <p className="mp-waiting">Matter has your message.</p>
            ) : null}
          </>
        ) : loading ? (
          <p className="mp-empty">Loading.</p>
        ) : tab === "chat" ? (
          <p className="mp-empty">
            Ask Matter for anything: today&apos;s requests, a draft, a change to the site.
          </p>
        ) : (
          <p className="mp-empty">The team has not talked yet.</p>
        )}
      </div>

      {tab === "chat" ? (
        <form className="mp-composer" onSubmit={submit}>
          <label className="admin-visually-hidden" htmlFor="mp-draft">
            Message to Matter
          </label>
          <textarea
            id="mp-draft"
            rows={2}
            value={draft}
            placeholder="Tell Matter what you need"
            onChange={(event) => {
              props.onDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }}
          />
          <p className="mp-composer__hint">Enter sends. Shift and Enter for a new line.</p>
          <button type="submit" className="admin-button" disabled={sending || draft.trim() === ""}>
            {sending ? "Sending" : "Send"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** The panel with live data: the office every 5 seconds, the threads every 4. */
export function MatterPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const chat = useMessages("matter");
  const team = useMessages("team");
  const post = usePostMessage("matter");
  const office = useOffice();
  const [tab, setTab] = useState<PanelTab>("chat");
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const matter = office.data?.agents.find((agent) => agent.slug === "matter");
  const presence = presenceOf({
    onTeam: matter !== undefined,
    lastSeen: matter?.last_seen_at ?? null,
    now,
    state: matter?.state ?? null,
    task: matter?.current_task ?? null,
  });

  return (
    <Dialog open={open} onClose={onClose} label="Matter" variant="drawer">
      <MatterPanelView
        presence={presence}
        chat={chat.data?.items ?? []}
        team={team.data?.items ?? []}
        tasks={(office.data?.activity ?? []).filter((task) => task.agent_slug === "matter")}
        allowance={office.data?.allowance ?? null}
        now={now}
        tab={tab}
        draft={draft}
        sending={post.isPending}
        loading={chat.isLoading}
        onTab={setTab}
        onDraft={setDraft}
        onSend={() => {
          post.mutate(draft.trim(), {
            onSuccess: () => {
              setDraft("");
            },
          });
        }}
        onClose={onClose}
      />
    </Dialog>
  );
}
