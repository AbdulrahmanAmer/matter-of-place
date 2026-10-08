import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminAsset } from "../../domain/admin-assets";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { ToastProvider } from "../ui/Toast";
import { AssetCards } from "./AssetCards";
import { useAssets } from "./assets-queries";

const PROPERTY = "00000000-0000-4000-8000-0000000000a1";
const ALL_ACTIONS = ["assets.approve", "assets.reject", "assets.re_render", "assets.caption"];

// jsdom has no showModal or close on <dialog>; these stand in for the browser's, which only toggle `open`.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function asset(overrides: Partial<AdminAsset> & Pick<AdminAsset, "id" | "kind">): AdminAsset {
  return {
    property_id: PROPERTY,
    revision: 1,
    status: "pending",
    caption: "A quiet house on the creek.",
    alt_text: "A stone house under oaks",
    meta: {},
    files: [],
    rejection_note: null,
    render_error: null,
    job_id: null,
    approved_at: null,
    created_at: "2026-10-07T09:00:00Z",
    updated_at: "2026-10-07T09:00:00Z",
    captions_waiting: false,
    ...overrides,
  };
}

const COVER = "00000000-0000-4000-8000-0000000000b1";
const CAROUSEL = "00000000-0000-4000-8000-0000000000b2";
const STORY = "00000000-0000-4000-8000-0000000000b3";
const REEL = "00000000-0000-4000-8000-0000000000b4";
const BLOCK = "00000000-0000-4000-8000-0000000000b5";
const EMAIL = "00000000-0000-4000-8000-0000000000b6";

const slides = Array.from({ length: 8 }, (_, index) => ({
  role: "slide" as const,
  index,
  media_key: `o/oak-hill/slide-${String(index)}.jpg`,
  url: `/media/o/oak-hill/slide-${String(index)}.jpg`,
  w: 1080,
  h: 1350,
  bytes: 90_000,
}));

const cover = asset({
  id: COVER,
  kind: "cover",
  files: [
    {
      role: "main",
      media_key: "o/oak-hill/cover.jpg",
      url: "/media/o/oak-hill/cover.jpg",
      w: 1200,
      h: 630,
      bytes: 80_000,
    },
  ],
});

const carousel = asset({
  id: CAROUSEL,
  kind: "carousel",
  files: slides,
  meta: { slide_alts: slides.map((_, index) => `Slide alt ${String(index + 1)}`) },
});

const story = asset({
  id: STORY,
  kind: "story",
  files: [
    {
      role: "main",
      media_key: "o/oak-hill/story.jpg",
      url: "/media/o/oak-hill/story.jpg",
      w: 1080,
      h: 1920,
      bytes: 70_000,
    },
  ],
});

const reel = asset({
  id: REEL,
  kind: "reel",
  files: [
    {
      role: "video",
      media_key: "o/oak-hill/reel.mp4",
      url: "/media/o/oak-hill/reel.mp4",
      w: 1080,
      h: 1920,
      bytes: 900_000,
    },
  ],
});

const block = asset({
  id: BLOCK,
  kind: "newsletter_block",
  meta: { block: { title: "Oak Hill", deck: "A house by the creek." } },
});

const email = asset({
  id: EMAIL,
  kind: "standalone_email",
  meta: { subject: "A house by the creek", preheader: "Oak Hill, Los Altos Hills." },
});

const kinds = [cover, carousel, story, reel, block, email];

const me = (actions: string[]): AdminMe => ({
  actor: { id: "u1" },
  kind: "human",
  roles: ["media_ops"],
  scopes: [],
  actions,
  environment: "production",
});

function Providers({ actions, children }: { actions: string[]; children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AdminMeContext value={me(actions)}>{children}</AdminMeContext>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const mount = (page: ReactNode, actions: string[] = ALL_ACTIONS) =>
  render(<Providers actions={actions}>{page}</Providers>);

const ok = (body: unknown) => () => Response.json(body);

/** Answers each `METHOD path` from the table; a request not in it answers 404. Returns the requests, bodies included. */
function serve(table: Record<string, () => Response> = {}) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    requested.push(typeof init.body === "string" ? `${key} ${init.body}` : key);
    const answer = table[key];
    if (answer === undefined) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(answer());
  });
  return requested;
}

const card = (name: RegExp | string) => screen.getByRole("article", { name });

describe("AssetCards", () => {
  it("draws a card for each kind with its picture, film or text", () => {
    mount(<AssetCards items={kinds} />);
    const articles = screen.getAllByRole("article");
    expect({
      cards: articles.map((article) => article.getAttribute("aria-label")),
      cover: within(card("Cover, revision 1")).getByRole("img").getAttribute("src"),
      story: within(card("Story, revision 1")).getByRole("img").getAttribute("src"),
      carousel: within(card("Carousel, revision 1")).getByText("Slide 1 of 8").tagName,
      reel: card("Reel, revision 1").querySelector("video")?.getAttribute("src"),
      block: within(card("Newsletter block, revision 1")).getByText("Oak Hill").tagName,
      email: within(card("Standalone email, revision 1")).getByText("A house by the creek").tagName,
    }).toEqual({
      cards: [
        "Cover, revision 1",
        "Carousel, revision 1",
        "Story, revision 1",
        "Reel, revision 1",
        "Newsletter block, revision 1",
        "Standalone email, revision 1",
      ],
      cover: "/media/o/oak-hill/cover.jpg",
      story: "/media/o/oak-hill/story.jpg",
      carousel: "SPAN",
      reel: "/media/o/oak-hill/reel.mp4",
      block: "H3",
      email: "P",
    });
  });

  it("steps the carousel through all eight slides and stops at both ends", () => {
    mount(<AssetCards items={[carousel]} />);
    const viewer = within(card("Carousel, revision 1"));
    const seen: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      fireEvent.click(viewer.getByRole("button", { name: "Next slide" }));
      seen.push(viewer.getByRole("img").getAttribute("alt") ?? "");
    }
    expect({
      seen,
      counter: viewer.getByText("Slide 8 of 8").tagName,
      nextOff: viewer.getByRole("button", { name: "Next slide" }).hasAttribute("disabled"),
    }).toEqual({
      seen: [2, 3, 4, 5, 6, 7, 8].map((n) => `Slide alt ${String(n)}`),
      counter: "SPAN",
      nextOff: true,
    });
    for (let step = 0; step < 7; step += 1) {
      fireEvent.click(viewer.getByRole("button", { name: "Previous slide" }));
    }
    expect(viewer.getByRole("button", { name: "Previous slide" })).toHaveProperty("disabled", true);
  });

  it("moves the carousel by a swipe of 40 pixels or more, not by a shorter one", () => {
    mount(<AssetCards items={[carousel]} />);
    const viewer = within(card("Carousel, revision 1"));
    const swipe = (from: number, to: number) => {
      fireEvent.pointerDown(viewer.getByRole("img"), { clientX: from });
      fireEvent.pointerUp(viewer.getByRole("img"), { clientX: to });
    };
    swipe(200, 190);
    const short = viewer.getByText(/^Slide \d of 8$/).textContent;
    swipe(200, 120);
    const left = viewer.getByText(/^Slide \d of 8$/).textContent;
    swipe(120, 200);
    expect({ short, left, back: viewer.getByText(/^Slide \d of 8$/).textContent }).toEqual({
      short: "Slide 1 of 8",
      left: "Slide 2 of 8",
      back: "Slide 1 of 8",
    });
  });

  it("shows a render error with Re-render, and says a caption waits for the runner", async () => {
    const requested = serve({
      [`POST /api/admin/assets/${COVER}/rerender`]: ok({ asset_id: COVER, job_id: null }),
    });
    mount(
      <AssetCards
        items={[
          asset({
            id: COVER,
            kind: "cover",
            render_error: "chromium exited 1",
            caption: null,
            captions_waiting: true,
          }),
        ]}
      />,
    );
    const cover = within(card("Cover, revision 1"));
    expect({
      error: cover.getByRole("alert").textContent,
      waiting: cover.getByText("Waiting for the caption runner.").tagName,
    }).toEqual({ error: "chromium exited 1", waiting: "P" });
    fireEvent.click(cover.getByRole("button", { name: "Re-render" }));
    await waitFor(() => {
      expect(requested).toEqual([`POST /api/admin/assets/${COVER}/rerender`]);
    });
  });

  it("turns a pending card to approved after the approve answers", async () => {
    let approved = false;
    const requested = serve({
      [`GET /api/admin/assets?property_id=${PROPERTY}`]: () =>
        Response.json({
          items: [asset({ id: COVER, kind: "cover", status: approved ? "approved" : "pending" })],
          total: 1,
        }),
      [`POST /api/admin/assets/${COVER}/approve`]: () => {
        approved = true;
        return Response.json({ asset_id: COVER, event_id: "00000000-0000-4000-8000-0000000000e1" });
      },
    });
    function Page() {
      const list = useAssets({ property_id: PROPERTY });
      return <AssetCards items={list.data?.items ?? []} />;
    }
    mount(<Page />);
    const before = await screen.findByText("Pending");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const after = await screen.findByText("Approved");
    expect({
      before: before.tagName,
      after: after.tagName,
      approve: screen.queryByRole("button", { name: "Approve" }),
      posts: requested.filter((line) => line.startsWith("POST")),
    }).toEqual({
      before: "SPAN",
      after: "SPAN",
      approve: null,
      posts: [`POST /api/admin/assets/${COVER}/approve`],
    });
  });

  it("refuses a reject without a note and sends the note it is given", async () => {
    const requested = serve({
      [`POST /api/admin/assets/${COVER}/reject`]: ok({
        asset_id: COVER,
        event_id: "00000000-0000-4000-8000-0000000000e2",
      }),
    });
    mount(<AssetCards items={[asset({ id: COVER, kind: "cover" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = within(screen.getByRole("dialog", { name: "Reject cover, revision 1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Reject" }));
    const refusal = dialog.getByRole("alert").textContent;
    const sentBefore = requested.length;
    fireEvent.change(dialog.getByLabelText("Note"), { target: { value: "  Crop is too tight " } });
    fireEvent.click(dialog.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(requested).toHaveLength(1);
    });
    expect({ refusal, sentBefore, requested }).toEqual({
      refusal: "A reject needs a note.",
      sentBefore: 0,
      requested: [`POST /api/admin/assets/${COVER}/reject {"note":"Crop is too tight"}`],
    });
  });

  it("saves the edited captions and alt text, and shows the server's refusal", async () => {
    const requested = serve({
      [`PUT /api/admin/assets/${COVER}/caption`]: () =>
        Response.json(
          {
            error: {
              code: "caption_lint_failed",
              message: "The caption does not follow the house voice.",
            },
          },
          { status: 422 },
        ),
    });
    mount(<AssetCards items={[asset({ id: COVER, kind: "cover" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit caption" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit caption" }));
    fireEvent.change(dialog.getByLabelText("X"), { target: { value: "Oak Hill, a quiet house." } });
    fireEvent.change(dialog.getByLabelText("Alt text"), { target: { value: "" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save caption" }));
    await waitFor(() => {
      expect(dialog.getByRole("alert").textContent).toBe(
        "The caption does not follow the house voice.",
      );
    });
    expect(requested).toEqual([
      `PUT /api/admin/assets/${COVER}/caption {"captions":{"instagram":"A quiet house on the creek.","x":"Oak Hill, a quiet house.","linkedin":"A quiet house on the creek."}}`,
    ]);
  });

  it("offers no move to an actor who holds none of the actions", () => {
    mount(<AssetCards items={[asset({ id: COVER, kind: "cover" })]} />, []);
    expect(within(card("Cover, revision 1")).queryAllByRole("button")).toEqual([]);
  });

  it("offers a rejected card only Re-render, and a published one nothing", () => {
    mount(
      <AssetCards
        items={[
          asset({ id: COVER, kind: "cover", status: "rejected", rejection_note: "Too dark" }),
          asset({ id: STORY, kind: "story", status: "published" }),
        ]}
      />,
    );
    expect({
      rejected: within(card("Cover, revision 1"))
        .getAllByRole("button")
        .map((button) => button.textContent),
      note: within(card("Cover, revision 1")).getByText("Rejected: Too dark").tagName,
      published: within(card("Story, revision 1")).queryAllByRole("button"),
    }).toEqual({ rejected: ["Re-render"], note: "P", published: [] });
  });
});
