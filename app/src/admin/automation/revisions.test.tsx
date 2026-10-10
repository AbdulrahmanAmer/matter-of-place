import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { standInForDialogs } from "../ui/test-dialog";
import type { RevisionRow } from "./automation-queries";
import { RevisionsPage } from "./RevisionsPage";
import { mountAdminPage } from "./test-mount";

const REVISIONS = "/api/admin/automation/revisions";

const revision = (fields: Partial<RevisionRow> & Pick<RevisionRow, "id">): RevisionRow => ({
  table_name: "automation_recipes",
  row_id: "row-1",
  before: null,
  after: null,
  actor_id: "u1",
  actor_kind: "human",
  note: null,
  at: "2026-10-07T15:00:00+00:00",
  ...fields,
});

const recipeEdit = revision({
  id: "v1",
  actor_kind: "agent",
  before: { trigger: "submission.received", name: "Submission received", enabled: true },
  after: { trigger: "submission.received", name: "Received", enabled: true },
});
const templateInsert = revision({
  id: "v2",
  table_name: "email_templates",
  at: "2026-10-07T14:00:00+00:00",
  after: { key: "request_declined", subject: "Your request" },
});
const channelEdit = revision({
  id: "v3",
  table_name: "channel_settings",
  at: "2026-10-07T13:00:00+00:00",
  before: { channel: "instagram", enabled: false },
  after: { channel: "instagram", enabled: true },
});
const directEdit = revision({
  id: "v4",
  table_name: "schedule_settings",
  actor_id: null,
  actor_kind: null,
  note: "direct",
  at: "2026-10-07T12:00:00+00:00",
  before: { key: "digest", enabled: true },
  after: { key: "digest", enabled: false },
});
const restoreNote = revision({
  id: "v5",
  at: "2026-10-07T16:00:00+00:00",
  note: "restore:v1",
  before: recipeEdit.after,
  after: recipeEdit.before,
});

const FIRST_PAGE_CURSOR = "2026-10-07T14:00:00+00:00~v2";

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The revisions as the Worker serves them: two pages of two, one page when a table is named, and a restore that
 * adds its own revision on top. `requests` lists `METHOD path` in order.
 */
function open(options: { actions?: string[]; refuse?: string } = {}) {
  const requests: string[] = [];
  let restored = false;
  const answer = (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    requests.push(`${method} ${path}`);
    if (method === "POST" && path === `${REVISIONS}/v1/restore`) {
      if (options.refuse !== undefined) {
        return Response.json(
          { error: { code: "validation", message: options.refuse } },
          { status: 422 },
        );
      }
      restored = true;
      return Response.json({ trigger: "submission.received", name: "Submission received" });
    }
    const url = new URL(path, "http://localhost");
    if (method !== "GET" || url.pathname !== REVISIONS) return new Response("{}", { status: 404 });
    const everything = [recipeEdit, templateInsert, channelEdit, directEdit];
    const table = url.searchParams.get("table_name");
    if (table !== null) {
      return Response.json({
        items: everything.filter((row) => row.table_name === table),
        next_cursor: null,
      });
    }
    if (url.searchParams.get("cursor") === FIRST_PAGE_CURSOR) {
      return Response.json({ items: [channelEdit, directEdit], next_cursor: null });
    }
    return Response.json({
      items: restored ? [restoreNote, recipeEdit] : [recipeEdit, templateInsert],
      next_cursor: restored ? null : FIRST_PAGE_CURSOR,
    });
  };
  mountAdminPage({
    actions: options.actions ?? ["automation.get", "automation.revisions_restore"],
    path: "/admin/automation/revisions",
    page: <RevisionsPage />,
    answer,
  });
  return { count: (request: string) => requests.filter((entry) => entry === request).length };
}

const bodyRows = () => screen.getAllByRole("row").slice(1);

/** One column of the table, top to bottom. */
const column = (index: number) =>
  bodyRows().map((row) => within(row).getAllByRole("cell")[index]?.textContent);

/** The first page has drawn: the table shows skeleton rows until then. */
const ready = () => screen.findByText("Recipe · submission.received");

const openRow = async (index: number) => {
  await ready();
  fireEvent.click(bodyRows()[index] ?? document.body);
};

const RESTORE_BUTTON = "Restore the values before this change";

describe("the list", () => {
  it("shows the newest changes first and marks the agent's with the Agent pill", async () => {
    open();
    await ready();
    expect(column(1)).toEqual(["Recipe · submission.received", "Email · request_declined"]);
    expect(column(2)).toEqual(["Edited", "Created"]);
    expect(within(bodyRows()[0] ?? document.body).getByText("Agent")).toBeTruthy();
    expect(within(bodyRows()[1] ?? document.body).queryByText("Agent")).toBeNull();
  });

  it("asks for one table when it is chosen and lists only its changes", async () => {
    const api = open();
    await ready();
    fireEvent.change(screen.getByLabelText("Table"), { target: { value: "channel_settings" } });
    await waitFor(() => {
      expect(column(1)).toEqual(["Channel · instagram"]);
    });
    expect(api.count(`GET ${REVISIONS}?table_name=channel_settings`)).toBe(1);
  });

  it("opens the next page with the cursor of the last row and names a change made outside the console", async () => {
    const api = open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(column(1)).toEqual(["Channel · instagram", "Schedule · digest"]);
    });
    expect(
      api.count(
        `GET ${REVISIONS}?${new URLSearchParams({ cursor: FIRST_PAGE_CURSOR }).toString()}`,
      ),
    ).toBe(1);
    expect(column(3)).toEqual(["Team member", "Direct edit"]);
  });
});

describe("one revision", () => {
  it("shows what changed as the value before and the value after", async () => {
    open();
    await openRow(0);
    const drawer = await screen.findByRole("dialog", { name: "Recipe · submission.received" });
    const field = within(drawer).getByRole("rowheader", { name: "name" });
    const values = within(field.closest("tr") ?? drawer).getAllByRole("cell");
    expect(values.map((cell) => cell.textContent)).toEqual(["Submission received", "Received"]);
    expect(within(drawer).getAllByRole("rowheader")).toHaveLength(1);
  });

  it("offers no way back for the revision that created the row", async () => {
    open();
    await openRow(1);
    expect(await screen.findByText(/nothing earlier to restore/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: RESTORE_BUTTON })).toBeNull();
  });

  it("offers no restore to a role the matrix leaves out", async () => {
    open({ actions: ["automation.get"] });
    await openRow(0);
    await screen.findByRole("dialog", { name: "Recipe · submission.received" });
    expect(screen.queryByRole("button", { name: RESTORE_BUTTON })).toBeNull();
  });
});

describe("restoring", () => {
  it("asks first, sends nothing on cancel, and calls the restore route once on confirm", async () => {
    const api = open();
    await openRow(0);
    fireEvent.click(await screen.findByRole("button", { name: RESTORE_BUTTON }));
    const confirm = await screen.findByRole("dialog", { name: "Restore the earlier values" });
    expect(within(confirm).getByText(/goes back to the values in the Before column/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(api.count(`POST ${REVISIONS}/v1/restore`)).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: RESTORE_BUTTON }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Restore the earlier values" })).getByRole(
        "button",
        { name: "Restore" },
      ),
    );
    await waitFor(() => {
      expect(column(2)[0]).toBe("Restored");
    });
    expect(api.count(`POST ${REVISIONS}/v1/restore`)).toBe(1);
    expect(screen.queryByRole("dialog", { name: "Recipe · submission.received" })).toBeNull();
  });

  it("shows the server's words when the restore is refused and keeps the question open", async () => {
    const api = open({ refuse: "That recipe no longer parses." });
    await openRow(0);
    fireEvent.click(await screen.findByRole("button", { name: RESTORE_BUTTON }));
    const confirm = await screen.findByRole("dialog", { name: "Restore the earlier values" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Restore" }));
    expect(await within(confirm).findByRole("alert")).toHaveProperty(
      "textContent",
      "That recipe no longer parses.",
    );
    expect(api.count(`POST ${REVISIONS}/v1/restore`)).toBe(1);
  });
});
