import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { Reply } from "../../domain/admin-emails";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { SentEmailsPage } from "./SentEmailsPage";

// W7 item 2: the Replies part of the Sent emails screen: each reply beside the email it answers, its owner and state,
// and the buttons that mark it.

const EMAILS = "/api/admin/emails";
const REPLIES = "/api/admin/emails/replies";
const FRESH = "5e1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f60";
const DONE = "5e1b6f0a-6d1c-4f8e-9a52-0b3c1d2e4f61";
const SENT = "c92fcbb1-f62e-4fb8-b186-744307f18dc2";

const reply = (over: Partial<Reply> = {}): Reply => ({
  id: FRESH,
  from_email: "dana@brokerage.example",
  from_name: "Dana Reyes",
  subject: "Re: About 12 Ocean Avenue",
  body: "Thursday works for the photographer.",
  received_at: "2026-10-15T16:00:00.000Z",
  owner_slug: "editor",
  state: "new",
  sent: {
    id: SENT,
    template_key: "accepted",
    to_email: "dana@brokerage.example",
    created_at: "2026-10-13T15:00:00.000Z",
    sent_at: "2026-10-13T15:00:03.000Z",
  },
  ...over,
});

function open(actions: string[], items: Reply[], extra: Record<string, unknown> = {}) {
  // The descriptors are copied, so an answer given as a getter is read once per request, as the fetch asks.
  const answers = {
    [`GET ${EMAILS}`]: { items: [], next_cursor: null, suppressions: [] },
    [`GET ${REPLIES}`]: { items, next_cursor: null },
  };
  Object.defineProperties(answers, Object.getOwnPropertyDescriptors(extra));
  const requested = serve(answers);
  mountRoutes(
    () => (
      <AdminProviders actions={actions}>
        <Outlet />
      </AdminProviders>
    ),
    "/admin/emails/",
    (root) => [pageRoute(root, "/admin/emails/", () => <SentEmailsPage />)],
  );
  return requested;
}

const MARK = ["audit.list", "audit.reply_mark"];

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the replies on the Sent emails screen", () => {
  it("shows each reply beside the email it answers, with its owner and state", async () => {
    open(MARK, [
      reply(),
      reply({ id: DONE, state: "answered", owner_slug: "concierge", sent: null }),
    ]);
    const table = await screen.findByRole("table", { name: "Replies (2)" });
    const [fresh, done] = within(table).getAllByRole("row").slice(1);
    expect(fresh?.textContent).toContain("Dana Reyes <dana@brokerage.example>");
    expect(fresh?.textContent).toContain("Re: About 12 Ocean Avenue");
    expect(fresh?.textContent).toContain("Thursday works for the photographer.");
    expect(fresh?.textContent).toContain("The acceptance to dana@brokerage.example,");
    expect(fresh?.textContent).toContain("The Editor");
    expect(fresh?.textContent).toContain("new");
    expect(done?.textContent).toContain("The email is no longer on file.");
    expect(done?.textContent).toContain("The Concierge");
    expect(done?.textContent).toContain("answered");
  });

  it("shows a reply's words as plain text, never as markup", async () => {
    const body = '<img src="x" onerror="alert(1)"> and <b>bold</b>';
    open(MARK, [reply({ body })]);
    const table = await screen.findByRole("table", { name: "Replies (1)" });
    expect(within(table).getByText(body)).toBeTruthy();
    expect(table.querySelector("img, b")).toBeNull();
  });

  it("marks a new reply seen once, when it is opened, and not a reply that is already seen", async () => {
    const requested = open(MARK, [reply(), reply({ id: DONE, state: "seen" })], {
      [`POST ${REPLIES}/${FRESH}`]: { id: FRESH, state: "seen" },
      [`POST ${REPLIES}/${DONE}`]: { id: DONE, state: "seen" },
    });
    const table = await screen.findByRole("table", { name: "Replies (2)" });
    const [fresh, done] = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("details"));
    if (fresh === null || fresh === undefined || done === null || done === undefined) {
      throw new Error("no details");
    }
    fresh.open = true;
    done.open = true;
    await waitFor(() => {
      expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
        `POST ${REPLIES}/${FRESH} {"state":"seen"}`,
      ]);
    });
  });

  it("marks a reply answered or ignored, and reads the replies again", async () => {
    const requested = open(MARK, [reply()], {
      [`POST ${REPLIES}/${FRESH}`]: { id: FRESH, state: "answered" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Mark answered" }));
    await waitFor(() => {
      expect(requested).toContain(`POST ${REPLIES}/${FRESH} {"state":"answered"}`);
    });
    await waitFor(() => {
      expect(requested.filter((line) => line === `GET ${REPLIES}`)).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    await waitFor(() => {
      expect(requested).toContain(`POST ${REPLIES}/${FRESH} {"state":"ignored"}`);
    });
  });

  it("does not offer the mark that a reply is already in", async () => {
    open(MARK, [reply({ state: "ignored" })]);
    expect(await screen.findByRole("button", { name: "Ignore" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Mark answered" })).toHaveProperty("disabled", false);
  });

  it("shows the replies to a reader but no buttons, and opening one marks nothing", async () => {
    const requested = open(["audit.list"], [reply()]);
    const table = await screen.findByRole("table", { name: "Replies (1)" });
    expect(screen.queryByRole("button", { name: "Mark answered" })).toBeNull();
    const details = table.querySelector("details");
    if (details === null) throw new Error("no details");
    details.open = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requested.some((line) => line.startsWith("POST"))).toBe(false);
  });

  it("asks only for the replies in the state chosen, and the sent emails only for theirs", async () => {
    const requested = open(MARK, [reply()], {
      [`GET ${REPLIES}?state=new`]: { items: [], next_cursor: null },
    });
    fireEvent.change(await screen.findByLabelText("Reply state"), { target: { value: "new" } });
    await waitFor(() => {
      expect(requested).toContain(`GET ${REPLIES}?state=new`);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requested.filter((line) => line.startsWith(`GET ${EMAILS}?`))).toEqual([]);
  });

  it("keeps the reply being read in front of the person when the filter is new", async () => {
    const NEW = `GET ${REPLIES}?state=new`;
    let reads = 0;
    const requested = open(MARK, [], {
      // Read again, the server no longer has the reply as new: the screen must not read again to show that.
      get [NEW]() {
        reads += 1;
        return { items: reads === 1 ? [reply()] : [], next_cursor: null };
      },
      [`POST ${REPLIES}/${FRESH}`]: { id: FRESH, state: "seen" },
    });
    fireEvent.change(await screen.findByLabelText("Reply state"), { target: { value: "new" } });
    const table = await screen.findByRole("table", { name: "Replies (1)" });
    const details = table.querySelector("details");
    if (details === null) throw new Error("no details");
    details.open = true;
    await waitFor(() => {
      expect(requested).toContain(`POST ${REPLIES}/${FRESH} {"state":"seen"}`);
    });
    await waitFor(() => {
      expect(within(table).getByText("seen")).toBeTruthy();
    });
    expect(reads).toBe(1);
    expect(screen.getByRole("table", { name: "Replies (1)" })).toBe(table);
    expect(table.querySelector("details")?.open).toBe(true);
    expect(within(table).getByText("Thursday works for the photographer.")).toBeTruthy();
  });

  it("pages the replies: Next opens the page after the cursor, Previous goes back, and the last page has no Next", async () => {
    const cursor = `2026-10-15T16:00:00.000Z~${FRESH}`;
    const second = `GET ${REPLIES}?${new URLSearchParams({ cursor }).toString()}`;
    const requested = open(MARK, [], {
      [`GET ${REPLIES}`]: { items: [reply()], next_cursor: cursor },
      [second]: {
        items: [reply({ id: DONE, subject: "Re: Second page", state: "seen" })],
        next_cursor: null,
      },
    });
    await screen.findByText("Re: About 12 Ocean Avenue");
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Re: Second page");
    expect(requested).toContain(second);
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Re: About 12 Ocean Avenue");
    expect(screen.queryByText("Re: Second page")).toBeNull();
  });
});
