import { screen, within } from "@testing-library/react";
import { Outlet } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { OfficePage } from "./OfficePage";

// W8 0i (ruling H115): each colleague's card says in words what it may use on this laptop, from the one toolkit data
// file the runner reads (`src/domain/toolkits.ts`); Matter's card shows none, since Matter runs under its own rules.

const agent = (n: number, slug: string, name: string, tools: string[]) => ({
  id: `a0000000-0000-4000-8000-00000000000${String(n)}`,
  slug,
  name,
  role: `The ${slug}`,
  instructions: "",
  model: "sonnet",
  wake_on: [],
  tools,
  state: "idle",
  current_task: null,
  last_seen_at: null,
  created_at: "2026-10-01T09:00:00Z",
  runs_today: 0,
});

function serve() {
  vi.stubGlobal("fetch", (path: string) =>
    Promise.resolve(
      Response.json(
        path === "/api/admin/workforce/office"
          ? {
              agents: [
                agent(1, "matter", "Matter", []),
                agent(2, "social", "Maya Okafor", ["read_business", "chat", "draft_post"]),
                agent(3, "editor", "Julian Reyes", ["read_business", "chat"]),
              ],
              runs: [],
              pending_approvals: 0,
              week: [],
              activity: [],
              allowance: null,
            }
          : { items: [] },
      ),
    ),
  );
  mountRoutes(
    () => (
      <AdminProviders actions={["workforce.office", "workforce.messages"]}>
        <Outlet />
      </AdminProviders>
    ),
    "/admin/office/",
    (root) => [pageRoute(root, "/admin/office/", () => <OfficePage />)],
  );
}

beforeEach(() => {
  // jsdom has no layout: the conversation scrolls its last line into view.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Office: each colleague's tools on this laptop", () => {
  it("shows Social's renders and Drive, the Editor's reads and drafts, and nothing for Matter", async () => {
    serve();
    const card = async (name: string) =>
      (await screen.findByRole("heading", { name })).closest("article") ?? document.body;
    const social = within(await card("Maya Okafor"));
    expect(social.getByText("Tools on this laptop")).toBeTruthy();
    expect(
      social.getByText("Renders a carousel, a single post and a story, from a local spec."),
    ).toBeTruthy();
    expect(social.getByText(/^Writes .*Google Drive, Social Media/)).toBeTruthy();
    expect(
      social.getByText(
        "Writes and renders only on work a person started; otherwise it only reads.",
      ),
    ).toBeTruthy();
    const editor = within(await card("Julian Reyes"));
    expect(editor.queryByText(/^Renders /)).toBeNull();
    expect(editor.getByText(/^Writes its own folder/)).toBeTruthy();
    expect(within(await card("Matter")).queryByText("Tools on this laptop")).toBeNull();
  });
});
