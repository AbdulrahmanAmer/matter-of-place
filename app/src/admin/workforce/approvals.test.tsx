import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AdminProviders } from "../ui/test-providers";
import { ApprovalsPage } from "./ApprovalsPage";

// W2 step 6: the decision teaches. A decline says why, an edit approves the person's own version, and an instructions
// change is approved as a whole.

const HASH = "a".repeat(64);
const item = (id: string, action: string, body: string) => ({
  id: `00000000-0000-4000-8000-00000000000${id.slice(-1)}`,
  agent_slug: "concierge",
  action,
  summary: `Summary ${id}`,
  content: { body },
  content_hash: HASH,
  state: "pending",
  reason: null,
  edited_content: null,
  created_at: "2026-10-12T09:00:00Z",
});

const sent = z.object({
  decision: z.string(),
  content_hash: z.string(),
  reason: z.string().optional(),
  edited_body: z.string().optional(),
});

function serve(items: unknown[]) {
  const posts: z.infer<typeof sent>[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "POST") {
      posts.push(sent.parse(JSON.parse(typeof init.body === "string" ? init.body : "{}")));
      return Promise.resolve(Response.json({ state: "done" }));
    }
    if (path.startsWith("/api/admin/workforce/approvals"))
      return Promise.resolve(Response.json({ items }));
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  render(
    <AdminProviders actions={["workforce.approvals", "workforce.decide"]}>
      <ApprovalsPage />
    </AdminProviders>,
  );
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Approvals", () => {
  it("declines with the reason the person gives", async () => {
    const posts = serve([item("p1", "reply_inquiry", "Dear buyer, ...")]);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    fireEvent.change(screen.getByLabelText(/Why\? \(it teaches @concierge\)/), {
      target: { value: "Too formal. Write like a person." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => {
      expect(posts).toEqual([
        { decision: "rejected", content_hash: HASH, reason: "Too formal. Write like a person." },
      ]);
    });
  });

  it("approves the person's own version when they edit it first", async () => {
    const posts = serve([item("p2", "reply_inquiry", "Dear buyer, the house is lovely.")]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit, then approve" }));
    fireEvent.change(screen.getByLabelText(/Your version/), {
      target: { value: "Hello. The house has a garden facing west." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve my version" }));
    await waitFor(() => {
      expect(posts).toEqual([
        {
          decision: "approved",
          content_hash: HASH,
          edited_body: "Hello. The house has a garden facing west.",
        },
      ]);
    });
  });

  it("offers no edit for a change of a colleague's instructions", async () => {
    serve([item("p3", "instructions_change", "Write these lessons in")]);
    expect(
      await screen.findByText("Change to a colleague's instructions · from @concierge"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit, then approve" })).toBeNull();
  });

  it("shows the reel a post asked for beside its text, while it is made and once it waits in Visuals (W7 item 20)", async () => {
    serve([
      {
        ...item("p5", "social_post", "A first look at the coast."),
        agent_slug: "social",
        reel: { request_id: "r1", name: "Coast", status: "making", video: null, poster: null },
      },
      {
        ...item("p6", "campaign_plan", "Three weeks in Florida."),
        agent_slug: "campaigns",
        reel: {
          request_id: "r2",
          name: "Florida",
          status: "pending",
          video: "/media/requested/r2/reel.aaaaaaaa.mp4",
          poster: "/media/requested/r2/poster.bbbbbbbb.jpg",
        },
      },
    ]);
    expect(
      await screen.findByText(/Reel "Coast"\. The reel is being made on the laptop/),
    ).toBeTruthy();
    expect(screen.getByText(/Reel "Florida"\. The reel waits in Visuals/)).toBeTruthy();
    const poster = screen.getByRole("img", { name: 'The reel "Florida"' });
    expect([
      poster.getAttribute("src"),
      poster.closest("a")?.getAttribute("href"),
      screen.queryByRole("img", { name: 'The reel "Coast"' }),
    ]).toEqual([
      "/media/requested/r2/poster.bbbbbbbb.jpg",
      "/media/requested/r2/reel.aaaaaaaa.mp4",
      null,
    ]);
  });

  it("shows when a reply to an Instagram message must go by, and nothing of the kind for a comment (W8 item 4)", async () => {
    serve([
      {
        ...item("p1", "reply_social", "Yes, it is still for sale."),
        content: { body: "Yes, it is still for sale.", reply_by: "2026-10-28T12:00:00.000Z" },
      },
      item("p2", "reply_social", "Thank you for asking."),
    ]);
    await screen.findByText("Thank you for asking.");
    const windows = screen.queryAllByText(/Reply by/);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.textContent).toContain(
      "only within 24 hours of the person's latest message",
    );
    expect(windows[0]?.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-28T12:00:00.000Z",
    );
  });
});
