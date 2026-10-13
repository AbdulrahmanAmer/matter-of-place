import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminProviders } from "../ui/test-providers";
import { SideChat } from "./SideChat";

// W5 items 7 to 9 (operator, 2026-10-13: "what command is he running ... a similar interface of how am I able to see
// your background tasks ... a tab if he is communicating with another agent").

const matter = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "matter",
  name: "Matter",
  role: "Owner-level agent",
  instructions: "",
  model: "opus",
  wake_on: [],
  tools: [],
  state: "working",
  current_task: "Bash: bun run check",
  last_seen_at: new Date().toISOString(),
  created_at: "2026-10-12T00:00:00Z",
  runs_today: 1,
};

const line = (id: string, thread: string, kind: string, name: string, body: string) => ({
  id: `00000000-0000-4000-8000-00000000010${id}`,
  thread,
  author_kind: kind,
  author_id: name.toLowerCase(),
  author_name: name,
  body,
  created_at: "2026-10-13T08:00:00Z",
});

function mount() {
  vi.stubGlobal("fetch", (path: string) => {
    if (path === "/api/admin/workforce/office")
      return Promise.resolve(
        Response.json({
          agents: [matter],
          runs: [],
          pending_approvals: 0,
          week: [],
          activity: [
            {
              id: "00000000-0000-4000-8000-000000000201",
              agent_slug: "matter",
              label: "bun run check",
              state: "running",
              started_at: "2026-10-13T08:00:00Z",
              finished_at: null,
            },
          ],
        }),
      );
    if (path.includes("thread=team"))
      return Promise.resolve(
        Response.json({
          items: [line("2", "team", "agent", "Concierge", "@editor the write-up is yours.")],
        }),
      );
    if (path.includes("thread=matter"))
      return Promise.resolve(
        Response.json({ items: [line("1", "matter", "agent", "Matter", "On it.")] }),
      );
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  render(
    <AdminProviders actions={["workforce.office", "workforce.messages", "workforce.post_message"]}>
      <SideChat open onClose={() => undefined} />
    </AdminProviders>,
  );
}

// jsdom has no showModal, close or scrollIntoView; these stand in for the browser's (as in channels.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  Element.prototype.scrollIntoView = function scrollIntoView() {
    return undefined;
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Matter's side chat", () => {
  it("shows what Matter is running now, its background tasks, and the team's talk, each in its own tab", async () => {
    mount();
    expect(await screen.findByText("Bash: bun run check")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    const tasks = screen.getByRole("tabpanel", { name: "Tasks" });
    expect(within(tasks).getByText("Running")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Team talk" }));
    const team = screen.getByRole("tabpanel", { name: "Team talk" });
    expect(await within(team).findByText("@editor the write-up is yours.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Team talk" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});
