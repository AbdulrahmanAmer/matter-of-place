import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Issue, SubscriberCountsView } from "../../domain/admin-newsletter";
import { IssueEditor, type IssueDraft } from "./IssueEditor";
import { IssuesTable } from "./IssuesTable";
import { PreviewFrame } from "./PreviewFrame";
import { SubscribersTab } from "./SubscribersTab";

// jsdom has no showModal or close on <dialog>; these stand in for the browser's, which only toggle `open`.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

const ISSUE_ID = "00000000-0000-4000-8000-0000000000a1";
const PROPERTY_ID = "00000000-0000-4000-8000-0000000000b1";
const STORY_ID = "00000000-0000-4000-8000-0000000000b2";
const ASSET_ID = "00000000-0000-4000-8000-0000000000b3";

const issue = (patch: Partial<Issue> = {}): Issue => ({
  id: ISSUE_ID,
  number: 7,
  status: "draft",
  blocks: [
    { id: "intro-1", type: "intro", text: "Two houses and a story." },
    {
      id: "block-house",
      type: "property",
      property_id: PROPERTY_ID,
      asset_id: ASSET_ID,
      title: "House on the point",
      deck: "Montecito, California",
    },
    { id: "block-story", type: "story", story_id: STORY_ID, title: "The long view", deck: "" },
  ],
  subject: "Place Notes No. 7",
  preheader: "Two houses and a story.",
  scheduled_for: null,
  sent_at: null,
  send_error: null,
  approval_count: 0,
  metrics: {},
  ...patch,
});

const can = { update: true, approve: true, unapprove: true, sendTest: true };

function mountEditor(
  patch: Partial<Issue> = {},
  overrides: Partial<Parameters<typeof IssueEditor>[0]> = {},
) {
  const handlers = {
    onSave: vi.fn((_draft: IssueDraft) => Promise.resolve()),
    onApprove: vi.fn((_sendAt: string | undefined) => Promise.resolve()),
    onUnapprove: vi.fn(() => Promise.resolve()),
    onSendTest: vi.fn(() => Promise.resolve()),
  };
  render(<IssueEditor issue={issue(patch)} can={can} {...handlers} {...overrides} />);
  return handlers;
}

const names = () =>
  within(screen.getByRole("list", { name: "Blocks, in reading order" }))
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("IssuesTable", () => {
  it("lists each issue with its status, subject and block count, and links to the editor", () => {
    render(
      <IssuesTable
        rows={[
          issue(),
          issue({ id: "other", number: 6, status: "sent", sent_at: "2026-09-22T14:00:00Z" }),
        ]}
        loading={false}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0] ?? document.body);
    expect(first.getByRole("link", { name: "No. 7" }).getAttribute("href")).toBe(
      `/admin/newsletter/${ISSUE_ID}`,
    );
    expect(first.getByText("Draft")).toBeTruthy();
    expect(first.getByText("Place Notes No. 7")).toBeTruthy();
    expect(first.getByText("3 blocks")).toBeTruthy();
    expect(within(rows[1] ?? document.body).getByText("Sent")).toBeTruthy();
  });

  it("says there is no issue yet when the list is empty", () => {
    render(<IssuesTable rows={[]} loading={false} />);
    expect(screen.getByRole("heading", { name: "No issue yet" })).toBeTruthy();
  });
});

describe("IssueEditor", () => {
  it("moves a block with the keyboard buttons and saves the new order", async () => {
    const { onSave } = mountEditor();
    expect(names()).toEqual(["Introduction", "House on the point", "The long view"]);
    fireEvent.click(button("Move down: Introduction"));
    expect(names()).toEqual(["House on the point", "Introduction", "The long view"]);
    fireEvent.click(button("Move up: The long view"));
    expect(names()).toEqual(["House on the point", "The long view", "Introduction"]);
    fireEvent.click(button("Save"));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[0].blocks.map((block) => block.id)).toEqual([
      "block-house",
      "block-story",
      "intro-1",
    ]);
  });

  it("keeps the first block from moving up and the last from moving down", () => {
    mountEditor();
    expect(button("Move up: Introduction").hasAttribute("disabled")).toBe(true);
    expect(button("Move down: The long view").hasAttribute("disabled")).toBe(true);
  });

  it("reorders by dragging one block onto another", () => {
    mountEditor();
    const items = within(
      screen.getByRole("list", { name: "Blocks, in reading order" }),
    ).getAllByRole("listitem");
    fireEvent.dragStart(items[2] ?? document.body);
    fireEvent.drop(items[0] ?? document.body);
    expect(names()).toEqual(["The long view", "Introduction", "House on the point"]);
  });

  it("keeps Approve off while the editor holds no blocks, though nothing is saved yet", () => {
    mountEditor();
    expect(button("Approve").hasAttribute("disabled")).toBe(false);
    fireEvent.click(button("Remove: Introduction"));
    fireEvent.click(button("Remove: House on the point"));
    fireEvent.click(button("Remove: The long view"));
    expect(button("Approve").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Add a block before approving.")).toBeTruthy();
  });

  it("keeps Approve off while a change is not saved", () => {
    mountEditor();
    fireEvent.click(button("Move down: Introduction"));
    expect(button("Approve").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Save your changes before approving.")).toBeTruthy();
  });

  it("approves with the time read in Eastern time as a UTC instant", async () => {
    const { onApprove } = mountEditor();
    fireEvent.click(button("Approve"));
    const dialog = screen.getByRole("dialog", { name: "Approve this issue" });
    fireEvent.change(within(dialog).getByLabelText("Send at (Eastern time)"), {
      target: { value: "2026-11-06T09:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith("2026-11-06T14:00:00.000Z");
    });
  });

  it("approves with no time when the field is left empty", async () => {
    const { onApprove } = mountEditor();
    fireEvent.click(button("Approve"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Approve this issue" })).getByRole("button", {
        name: "Approve",
      }),
    );
    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(undefined);
    });
  });

  it("takes an approved issue back to draft after one confirmation, and cannot edit it", async () => {
    const { onUnapprove } = mountEditor({
      status: "approved",
      scheduled_for: "2026-11-06T14:00:00Z",
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move down/ })).toBeNull();
    fireEvent.click(button("Unapprove"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Take this issue back to draft" })).getByRole(
        "button",
        {
          name: "Unapprove",
        },
      ),
    );
    await waitFor(() => {
      expect(onUnapprove).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a refusal inline and leaves the draft as typed", async () => {
    const refuse = vi.fn((_draft: IssueDraft) =>
      Promise.reject(new Error("Someone approved this issue.")),
    );
    mountEditor({}, { onSave: refuse });
    fireEvent.click(button("Move down: Introduction"));
    fireEvent.click(button("Save"));
    expect((await screen.findByRole("alert")).textContent).toBe("Someone approved this issue.");
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(["House on the point", "Introduction", "The long view"]);
  });

  it("offers neither Approve nor Save to a role that may not", () => {
    mountEditor({}, { can: { update: false, approve: false, unapprove: false, sendTest: false } });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send a test" })).toBeNull();
  });

  it("shows the results of a sent issue", () => {
    mountEditor({
      status: "sent",
      sent_at: "2026-09-22T14:00:00Z",
      metrics: { delivered: 1200, opened: 540 },
    });
    const results = within(screen.getByLabelText("Results"));
    expect(results.getByText("Delivered").nextElementSibling?.textContent).toBe("1,200");
    expect(results.getByText("Opened").nextElementSibling?.textContent).toBe("540");
    expect(results.queryByText("Clicked")).toBeNull();
  });
});

describe("PreviewFrame", () => {
  it("draws the issue in a sandboxed frame as wide as the chosen device", () => {
    const onViewport = vi.fn();
    render(
      <PreviewFrame html="<p>Hello</p>" width={390} viewport="phone" onViewport={onViewport} />,
    );
    const frame = screen.getByTitle("Issue preview");
    expect(frame.getAttribute("srcdoc")).toBe("<p>Hello</p>");
    expect(frame.getAttribute("width")).toBe("390");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(button("Phone").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Desktop"));
    expect(onViewport).toHaveBeenCalledWith("desktop");
  });

  it("draws a placeholder, not a frame, until the preview arrives", () => {
    render(<PreviewFrame html={undefined} width={0} viewport="desktop" onViewport={vi.fn()} />);
    expect(screen.queryByTitle("Issue preview")).toBeNull();
  });
});

describe("SubscribersTab", () => {
  const counts: SubscriberCountsView = {
    total: 40,
    confirmed: 30,
    pending: 6,
    unsubscribed: 4,
    interest_only: 5,
    audiences: { "place-notes": 28, "market-ca": 12, "market-ny": 9, "market-fl": 7 },
  };

  it("counts each audience by market", () => {
    render(<SubscribersTab counts={counts} />);
    const audiences = within(screen.getByRole("table", { name: "Subscribers by audience" }));
    expect(audiences.getByRole("row", { name: /California/ }).textContent).toContain("12");
    expect(audiences.getByRole("row", { name: /New York/ }).textContent).toContain("9");
    expect(audiences.getByRole("row", { name: /Florida/ }).textContent).toContain("7");
    expect(audiences.getByRole("row", { name: /all markets/ }).textContent).toContain("28");
    const states = within(screen.getByRole("table", { name: "Subscribers by state" }));
    expect(states.getByRole("row", { name: /Confirmed/ }).textContent).toContain("30");
  });

  it("offers the CSV only when it is given an address for it", () => {
    const { rerender } = render(<SubscribersTab counts={counts} />);
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    rerender(
      <SubscribersTab counts={counts} exportHref="/api/admin/newsletter/subscribers/export" />,
    );
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toBe(
      "/api/admin/newsletter/subscribers/export",
    );
  });

  it("shows a zero for every group when nobody has signed up", () => {
    render(
      <SubscribersTab
        counts={{
          total: 0,
          confirmed: 0,
          pending: 0,
          unsubscribed: 0,
          interest_only: 0,
          audiences: { "place-notes": 0, "market-ca": 0, "market-ny": 0, "market-fl": 0 },
        }}
      />,
    );
    const cells = within(
      screen.getByRole("table", { name: "Subscribers by audience" }),
    ).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["0", "0", "0", "0"]);
  });
});
