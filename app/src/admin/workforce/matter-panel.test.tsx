import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../../domain/workforce";
import { MatterPanelView, type MatterPanelViewProps } from "./MatterPanel";
import { presenceOf } from "./presence";
import { ago, took } from "./when";

// Matter's panel, remade 2026-10-15 from the operator's screenshot: three lists stacked at once, "offline" while the
// laptop was busy, markdown printed raw, day-old tasks with "started ... ended ..." at the top.

const NOW = Date.parse("2026-10-15T01:00:00Z");

const line = (
  id: number,
  kind: AgentMessage["author_kind"],
  name: string,
  body: string,
  at: string,
) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  thread: "matter",
  author_kind: kind,
  author_id: name.toLowerCase(),
  author_name: name,
  body,
  created_at: at,
});

function view(overrides: Partial<MatterPanelViewProps> = {}) {
  const props: MatterPanelViewProps = {
    presence: { kind: "online" },
    chat: [
      line(
        1,
        "agent",
        "Matter",
        "**Done:** the PR is green.\n\n- one\n- two",
        "2026-10-15T00:58:00Z",
      ),
    ],
    team: [line(2, "agent", "Concierge", "@editor the write-up is yours.", "2026-10-15T00:50:00Z")],
    tasks: [
      {
        id: "t1",
        label: "bun run check",
        state: "running",
        started_at: "2026-10-15T00:57:00Z",
        finished_at: null,
      },
      {
        id: "t2",
        label: "Fetch origin",
        state: "done",
        started_at: "2026-10-15T00:40:00Z",
        finished_at: "2026-10-15T00:40:12Z",
      },
      {
        id: "t3",
        label: "Old lint fix",
        state: "done",
        started_at: "2026-10-13T08:40:00Z",
        finished_at: "2026-10-13T08:41:00Z",
      },
    ],
    now: NOW,
    tab: "chat",
    draft: "",
    sending: false,
    loading: false,
    onTab: vi.fn(),
    onDraft: vi.fn(),
    onSend: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return render(<MatterPanelView {...props} />);
}

describe("Matter's panel", () => {
  it("renders only the open tab's body, never the three at once", () => {
    view({ tab: "chat" });
    const body = screen.getByRole("tabpanel");
    expect([
      screen.getAllByRole("tabpanel").length,
      within(body).queryByText("bun run check"),
      within(body).queryByText("@editor the write-up is yours."),
      screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-controls"),
      screen.getByRole("tab", { name: /Tasks/ }).getAttribute("aria-controls"),
    ]).toEqual([1, null, null, "mp-body", null]);
  });

  it("renders the staff's markdown, never the raw marks", () => {
    view();
    const body = screen.getByRole("tabpanel");
    expect([
      within(body).getByText("Done:").tagName,
      within(body)
        .getAllByRole("listitem")
        .some((item) => item.textContent === "one"),
      body.textContent.includes("**"),
    ]).toEqual(["STRONG", true, false]);
  });

  it("says what Matter is doing: working on a task, online, or offline since a time", () => {
    const { unmount } = view({ presence: { kind: "working", task: "Bash: bun run check" } });
    const working = screen.getByRole("status").textContent;
    unmount();
    const offline = view({ presence: { kind: "offline", since: "2026-10-14T21:43:00Z" } });
    const away = screen.getByRole("status").textContent;
    offline.unmount();
    view({ presence: { kind: "online" } });
    expect([
      working,
      away.startsWith("Offline since"),
      screen.getByRole("status").textContent,
    ]).toEqual(["Working: Bash: bun run check", true, "Online, ready for your next line"]);
  });

  it("groups tasks: running with its time, the last day with how long each took, older folded away", () => {
    view({ tab: "tasks" });
    const body = screen.getByRole("tabpanel");
    const metas = [...body.querySelectorAll(".mp-task__meta")].map((node) => node.textContent);
    expect([
      metas,
      within(body).getByText("Earlier (1)").tagName,
      screen.getByRole("tab", { selected: false, name: /Tasks/ }).textContent,
    ]).toEqual([
      ["running 3 min", "took 12 s, 20 min ago", "took 1 min, Tue, Oct 13, 04:40 ET"],
      "SUMMARY",
      "Tasks 1",
    ]);
  });
});

describe("Matter's presence", () => {
  it("is online while his row was touched within three minutes, offline after, working by his own state", () => {
    const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
    const base = { onTeam: true, now: NOW, task: null };
    expect([
      presenceOf({ ...base, lastSeen: at(2), state: "idle" }).kind,
      presenceOf({ ...base, lastSeen: at(4), state: "idle" }).kind,
      presenceOf({ ...base, lastSeen: at(1), state: "working" }).kind,
    ]).toEqual(["online", "offline", "working"]);
  });
});

describe("the panel's times", () => {
  it("reads like a person: just now, minutes, hours, then the day", () => {
    expect([
      ago("2026-10-15T00:59:30Z", NOW),
      ago("2026-10-15T00:56:00Z", NOW),
      ago("2026-10-14T22:00:00Z", NOW),
      took("2026-10-15T00:40:00Z", "2026-10-15T00:40:12Z", NOW),
      took("2026-10-14T23:55:00Z", "2026-10-15T01:00:00Z", NOW),
    ]).toEqual(["just now", "4 min ago", "3 h ago", "12 s", "1 h 5 min"]);
  });
});
