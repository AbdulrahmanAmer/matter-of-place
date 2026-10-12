import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Agent, AgentMessage, AgentRun } from "../../domain/workforce";
import { Avatar } from "./Avatar";
import { HireDialog } from "./HireDialog";
import { useAgentState, useMessages, useOffice, usePostMessage } from "./workforce-queries";

// W1: the office. The floor shows every colleague live; hovering one opens a quick ask; the conversation panel holds
// the team chat and each colleague's direct thread. Everything refreshes on its own (workforce-queries.ts).

const since = (iso: string | null): string => {
  if (iso === null) return "not yet";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${String(hours)} h ago` : `${String(Math.round(hours / 24))} d ago`;
};

const stateLine = (agent: Agent): string => {
  if (agent.state === "working") return agent.current_task ?? "Working";
  if (agent.state === "paused") return "Paused";
  if (agent.state === "off") return "Off duty";
  return `Available · last seen ${since(agent.last_seen_at)}`;
};

function QuickAsk({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const [text, setText] = useState("");
  const post = usePostMessage(agent.slug);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (body === "") return;
    post.mutate(body, {
      onSuccess: () => {
        setText("");
        onOpen();
      },
    });
  };
  return (
    <form className="wf-ask" onSubmit={submit}>
      <label className="admin-visually-hidden" htmlFor={`ask-${agent.slug}`}>
        Ask {agent.name}
      </label>
      <input
        id={`ask-${agent.slug}`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        placeholder={`Ask ${agent.name.split(" ")[0] ?? agent.name} about their work`}
        autoComplete="off"
      />
      <button type="submit" disabled={post.isPending || text.trim() === ""}>
        Ask
      </button>
    </form>
  );
}

function AgentCard({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const change = useAgentState();
  return (
    <article className={`wf-card wf-card--${agent.state}`} tabIndex={-1}>
      <header className="wf-card__head">
        <Avatar name={agent.name} state={agent.state} />
        <div>
          <h3>{agent.name}</h3>
          <p className="wf-card__role">{agent.role}</p>
        </div>
      </header>
      <p className="wf-card__state">
        <span className="wf-dot" aria-hidden="true" />
        {stateLine(agent)}
      </p>
      <p className="wf-card__meta">
        {agent.runs_today === 1 ? "1 task today" : `${String(agent.runs_today)} tasks today`} ·{" "}
        {agent.model}
      </p>
      <div className="wf-card__actions">
        <button type="button" className="wf-link" onClick={onOpen}>
          Open conversation
        </button>
        <button
          type="button"
          className="wf-link"
          disabled={change.isPending}
          onClick={() => {
            change.mutate({
              slug: agent.slug,
              state: agent.state === "paused" ? "idle" : "paused",
            });
          }}
        >
          {agent.state === "paused" ? "Resume" : "Pause"}
        </button>
      </div>
      <QuickAsk agent={agent} onOpen={onOpen} />
    </article>
  );
}

function Message({ message, agents }: { message: AgentMessage; agents: readonly Agent[] }) {
  const agent = agents.find((row) => row.slug === message.author_id);
  return (
    <li className={`wf-msg wf-msg--${message.author_kind}`}>
      {message.author_kind === "agent" && agent !== undefined ? (
        <Avatar name={agent.name} state={agent.state} size={32} />
      ) : (
        <span className="wf-msg__mark" aria-hidden="true">
          {message.author_kind === "system" ? "·" : message.author_name.charAt(0)}
        </span>
      )}
      <div>
        <p className="wf-msg__by">
          {message.author_name}{" "}
          <time dateTime={message.created_at}>{since(message.created_at)}</time>
        </p>
        <p className="wf-msg__body">{message.body}</p>
      </div>
    </li>
  );
}

function Conversation({
  thread,
  agents,
  onThread,
}: {
  thread: string;
  agents: readonly Agent[];
  onThread: (thread: string) => void;
}) {
  const messages = useMessages(thread);
  const post = usePostMessage(thread);
  const [text, setText] = useState("");
  const end = useRef<HTMLLIElement>(null);
  const count = messages.data?.items.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count, thread]);
  const open = agents.find((agent) => agent.slug === thread);
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
    <section className="wf-convo" aria-label="Conversation">
      <nav className="wf-convo__threads" aria-label="Threads">
        <button type="button" aria-pressed={thread === "team"} onClick={() => onThread("team")}>
          Team
        </button>
        {agents.map((agent) => (
          <button
            type="button"
            key={agent.slug}
            aria-pressed={thread === agent.slug}
            onClick={() => onThread(agent.slug)}
          >
            {agent.name.split(" ")[0]}
          </button>
        ))}
      </nav>
      <p className="wf-convo__title">
        {open === undefined ? "The whole team" : `With ${open.name}`}
        <span>
          {open === undefined
            ? "Mention @chief, @editor or any colleague to wake them."
            : "Only you and this colleague read this thread."}
        </span>
      </p>
      <ol className="wf-convo__list" aria-live="polite">
        {messages.data?.items.map((message) => (
          <Message key={message.id} message={message} agents={agents} />
        ))}
        {count === 0 && !messages.isLoading ? (
          <li className="wf-convo__empty">Nothing here yet. Write the first line.</li>
        ) : null}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form className="wf-composer" onSubmit={submit}>
        <label className="admin-visually-hidden" htmlFor="wf-compose">
          Message
        </label>
        <textarea
          id="wf-compose"
          rows={3}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={open === undefined ? "Write to the team" : `Write to ${open.name}`}
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
  );
}

function RecentWork({ runs, agents }: { runs: readonly AgentRun[]; agents: readonly Agent[] }) {
  const nameOf = (slug: string) => agents.find((agent) => agent.slug === slug)?.name ?? slug;
  return (
    <section className="wf-work" aria-labelledby="wf-work-title">
      <h2 id="wf-work-title">Recent work</h2>
      {runs.length === 0 ? (
        <p className="wf-empty">
          No task yet. A message, a request or an inquiry gives the team its first.
        </p>
      ) : (
        <ol>
          {runs.map((run) => (
            <li key={run.id} className={`wf-run wf-run--${run.state}`}>
              <span className="wf-run__who">{nameOf(run.agent_slug)}</span>
              <span className="wf-run__what">
                {run.summary ??
                  run.error ??
                  (run.state === "queued" ? "Waiting to start" : "Working")}
              </span>
              <time dateTime={run.created_at}>{since(run.created_at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function OfficePage() {
  const office = useOffice();
  const [thread, setThread] = useState("team");
  const [hiring, setHiring] = useState(false);
  const agents = office.data?.agents ?? [];
  const working = agents.filter((agent) => agent.state === "working").length;
  const pending = office.data?.pending_approvals ?? 0;

  return (
    <div className="wf-office">
      <header className="wf-head">
        <div>
          <p className="admin-eyebrow">The team</p>
          <h1>Office</h1>
          <p className="wf-head__line">
            {agents.length} colleagues · {working} working now ·{" "}
            <Link to="/admin/approvals" className="wf-head__approvals">
              {pending === 1
                ? "1 proposal waits for you"
                : `${String(pending)} proposals wait for you`}
            </Link>
          </p>
        </div>
        <button type="button" className="admin-button" onClick={() => setHiring(true)}>
          Hire a colleague
        </button>
      </header>

      <div className="wf-layout">
        <div className="wf-floor-wrap">
          <section className="wf-floor" aria-label="Colleagues">
            {agents.map((agent) => (
              <AgentCard key={agent.slug} agent={agent} onOpen={() => setThread(agent.slug)} />
            ))}
            {office.isLoading ? <p className="wf-empty">Opening the office.</p> : null}
          </section>
          <RecentWork runs={office.data?.runs ?? []} agents={agents} />
        </div>
        <Conversation thread={thread} agents={agents} onThread={setThread} />
      </div>

      <HireDialog open={hiring} onClose={() => setHiring(false)} />
    </div>
  );
}
