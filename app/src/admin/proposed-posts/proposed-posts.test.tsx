import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminProposedPost } from "../../domain/proposed-posts";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import { standInForDialogs } from "../ui/test-dialog";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { AdminProviders } from "../ui/test-providers";
import { ChannelPreview } from "./ChannelPreview";
import { ProposedPostCard } from "./ProposedPostCard";
import { ProposedPostsPage } from "./ProposedPostsPage";
import { proposedActions, type PostChannel, type PostFileView } from "./proposed-posts-labels";

const ID = "00000000-0000-4000-8000-0000000000f1";
const LIST = "/api/admin/proposed-posts";
const ALL = Object.values(proposedActions);
// What a decision answers (item 10's `proposedPostDecisionSchema`).
const DECIDED = { post_id: ID, revision: 1, event_ids: [], social_post_ids: [] };

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A file as item 10's admin route answers it: a storage key, where it came from, its alt text and its address.
const file = (name: string, over: Partial<PostFileView> = {}): PostFileView => ({
  key: `fairfield/${name}`,
  source: "studio",
  original: null,
  alt: `Alt of ${name}`,
  w: 1080,
  h: 1350,
  bytes: 90_000,
  url: `/media/fairfield/${name}`,
  ...over,
});

const post = (
  over: Partial<PostChannel> & Pick<PostChannel, "channel" | "format">,
): PostChannel => ({
  caption: "A quiet house on the creek.",
  images: [],
  reel: null,
  asset_id: null,
  social_post_id: null,
  ...over,
});

const slides = [1, 2, 3].map((n) =>
  file(`slide-${String(n)}.jpg`, { alt: `Slide alt ${String(n)}` }),
);

const instagramCarousel = post({
  channel: "instagram",
  format: "carousel",
  caption: "Instagram caption.",
  images: slides,
});
const linkedinSingle = post({
  channel: "linkedin",
  format: "single",
  caption: "LinkedIn caption.",
  images: [file("cover-linkedin.jpg", { alt: "A stone house" })],
});
const xSingle = post({
  channel: "x",
  format: "single",
  caption: "X caption.",
  images: [file("cover-x.jpg")],
});
const instagramReel = post({
  channel: "instagram",
  format: "reel",
  caption: "Reel caption.",
  reel: { video: file("reel.mp4"), poster: file("poster.jpg") },
});

const proposed = (over: Partial<AdminProposedPost> = {}): AdminProposedPost => ({
  id: ID,
  title: "Fairfield, CT",
  property_id: null,
  submission_id: null,
  proposer_kind: "agent",
  proposer_agent: "social",
  proposer_user: null,
  test: false,
  status: "proposed",
  revision: 1,
  rejection_note: null,
  approved_at: null,
  channels: [instagramCarousel, linkedinSingle, xSingle],
  created_at: "2026-10-16T09:00:00Z",
  updated_at: "2026-10-16T09:00:00Z",
  ...over,
});

const mount = (page: ReactNode, actions: string[] = ALL) =>
  render(<AdminProviders actions={actions}>{page}</AdminProviders>);

const preview = (channel: PostChannel) => {
  mount(<ChannelPreview post={channel} />);
  return screen.getByRole("region");
};

describe("ChannelPreview", () => {
  it("steps a carousel slide by slide with the caption under it on Instagram", () => {
    const region = within(preview(instagramCarousel));
    const first = region.getByRole("img").getAttribute("alt");
    fireEvent.click(region.getByRole("button", { name: "Next slide" }));
    const counter = region.getByText("Slide 2 of 3").tagName;
    const second = region.getByRole("img").getAttribute("alt");
    const figure = region.getByRole("figure");
    const caption = region.getByText("Instagram caption.");
    expect({
      first,
      second,
      counter,
      captionAfterSlides: Boolean(
        figure.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    }).toEqual({
      first: "Slide alt 1",
      second: "Slide alt 2",
      counter: "SPAN",
      captionAfterSlides: true,
    });
  });

  it("puts the words above the picture on X and LinkedIn, as those channels draw a post", () => {
    const region = within(preview(linkedinSingle));
    const caption = region.getByText("LinkedIn caption.");
    const image = region.getByRole("img");
    expect({
      captionBeforePicture: Boolean(
        caption.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      alt: image.getAttribute("alt"),
      src: image.getAttribute("src"),
    }).toEqual({
      captionBeforePicture: true,
      alt: "A stone house",
      src: "/media/fairfield/cover-linkedin.jpg",
    });
  });

  it("shows a single post's picture with its caption under it on Instagram", () => {
    const region = within(
      preview(
        post({
          channel: "instagram",
          format: "single",
          caption: "One picture.",
          images: [file("single.jpg")],
        }),
      ),
    );
    const image = region.getByRole("img");
    expect({
      pictureBeforeCaption: Boolean(
        image.compareDocumentPosition(region.getByText("One picture.")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      alt: image.getAttribute("alt"),
    }).toEqual({ pictureBeforeCaption: true, alt: "Alt of single.jpg" });
  });

  it("plays a reel in a player with its poster", () => {
    const region = preview(instagramReel);
    const video = region.querySelector("video");
    expect({
      src: video?.getAttribute("src"),
      poster: video?.getAttribute("poster"),
      controls: video?.hasAttribute("controls"),
      caption: within(region).getByText("Reel caption.").tagName,
    }).toEqual({
      src: "/media/fairfield/reel.mp4",
      poster: "/media/fairfield/poster.jpg",
      controls: true,
      caption: "P",
    });
  });

  it("counts the caption against the channel's limit and says when it is over", () => {
    const text = "x".repeat(281);
    const over = within(
      preview(post({ channel: "x", format: "single", caption: text, images: [file("a.jpg")] })),
    );
    expect(over.getByText(/281 of 280 characters, over by 1/).getAttribute("data-over")).toBe(
      "true",
    );
  });

  it("counts a caption within the limit without a warning, with each channel's own limit", () => {
    const { unmount } = render(
      <ChannelPreview
        post={post({ channel: "instagram", format: "single", images: [file("a.jpg")] })}
      />,
    );
    const instagram = screen.getByText(/of 2,200 characters/);
    const instagramOver = instagram.getAttribute("data-over");
    unmount();
    mount(<ChannelPreview post={linkedinSingle} />);
    expect({
      instagramOver,
      linkedin: screen.getByText(/of 3,000 characters/).getAttribute("data-over"),
    }).toEqual({ instagramOver: "false", linkedin: "false" });
  });

  it("names a picture that cannot be loaded and says file not found, not an empty frame", () => {
    const region = within(preview(linkedinSingle));
    fireEvent.error(region.getByRole("img"));
    expect({
      alert: region.getByRole("alert").textContent,
      pictures: region.queryAllByRole("img"),
    }).toEqual({ alert: "cover-linkedin.jpg: file not found.", pictures: [] });
  });

  it("names a carousel slide that cannot be loaded", () => {
    const region = within(preview(instagramCarousel));
    fireEvent.error(region.getByRole("img"));
    expect(region.getByRole("alert").textContent).toBe("slide-1.jpg: file not found.");
  });

  it("names a reel that cannot be loaded", () => {
    const region = preview(instagramReel);
    const video = region.querySelector("video");
    if (video === null) throw new Error("no player");
    fireEvent.error(video);
    expect({
      alert: within(region).getByRole("alert").textContent,
      player: region.querySelector("video"),
    }).toEqual({ alert: "reel.mp4: file not found.", player: null });
  });

  it("reads a reel's film head at once, so a film that is gone is found without a play", () => {
    const region = preview(instagramReel);
    expect(region.querySelector("video")?.getAttribute("preload")).toBe("metadata");
  });

  it("names a file by where it came from when it has a name there, else by its storage key", () => {
    const region = within(
      preview(
        post({
          channel: "linkedin",
          format: "single",
          images: [
            file("a1b2c3.jpg", {
              source: "drive",
              original: "Studio/Fairfield/front elevation.jpg",
            }),
          ],
        }),
      ),
    );
    fireEvent.error(region.getByRole("img"));
    expect(region.getByRole("alert").textContent).toBe("front elevation.jpg: file not found.");
  });

  it("says so when a post has no picture or no film attached", () => {
    const { unmount } = render(<ChannelPreview post={post({ channel: "x", format: "single" })} />);
    const noPicture = screen.getByText("No picture attached.").tagName;
    unmount();
    mount(<ChannelPreview post={post({ channel: "instagram", format: "reel" })} />);
    expect({ noPicture, noFilm: screen.getByText("No film attached.").tagName }).toEqual({
      noPicture: "P",
      noFilm: "P",
    });
  });
});

describe("ProposedPostCard", () => {
  const card = () => screen.getByRole("article");
  const decide = (name: string) => within(card()).getByRole("button", { name });

  it("shows every channel of the post, who proposed it and its status", () => {
    mount(<ProposedPostCard post={proposed()} />);
    expect({
      label: card().getAttribute("aria-label"),
      channels: within(card())
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label")),
      meta: card()
        .querySelector(".admin-asset__meta")
        ?.textContent.startsWith("Proposed by social, revision 1"),
      status: within(card()).getByText("Proposed").tagName,
    }).toEqual({
      label: "Fairfield, CT, revision 1",
      channels: ["Instagram, carousel", "LinkedIn, single post", "X, single post"],
      meta: true,
      status: "SPAN",
    });
  });

  it("names a person who proposed it as a person, and a colleague by its slug", () => {
    const { unmount } = render(
      <AdminProviders actions={ALL}>
        <ProposedPostCard
          post={proposed({ proposer_kind: "human", proposer_agent: null, proposer_user: ID })}
        />
      </AdminProviders>,
    );
    const person = card().querySelector(".admin-asset__meta")?.textContent;
    unmount();
    mount(<ProposedPostCard post={proposed({ proposer_agent: "social" })} />);
    expect({
      person: person?.startsWith("Proposed by a person, revision 1"),
      agent: card()
        .querySelector(".admin-asset__meta")
        ?.textContent.startsWith("Proposed by social,"),
    }).toEqual({ person: true, agent: true });
  });

  it("marks a test post TEST and a real one with no mark", () => {
    const { unmount } = render(
      <AdminProviders actions={ALL}>
        <ProposedPostCard post={proposed({ test: true })} />
      </AdminProviders>,
    );
    const marked = screen.queryByText("TEST")?.tagName;
    unmount();
    mount(<ProposedPostCard post={proposed()} />);
    expect({ marked, real: screen.queryByText("TEST") }).toEqual({ marked: "SPAN", real: null });
  });

  it("approves after a confirmation and sends nothing on Cancel", async () => {
    const requested = serve({ [`POST ${LIST}/${ID}/approve`]: DECIDED });
    mount(<ProposedPostCard post={proposed({ revision: 3 })} />);
    fireEvent.click(decide("Approve"));
    const dialog = within(
      screen.getByRole("dialog", { name: "Approve fairfield, ct, revision 3" }),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    // A write starts a tick after the click, so a request sent by the click shows only after the queue has run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const afterCancel = [...requested];
    fireEvent.click(decide("Approve"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Approve fairfield, ct, revision 3" })).getByRole(
        "button",
        { name: "Approve" },
      ),
    );
    // The revision the person saw goes with the approval: a newer one is refused as stale, not approved.
    await waitFor(() => {
      expect(requested).toEqual([`POST ${LIST}/${ID}/approve {"revision":3}`]);
    });
    expect(afterCancel).toEqual([]);
  });

  it("shows the reason when an approve is refused", async () => {
    serve({
      [`POST ${LIST}/${ID}/approve`]: Response.json(
        { error: { code: "manual_approval", message: "A person approves a post." } },
        { status: 403 },
      ),
    });
    mount(<ProposedPostCard post={proposed()} />);
    fireEvent.click(decide("Approve"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Approve fairfield, ct, revision 1" })).getByRole(
        "button",
        { name: "Approve" },
      ),
    );
    expect((await within(card()).findByRole("alert")).textContent).toBe(
      "A person approves a post.",
    );
  });

  it("refuses a reject without a note and sends the note it is given", async () => {
    const requested = serve({ [`POST ${LIST}/${ID}/reject`]: DECIDED });
    mount(<ProposedPostCard post={proposed()} />);
    fireEvent.click(decide("Reject"));
    const dialog = within(screen.getByRole("dialog", { name: "Reject fairfield, ct, revision 1" }));
    fireEvent.click(dialog.getByRole("button", { name: "Reject" }));
    const refusal = dialog.getByRole("alert").textContent;
    const sentBefore = requested.length;
    fireEvent.change(dialog.getByLabelText("Note"), {
      target: { value: " The listing was declined " },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(requested).toHaveLength(1);
    });
    expect({ refusal, sentBefore, requested }).toEqual({
      refusal: "A reject needs a note.",
      sentBefore: 0,
      requested: [`POST ${LIST}/${ID}/reject {"note":"The listing was declined"}`],
    });
  });

  it("asks for a re-render with a note", async () => {
    const requested = serve({ [`POST ${LIST}/${ID}/rerender`]: DECIDED });
    mount(<ProposedPostCard post={proposed()} />);
    fireEvent.click(decide("Ask for a re-render"));
    const dialog = within(
      screen.getByRole("dialog", { name: "Ask for a re-render of fairfield, ct, revision 1" }),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Ask for a re-render" }));
    const refusal = dialog.getByRole("alert").textContent;
    fireEvent.change(dialog.getByLabelText("Note"), { target: { value: "Crop the first slide" } });
    fireEvent.click(dialog.getByRole("button", { name: "Ask for a re-render" }));
    await waitFor(() => {
      expect(requested).toHaveLength(1);
    });
    expect({ refusal, requested }).toEqual({
      refusal: "A re-render needs a note.",
      requested: [`POST ${LIST}/${ID}/rerender {"note":"Crop the first slide"}`],
    });
  });

  it("offers a decision only to an actor who holds its action", () => {
    mount(<ProposedPostCard post={proposed({ channels: [xSingle] })} />, [proposedActions.reject]);
    expect(
      within(card())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Reject"]);
  });

  it("offers an approved or a rejected post no decision, and a rejected post shows its note", () => {
    const { unmount } = render(
      <AdminProviders actions={ALL}>
        <ProposedPostCard post={proposed({ status: "approved", channels: [xSingle] })} />
      </AdminProviders>,
    );
    const approved = within(card()).queryAllByRole("button");
    unmount();
    mount(
      <ProposedPostCard
        post={proposed({
          status: "rejected",
          rejection_note: "Listing declined",
          channels: [xSingle],
        })}
      />,
    );
    expect({
      approved,
      rejected: within(card())
        .queryAllByRole("button")
        .map((button) => button.textContent),
      note: within(card()).getByText("Rejected: Listing declined").tagName,
    }).toEqual({ approved: [], rejected: [], note: "P" });
  });

  it("reads the revisions only when the history is opened", async () => {
    const requested = serve({
      [`GET ${LIST}/${ID}`]: {
        ...proposed(),
        revisions: [
          {
            revision: 1,
            reason: "rejected",
            note: "Shorter caption",
            asked_by: ID,
            asked_by_kind: "human",
            snapshot: {},
            created_at: "2026-10-16T10:00:00Z",
          },
        ],
      },
    });
    mount(<ProposedPostCard post={proposed({ revision: 2 })} />);
    const before = [...requested];
    const details = card().querySelector("details");
    if (details === null) throw new Error("no history");
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect((await within(card()).findByText(/rejected by a person/)).textContent).toContain(
      "Shorter caption",
    );
    expect({ before, requested }).toEqual({ before: [], requested: [`GET ${LIST}/${ID}`] });
  });
});

describe("ProposedPostsPage", () => {
  const layout = () => (
    <AdminProviders actions={ALL}>
      <Outlet />
    </AdminProviders>
  );

  function open(at: string, answers: Record<string, unknown>) {
    const requested = serve(answers);
    mountRoutes(layout, at, (root) => [
      pageRoute(root, "/admin/proposed-posts/", () => <ProposedPostsPage />),
    ]);
    return requested;
  }

  it("lists every post with its previews and asks for the status of the address", async () => {
    const requested = open("/admin/proposed-posts/?status=rejected", {
      [`GET ${LIST}?status=rejected`]: {
        items: [proposed({ status: "rejected", test: true, rejection_note: "Listing declined" })],
        next_cursor: null,
      },
    });
    const article = await screen.findByRole("article");
    expect({
      requested,
      test: within(article).getByText("TEST").tagName,
      channels: within(article).getAllByRole("region"),
    }).toMatchObject({ requested: [`GET ${LIST}?status=rejected`], test: "SPAN" });
    expect(within(article).getAllByRole("region")).toHaveLength(3);
  });

  it("says no post is waiting when the list is empty", async () => {
    open("/admin/proposed-posts/", { [`GET ${LIST}`]: { items: [], next_cursor: null } });
    expect(await screen.findByText("No proposed posts")).toBeTruthy();
  });

  it("pages the posts: Next opens the page after the cursor, Previous goes back, and the last page has no Next", async () => {
    const cursor = `2026-10-16T09:00:00.000Z~${ID}`;
    const second = `GET ${LIST}?${new URLSearchParams({ cursor }).toString()}`;
    const requested = open("/admin/proposed-posts/", {
      [`GET ${LIST}`]: { items: [proposed()], next_cursor: cursor },
      [second]: { items: [proposed({ title: "Second page post" })], next_cursor: null },
    });
    await screen.findByRole("article", { name: "Fairfield, CT, revision 1" });
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("article", { name: "Second page post, revision 1" });
    expect(requested).toContain(second);
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("article", { name: "Fairfield, CT, revision 1" });
    expect(screen.queryByRole("article", { name: "Second page post, revision 1" })).toBeNull();
  });

  it("shows the server's message when the list does not load", async () => {
    open("/admin/proposed-posts/", {
      [`GET ${LIST}`]: Response.json(
        { error: { code: "unavailable", message: "The database is not available." } },
        { status: 503 },
      ),
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The database is not available.",
    );
  });
});
