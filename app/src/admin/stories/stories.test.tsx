import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { StoryDetail, StoryListRow } from "../../domain/admin-stories";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { StoriesTable } from "./StoriesTable";
import { StoryEditor } from "./StoryEditor";

const STORY = "00000000-0000-4000-8000-0000000000a1";
const UPDATED = "2026-10-08T12:00:00.123456+00:00";
const NEXT = "2026-10-08T12:05:00.654321+00:00";
const PATH = `/api/admin/stories/${STORY}`;

const writerActions = ["stories.list", "stories.get", "stories.write"];
const editorActions = [...writerActions, "stories.publish", "stories.unpublish"];

const listRow = (over: Partial<StoryListRow> = {}): StoryListRow => ({
  id: STORY,
  slug: "a-quiet-house",
  title: "A quiet house",
  category: "Places",
  market_slug: "california",
  editorial_state: "draft",
  image: null,
  published_at: null,
  updated_at: UPDATED,
  ...over,
});

const detail = (over: Partial<StoryDetail> = {}): StoryDetail => ({
  ...listRow(),
  deck: "A house kept by one family.",
  body: ["One.", "Two."],
  properties: [],
  archived_at: null,
  image_url: null,
  ...over,
});

const live = detail({
  editorial_state: "published",
  published_at: UPDATED,
  image: "s/a-quiet-house-0a1b2c3d.webp",
  image_url: "/media/s/a-quiet-house-0a1b2c3d.webp",
});

const ready = detail({
  image: "s/a-quiet-house-0a1b2c3d.webp",
  image_url: "/media/s/a-quiet-house-0a1b2c3d.webp",
});

const stale = () =>
  new Response(
    JSON.stringify({ error: { code: "stale", message: "Someone saved first.", requestId: "r1" } }),
    { status: 409, headers: { "content-type": "application/json" } },
  );

/** The JSON bodies of the requests that began with `line`, in the order they were sent. */
function bodiesOf(requested: string[], line: string): unknown[] {
  return requested
    .filter((entry) => entry.startsWith(`${line} `))
    .map((entry): unknown => JSON.parse(entry.slice(line.length + 1)));
}

/** The JSON body of the one request that began with `line`. */
function bodyOf(requested: string[], line: string): unknown {
  const [body] = bodiesOf(requested, line);
  if (body === undefined) throw new Error(`no request ${line}`);
  return body;
}

function mount(actions: string[], story: StoryDetail | null, extra?: { onCreated?: () => void }) {
  return render(
    <AdminProviders actions={actions}>
      <StoryEditor
        story={story}
        {...(extra?.onCreated === undefined ? {} : { onCreated: extra.onCreated })}
        onReload={() => Promise.resolve(detail({ title: "Edited elsewhere", updated_at: NEXT }))}
      />
    </AdminProviders>,
  );
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StoriesTable", () => {
  it("lists each story with a link to its editor and its state in words", () => {
    render(
      <AdminProviders actions={writerActions}>
        <StoriesTable
          filters={{ values: {}, onChange: () => undefined }}
          rows={[listRow(), listRow({ id: "x", title: "Live one", editorial_state: "published" })]}
        />
      </AdminProviders>,
    );
    const table = within(screen.getByRole("table", { name: "Stories" }));
    expect({
      href: table.getByRole("link", { name: "A quiet house" }).getAttribute("href"),
      states: [table.getByText("Draft"), table.getByText("Published")].length,
    }).toEqual({ href: `/admin/stories/${STORY}`, states: 2 });
  });
});

describe("StoryEditor, a new story", () => {
  it("keeps Create draft off until title, address, deck, category and market are filled, then POSTs the fields", async () => {
    const requested = serve({ "POST /api/admin/stories": { id: STORY, updated_at: UPDATED } });
    const created = vi.fn();
    mount(writerActions, null, { onCreated: created });
    const button = screen.getByRole("button", { name: "Create draft" });
    type("Title", "A quiet house");
    type("Address", "a-quiet-house");
    type("Deck", "A house kept by one family.");
    type("Category", "Places");
    const before = button.hasAttribute("disabled");
    type("Market", "california");
    const after = button.hasAttribute("disabled");
    fireEvent.click(button);
    await waitFor(() => {
      expect(created).toHaveBeenCalledWith(STORY);
    });
    expect({ before, after, body: bodyOf(requested, "POST /api/admin/stories") }).toEqual({
      before: true,
      after: false,
      body: {
        patch: {
          slug: "a-quiet-house",
          title: "A quiet house",
          deck: "A house kept by one family.",
          category: "Places",
          market_slug: "california",
        },
      },
    });
  });
});

describe("StoryEditor, a story", () => {
  it("PATCHes only the changed fields at the updated_at it read, then sends the answer's updated_at next", async () => {
    const requested = serve({ [`PATCH ${PATH}`]: { id: STORY, updated_at: NEXT } });
    mount(writerActions, detail());
    type("Title", "A quieter house");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    type("Deck", "A deck kept short.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(requested.filter((line) => line.startsWith("PATCH"))).toHaveLength(2);
    });
    const [first, second] = bodiesOf(requested, `PATCH ${PATH}`);
    expect({ first, second }).toEqual({
      first: { expected_updated_at: UPDATED, patch: { title: "A quieter house" } },
      second: { expected_updated_at: NEXT, patch: { deck: "A deck kept short." } },
    });
  });

  it("a 409 stale save shows Reload and keeps what was typed, and Reload takes the stored copy underneath", async () => {
    const requested = serve({ [`PATCH ${PATH}`]: stale() });
    mount(writerActions, detail());
    type("Title", "A quieter house");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const banner = await screen.findByRole("alert");
    fireEvent.click(within(banner).getByRole("button", { name: "Reload" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect({
      typed: screen.getByLabelText<HTMLInputElement>("Title").value,
      saveOn: screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
      sent: requested.filter((line) => line.startsWith("PATCH")).length,
    }).toEqual({ typed: "A quieter house", saveOn: false, sent: 1 });
  });

  it("keeps Publish off while the story has no image or unsaved edits, and a writer sees no Publish or Unpublish", () => {
    mount(editorActions, detail());
    const noImage = screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled");
    document.body.replaceChildren();
    mount(writerActions, ready);
    expect({
      noImage,
      writer: [screen.queryByRole("button", { name: "Publish" })],
    }).toEqual({ noImage: true, writer: [null] });
  });

  it("Publish posts the updated_at it read once the story has an image, and then offers Unpublish", async () => {
    const requested = serve({ [`POST ${PATH}/publish`]: { id: STORY, updated_at: NEXT } });
    mount(editorActions, ready);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByRole("button", { name: "Unpublish" });
    expect(bodyOf(requested, `POST ${PATH}/publish`)).toEqual({ expected_updated_at: UPDATED });
  });

  it("Unpublish asks first and posts once after the confirmation", async () => {
    const requested = serve({ [`POST ${PATH}/unpublish`]: { id: STORY, updated_at: NEXT } });
    mount(editorActions, live);
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    const asked = requested.length;
    const dialog = await screen.findByRole("dialog", { name: "Unpublish this story" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish" }));
    await screen.findByRole("button", { name: "Publish" });
    expect({ asked, posts: requested.filter((line) => line.startsWith("POST")) }).toEqual({
      asked: 0,
      posts: [`POST ${PATH}/unpublish`],
    });
  });
});
