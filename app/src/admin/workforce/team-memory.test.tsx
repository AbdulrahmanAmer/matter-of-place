import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Outlet } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { OfficePage } from "./OfficePage";

// W7 item 4: the team's memory in Office: Decisions, Lessons and Instruction history, read only. Every text was
// written by an AI colleague, so each is shown as text and never as HTML.

const ADA = "11111111-1111-4111-8111-111111111111";
const V1 = "a0000000-0000-4000-8000-000000000001";
const V2 = "a0000000-0000-4000-8000-000000000002";
const V3 = "a0000000-0000-4000-8000-000000000003";

const decision = (id: string, over: object = {}) => ({
  id: `d0000000-0000-4000-8000-00000000000${id}`,
  meeting_on: "2026-10-15",
  owner_slug: "social",
  owner_name: "Maya Okafor",
  decision: `Decision ${id}`,
  due_on: "2026-10-22",
  metric: `Metric ${id}`,
  status: "open",
  checked_at: null,
  ...over,
});

const lesson = (id: string, over: object = {}) => ({
  id: `e0000000-0000-4000-8000-00000000000${id}`,
  agent_slug: "social",
  agent_name: "Maya Okafor",
  trigger: `Trigger ${id}`,
  action: `Action ${id}`,
  source: "decline",
  status: "active",
  uses: 3,
  last_used_at: "2026-10-14T09:00:00Z",
  created_at: "2026-10-10T09:00:00Z",
  ...over,
});

const version = (id: string, over: object = {}) => ({
  id,
  agent_slug: "social",
  agent_name: "Maya Okafor",
  version: 2,
  reason: "Declined twice for sounding formal",
  approval_id: null,
  created_at: "2026-10-12T09:00:00Z",
  ...over,
});

interface Served {
  decisions?: object[];
  /** The true totals per status, when the server holds more than it sends. */
  counts?: Partial<Record<"open" | "done" | "missed", number>>;
  lessons?: object[];
  /** The true number of lessons or versions, when the server holds more than it sends. */
  lessonTotal?: number;
  versions?: object[];
  versionTotal?: number;
  texts?: Record<string, string>;
  fail?: boolean;
}

const statusOf = (row: object): unknown => Reflect.get(row, "status");

/** What the decisions route answers: the rows of the asked status (all when none), and the true total of each. */
function decisionsAnswer(served: Served, status: string | null) {
  const all = served.decisions ?? [];
  const total = (each: "open" | "done" | "missed") =>
    served.counts?.[each] ?? all.filter((row) => statusOf(row) === each).length;
  return {
    items: status === null ? all : all.filter((row) => statusOf(row) === status),
    counts: { open: total("open"), done: total("done"), missed: total("missed") },
  };
}

/** The office and the three memory reads, answered from `served`; `asked` lists every path the screen called. */
function serve(served: Served = {}) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (path: string) => {
    asked.push(path);
    if (served.fail === true && path.includes("/memory/")) {
      return Promise.resolve(Response.json({ error: "unavailable" }, { status: 500 }));
    }
    const url = new URL(path, "https://example.test");
    if (url.pathname === "/api/admin/workforce/memory/decisions") {
      return Promise.resolve(
        Response.json(decisionsAnswer(served, url.searchParams.get("status"))),
      );
    }
    if (path === "/api/admin/workforce/memory/lessons") {
      const items = served.lessons ?? [];
      return Promise.resolve(Response.json({ items, total: served.lessonTotal ?? items.length }));
    }
    if (path === "/api/admin/workforce/memory/instructions") {
      const items = served.versions ?? [];
      return Promise.resolve(Response.json({ items, total: served.versionTotal ?? items.length }));
    }
    const text = /\/memory\/instructions\/([^/?]+)$/.exec(path)?.[1];
    if (text !== undefined) {
      return Promise.resolve(Response.json({ id: text, instructions: served.texts?.[text] ?? "" }));
    }
    if (path === "/api/admin/workforce/office") {
      return Promise.resolve(
        Response.json({
          agents: [],
          runs: [],
          pending_approvals: 0,
          week: [],
          activity: [],
          allowance: null,
        }),
      );
    }
    return Promise.resolve(Response.json({ items: [] }));
  });
  mountRoutes(
    () => (
      <AdminProviders actions={["workforce.office", "workforce.messages"]}>
        <Outlet />
      </AdminProviders>
    ),
    "/admin/office/",
    (root) => [
      pageRoute(root, "/admin/office/", () => <OfficePage />),
      pageRoute(root, "/admin/approvals/"),
    ],
  );
  return asked;
}

const openTab = async (name: string) => {
  fireEvent.click(await screen.findByRole("tab", { name }));
};

beforeEach(() => {
  // jsdom has no layout: the conversation scrolls its last line into view.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Office: the team's memory", () => {
  it("opens on the floor and offers the three memory tabs beside it", async () => {
    const asked = serve();
    expect(
      (await screen.findAllByRole("tab")).map((tab) => [
        tab.textContent,
        tab.getAttribute("aria-selected"),
      ]),
    ).toEqual([
      ["The floor", "true"],
      ["Decisions", "false"],
      ["Lessons", "false"],
      ["Instruction history", "false"],
    ]);
    expect(await screen.findByRole("heading", { name: "Recent work" })).toBeTruthy();
    expect(asked.filter((path) => path.includes("/memory/"))).toEqual([]);
  });

  it("lists each decision with its owner, due date, metric and status", async () => {
    serve({
      decisions: [
        decision("1", { decision: "Post two reels a week", metric: "Two reels approved" }),
        decision("2", { status: "done", owner_name: "Ada Chief" }),
      ],
    });
    await openTab("Decisions");
    const row = (await screen.findByText("Post two reels a week")).closest("tr");
    if (row === null) throw new Error("no row");
    expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Post two reels a week",
      "Maya Okafor",
      "Oct 22, 2026",
      "Two reels approved",
      "Open",
      "Oct 15, 2026",
    ]);
    expect(screen.getByText("Ada Chief")).toBeTruthy();
  });

  it("filters the decisions to open, done or missed on the server, with the count on each filter", async () => {
    const asked = serve({
      decisions: [
        decision("1"),
        decision("2", { status: "done" }),
        decision("3", { status: "missed" }),
        decision("4", { status: "missed" }),
      ],
    });
    await openTab("Decisions");
    await screen.findByText("Decision 1");
    // The previous rows stay on screen while a filter loads: wait until the rows are the ones the filter names.
    const rows = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    const seen = async (expected: string[]) => {
      await waitFor(() => {
        expect(rows()).toEqual(expected);
      });
      return rows();
    };
    const all = await seen(["Decision 1", "Decision 2", "Decision 3", "Decision 4"]);
    fireEvent.click(screen.getByRole("button", { name: "Missed (2)" }));
    const missed = await seen(["Decision 3", "Decision 4"]);
    fireEvent.click(screen.getByRole("button", { name: "Open (1)" }));
    const open = await seen(["Decision 1"]);
    fireEvent.click(screen.getByRole("button", { name: "Done (1)" }));
    expect({
      all,
      missed,
      open,
      done: await seen(["Decision 2"]),
      asked: asked.filter((path) => path.includes("/memory/decisions")),
    }).toEqual({
      all: ["Decision 1", "Decision 2", "Decision 3", "Decision 4"],
      missed: ["Decision 3", "Decision 4"],
      open: ["Decision 1"],
      done: ["Decision 2"],
      asked: [
        "/api/admin/workforce/memory/decisions",
        "/api/admin/workforce/memory/decisions?status=missed",
        "/api/admin/workforce/memory/decisions?status=open",
        "/api/admin/workforce/memory/decisions?status=done",
      ],
    });
  });

  it("says so calmly when no decision has the status asked for, and when there is none at all", async () => {
    serve({ decisions: [decision("1")] });
    await openTab("Decisions");
    await screen.findByText("Decision 1");
    fireEvent.click(screen.getByRole("button", { name: "Done (0)" }));
    expect(await screen.findByText("No done decision.")).toBeTruthy();
  });

  it("counts the true total of each status, not the rows it was sent, and says how many it shows", async () => {
    serve({
      decisions: [decision("1"), decision("2"), decision("3", { status: "done" })],
      counts: { open: 412, done: 1, missed: 30 },
    });
    await openTab("Decisions");
    await screen.findByText("Decision 1");
    const filters = screen.getAllByRole("button").map((button) => button.textContent);
    const all = screen.getByText("Showing the newest 3 of 443 decisions.").textContent;
    fireEvent.click(screen.getByRole("button", { name: "Open (412)" }));
    const open = (await screen.findByText("Showing the newest 2 of 412 open decisions."))
      .textContent;
    expect({ all, open }).toEqual({
      all: "Showing the newest 3 of 443 decisions.",
      open: "Showing the newest 2 of 412 open decisions.",
    });
    expect(filters).toEqual(
      expect.arrayContaining(["All (443)", "Open (412)", "Done (1)", "Missed (30)"]),
    );
  });

  it("says nothing about a cap when every decision is on screen", async () => {
    serve({ decisions: [decision("1")] });
    await openTab("Decisions");
    await screen.findByText("Decision 1");
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it("says how many lessons it shows when the list was cut at its bound", async () => {
    serve({ lessons: [lesson("1"), lesson("2")], lessonTotal: 240 });
    await openTab("Lessons");
    expect((await screen.findByText(/Showing the newest/)).textContent).toBe(
      "Showing the newest 2 of 240 lessons.",
    );
  });

  it("says how many versions it shows when the history was cut at its bound", async () => {
    serve({ versions: [version(V1)], versionTotal: 260 });
    await openTab("Instruction history");
    expect((await screen.findByText(/Showing the newest/)).textContent).toBe(
      "Showing the newest 1 of 260 versions.",
    );
  });

  it("shows a calm empty state on each tab when nothing is written yet", async () => {
    serve();
    await openTab("Decisions");
    const decisions = await screen.findByText(/No decision yet\./);
    await openTab("Lessons");
    const lessons = await screen.findByText(/No lesson yet\./);
    await openTab("Instruction history");
    const history = await screen.findByText(/No version yet\./);
    expect([decisions, lessons, history].map((node) => node.textContent)).toEqual([
      "No decision yet. The daily meeting writes its decisions here once it has met.",
      "No lesson yet. A declined or edited proposal teaches the colleague who wrote it.",
      "No version yet. The first change to a colleague's instructions starts their history.",
    ]);
  });

  it("says the memory could not be read when the read fails", async () => {
    serve({ fail: true });
    await openTab("Lessons");
    expect(await screen.findByText(/The lessons could not be read/)).toBeTruthy();
  });

  it("shows a decision's words as text, never as HTML", async () => {
    serve({ decisions: [decision("1", { decision: "<b>Bold claim</b>" })] });
    await openTab("Decisions");
    const cell = await screen.findByText("<b>Bold claim</b>");
    expect(cell.querySelector("b")).toBeNull();
  });

  it("shows a decision's metric as text, never as HTML", async () => {
    serve({ decisions: [decision("1", { metric: "<i>Two reels</i>" })] });
    await openTab("Decisions");
    const cell = await screen.findByText("<i>Two reels</i>");
    expect(cell.querySelector("i")).toBeNull();
  });

  it("shows a lesson's trigger as text, never as HTML", async () => {
    serve({ lessons: [lesson("1", { trigger: "<b>A caption opens</b>" })] });
    await openTab("Lessons");
    const cell = await screen.findByText("<b>A caption opens</b>");
    expect(cell.querySelector("b")).toBeNull();
  });

  it("shows a lesson's action as text, never as HTML", async () => {
    serve({ lessons: [lesson("1", { action: "<i>Open with the place</i>" })] });
    await openTab("Lessons");
    const cell = await screen.findByText("<i>Open with the place</i>");
    expect(cell.querySelector("i")).toBeNull();
  });

  it("shows a version's reason as text, never as HTML", async () => {
    serve({ versions: [version(V1, { reason: "<b>Declined twice</b>" })] });
    await openTab("Instruction history");
    const reason = await screen.findByText("<b>Declined twice</b>");
    expect(reason.querySelector("b")).toBeNull();
  });

  it("lists each lesson with whose it is, its trigger and action, source, status, uses and last use", async () => {
    serve({
      lessons: [
        lesson("1"),
        lesson("2", {
          agent_slug: null,
          agent_name: null,
          source: "matter",
          status: "promoted",
          uses: 0,
          last_used_at: null,
        }),
      ],
    });
    await openTab("Lessons");
    await screen.findByText("Trigger 1");
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      );
    expect(cells).toEqual([
      [
        "Maya Okafor",
        "Trigger 1",
        "Action 1",
        "A declined proposal",
        "Active",
        "3",
        "Oct 14, 2026 ET",
      ],
      [
        "The whole team",
        "Trigger 2",
        "Action 2",
        "Matter",
        "Promoted to instructions",
        "0",
        "Never",
      ],
    ]);
  });

  it("names a lesson from building as Matter's own build", async () => {
    serve({
      lessons: [lesson("1", { agent_slug: "matter", agent_name: "Matter", source: "build" })],
    });
    await openTab("Lessons");
    await screen.findByText("Trigger 1");
    expect(screen.getByText("Matter's own build")).toBeTruthy();
  });

  it("groups the instruction history per colleague, newest first, and reads a version's text only when asked", async () => {
    const asked = serve({
      versions: [
        version(V3, { version: 3, reason: "Taught to open with the place" }),
        version(V1, { agent_slug: "chief", agent_name: "Ada Chief", version: 1, reason: "Hired" }),
        version(V2, { version: 2, approval_id: ADA }),
      ],
      texts: { [V3]: "Open with the place.\nNever ask a question." },
    });
    await openTab("Instruction history");
    await screen.findByText("Taught to open with the place");
    const groups = screen.getAllByRole("heading", { level: 3 }).map((heading) => {
      const group = heading.closest<HTMLElement>(".wf-mem__colleague");
      if (group === null) throw new Error("a colleague's heading sits outside its group");
      return [
        heading.textContent,
        within(group)
          .getAllByRole("listitem")
          .map((item) => item.querySelector("strong")?.textContent),
      ];
    });
    const before = asked.filter((path) => /instructions\/[^/]+$/.test(path));
    const [newest] = screen.getAllByRole("button", { name: "Show the text" });
    if (newest === undefined) throw new Error("no version to open");
    fireEvent.click(newest);
    const text = await screen.findByText(/Open with the place\.\s+Never ask a question\./);
    expect({
      groups,
      before,
      after: asked.filter((path) => /instructions\/[^/]+$/.test(path)),
      shown: text.textContent,
    }).toEqual({
      groups: [
        ["Maya Okafor", ["Version 3", "Version 2"]],
        ["Ada Chief", ["Version 1"]],
      ],
      before: [],
      after: [`/api/admin/workforce/memory/instructions/${V3}`],
      shown: "Open with the place.\nNever ask a question.",
    });
    expect(screen.getByText("Approved in Approvals")).toBeTruthy();
  });

  it("shows a version's text as text, never as HTML, and hides it again", async () => {
    serve({
      versions: [version(V1)],
      texts: { [V1]: "Write like a person.<script>window.pwned = 1</script><b>x</b>" },
    });
    await openTab("Instruction history");
    fireEvent.click(await screen.findByRole("button", { name: "Show the text" }));
    const pre = await screen.findByText(/Write like a person\./);
    const pwned: unknown = Reflect.get(window, "pwned");
    expect({
      text: pre.textContent,
      elements: pre.querySelectorAll("script, b").length,
      pwned,
    }).toEqual({
      text: "Write like a person.<script>window.pwned = 1</script><b>x</b>",
      elements: 0,
      pwned: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide the text" }));
    expect(screen.queryByText(/Write like a person\./)).toBeNull();
  });
});
