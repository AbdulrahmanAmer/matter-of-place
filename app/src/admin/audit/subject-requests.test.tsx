import { Outlet } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { SubjectRequestRow } from "../../domain/admin-audit";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { AuditPage } from "./AuditPage";
import { SubjectRequestsTab } from "./SubjectRequestsTab";

// Screen 25's data requests tab (B7 step 15a, invariant 15): the 45 day clock, identity first, then the one
// fulfilling action of each kind, every button for admins only.

const LIST = "/api/admin/audit/subject-requests";
const ADMIN_ACTIONS = [
  "audit.subject_requests",
  "audit.subject_status",
  "audit.subject_export",
  "audit.subject_delete",
  "audit.subject_opt_out",
];
const KINDS = ["access", "deletion", "opt_out", "correction"] as const;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = (n: number, over: Partial<SubjectRequestRow> = {}): SubjectRequestRow => ({
  id: id(n),
  email: `person${String(n)}@example.invalid`,
  kind: "access",
  note: null,
  status: "verifying",
  received_at: "2026-09-01T12:00:00+00:00",
  due_at: "2026-10-16T12:00:00+00:00",
  verified_at: null,
  fulfilled_at: null,
  handled_by: null,
  days_left: 30,
  ...over,
});

function mount(rows: SubjectRequestRow[], actions = ADMIN_ACTIONS) {
  const requested = serve({ [`GET ${LIST}`]: { items: rows, next_cursor: null } });
  render(
    <AdminProviders actions={actions}>
      <SubjectRequestsTab />
    </AdminProviders>,
  );
  return requested;
}

/** The buttons of the row that names `email`. */
function buttonsOf(email: string): string[] {
  const line = screen.getByText(email).closest("tr");
  if (line === null) throw new Error(`no row for ${email}`);
  return within(line)
    .queryAllByRole("button")
    .map((button) => button.textContent);
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("screen 25, data requests", () => {
  it("offers Export only for access, Delete only for deletion, Opt out only for opt_out and Mark corrected only for correction, each only once identity is confirmed", async () => {
    const rows = KINDS.flatMap((kind, index) => [
      row(index * 2 + 1, { kind }),
      row(index * 2 + 2, { kind, verified_at: "2026-09-02T12:00:00+00:00" }),
    ]);
    mount(rows);
    await screen.findByText(rows[0]?.email ?? "");
    expect(Object.fromEntries(rows.map((line) => [line.email, buttonsOf(line.email)]))).toEqual({
      "person1@example.invalid": ["Identity confirmed", "Reject"],
      "person2@example.invalid": ["Export", "Reject"],
      "person3@example.invalid": ["Identity confirmed", "Reject"],
      "person4@example.invalid": ["Delete", "Reject"],
      "person5@example.invalid": ["Identity confirmed", "Reject"],
      "person6@example.invalid": ["Opt out", "Reject"],
      "person7@example.invalid": ["Identity confirmed", "Reject"],
      "person8@example.invalid": ["Mark corrected", "Reject"],
    });
  });

  it("starts verification on a received request, offers nothing on a closed one, and shows nothing to a chief editor", async () => {
    mount([
      row(1, { status: "received" }),
      row(2, { status: "fulfilled", verified_at: "2026-09-02T12:00:00+00:00" }),
    ]);
    await screen.findByText("person1@example.invalid");
    const admin = {
      received: buttonsOf("person1@example.invalid"),
      closed: buttonsOf("person2@example.invalid"),
    };
    vi.unstubAllGlobals();
    cleanup();
    mount([row(1, { status: "received" })], ["audit.subject_requests"]);
    await screen.findByText("person1@example.invalid");
    expect({ admin, editor: buttonsOf("person1@example.invalid") }).toEqual({
      admin: { received: ["Start verification", "Reject"], closed: [] },
      editor: [],
    });
  });

  it("shows a request with 5 days left in red and one with 30 in the plain tone", async () => {
    mount([row(1, { days_left: 5 }), row(2, { days_left: 30 })]);
    await screen.findByText("person1@example.invalid");
    const pill = (email: string) => {
      const line = screen.getByText(email).closest("tr");
      const found = line?.querySelector(".admin-pill");
      return `${found?.textContent ?? ""} ${found?.getAttribute("data-tone") ?? ""}`;
    };
    expect([pill("person1@example.invalid"), pill("person2@example.invalid")]).toEqual([
      "5 danger",
      "30 neutral",
    ]);
  });

  it("Export posts once and saves the bundle as a JSON file", async () => {
    const saved: Blob[] = [];
    // jsdom has no object URLs; the browser hands one to the download link.
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        saved.push(blob);
        return "blob:bundle";
      },
      revokeObjectURL: () => undefined,
    });
    const verified = row(2, { verified_at: "2026-09-02T12:00:00+00:00" });
    const bundle = {
      request: { id: verified.id, kind: "access", received_at: verified.received_at },
      email: verified.email,
      subscribers: [],
      inquiries: [],
      contacts: [],
      submissions: [],
      inbound_mail: [],
      social_inbox: [],
    };
    const requested = serve({
      [`GET ${LIST}`]: { items: [verified], next_cursor: null },
      [`POST ${LIST}/${verified.id}/export`]: bundle,
    });
    render(
      <AdminProviders actions={ADMIN_ACTIONS}>
        <SubjectRequestsTab />
      </AdminProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export this person's data" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect({
      posts: requested.filter((line) => line.startsWith("POST ")),
      file: JSON.parse(await (saved[0] ?? new Blob()).text()) as unknown,
    }).toEqual({ posts: [`POST ${LIST}/${verified.id}/export {}`], file: bundle });
  });

  it("Export sends the Instagram handle the person named, so its comments and messages join the file (W8 item 4 round 3)", async () => {
    Object.assign(URL, { createObjectURL: () => "blob:bundle", revokeObjectURL: () => undefined });
    const verified = row(2, { verified_at: "2026-09-02T12:00:00+00:00" });
    const requested = serve({
      [`GET ${LIST}`]: { items: [verified], next_cursor: null },
      [`POST ${LIST}/${verified.id}/export`]: {
        request: { id: verified.id, kind: "access", received_at: verified.received_at },
        email: verified.email,
        subscribers: [],
        inquiries: [],
        contacts: [],
        submissions: [],
        inbound_mail: [],
        social_inbox: [{ graph_id: "c1" }],
      },
    });
    render(
      <AdminProviders actions={ADMIN_ACTIONS}>
        <SubjectRequestsTab />
      </AdminProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export this person's data" });
    fireEvent.change(within(dialog).getByLabelText("Instagram handle"), {
      target: { value: "@reader.one" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    const posts = () => requested.filter((line) => line.startsWith("POST "));
    await waitFor(() => {
      expect(posts()).toHaveLength(1);
    });
    expect(posts()).toEqual([
      `POST ${LIST}/${verified.id}/export ${JSON.stringify({ instagram_handle: "@reader.one" })}`,
    ]);
  });

  it("Delete sends the Instagram handle the person named, refuses one that is not a handle, and sends none when empty", async () => {
    const line = row(4, { kind: "deletion", verified_at: "2026-09-02T12:00:00+00:00" });
    const answer = { id: line.id, status: "fulfilled", counts: { social_inbox: 2 } };
    const requested = serve({
      [`GET ${LIST}`]: { items: [line], next_cursor: null },
      [`POST ${LIST}/${line.id}/delete`]: answer,
    });
    render(
      <AdminProviders actions={ADMIN_ACTIONS}>
        <SubjectRequestsTab />
      </AdminProviders>,
    );
    const posts = () => requested.filter((entry) => entry.startsWith("POST "));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    let dialog = await screen.findByRole("dialog", { name: "Delete this person's data" });
    fireEvent.change(within(dialog).getByLabelText("Instagram handle"), {
      target: { value: "not a handle!" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    const refused = {
      error:
        within(dialog).queryByText("Enter an Instagram handle, or leave it empty.")?.textContent ??
        null,
      posts: posts(),
    };
    expect(refused).toEqual({ error: "Enter an Instagram handle, or leave it empty.", posts: [] });
    fireEvent.change(within(dialog).getByLabelText("Instagram handle"), {
      target: { value: " @reader.one " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(posts()).toHaveLength(1);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    dialog = await screen.findByRole("dialog", { name: "Delete this person's data" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(posts()).toHaveLength(2);
    });
    expect({ refused, posts: posts() }).toEqual({
      refused: { error: "Enter an Instagram handle, or leave it empty.", posts: [] },
      posts: [
        `POST ${LIST}/${line.id}/delete ${JSON.stringify({ instagram_handle: "@reader.one" })}`,
        `POST ${LIST}/${line.id}/delete {}`,
      ],
    });
  });

  it("tells staff how a person proves a handle: a message from it holding the request's reference (W8 item 4 round 4)", async () => {
    const line = row(4, {
      id: "4a3c2563-0000-4000-8000-000000000004",
      kind: "deletion",
      verified_at: "2026-09-02T12:00:00+00:00",
    });
    mount([line]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this person's data" });
    expect(within(dialog).queryByText(/that holds 4a3c2563\./)?.textContent).toBe(
      "Optional. A handle counts once the person sends us an Instagram message from it, after this request, that holds 4a3c2563. Its comments and messages are then deleted too, with any line held for Matter about them.",
    );
  });

  it("Reject asks for a note and sends nothing without one", async () => {
    const line = row(1);
    const requested = serve({
      [`GET ${LIST}`]: { items: [line], next_cursor: null },
      [`POST ${LIST}/${line.id}/status`]: {
        id: line.id,
        status: "rejected",
        verified_at: null,
        fulfilled_at: null,
        handled_by: null,
      },
    });
    render(
      <AdminProviders actions={ADMIN_ACTIONS}>
        <SubjectRequestsTab />
      </AdminProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject this request" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    const refused = {
      error: within(dialog).getByText("Add a note.").textContent,
      posts: requested.filter((entry) => entry.startsWith("POST ")),
    };
    fireEvent.change(within(dialog).getByLabelText("Note"), {
      target: { value: "No reply from the address." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(requested.filter((entry) => entry.startsWith("POST "))).toHaveLength(1);
    });
    expect({ refused, posts: requested.filter((entry) => entry.startsWith("POST ")) }).toEqual({
      refused: { error: "Add a note.", posts: [] },
      posts: [
        `POST ${LIST}/${line.id}/status ${JSON.stringify({ action: "reject", note: "No reply from the address." })}`,
      ],
    });
  });

  it("is the second tab of screen 25, which opens on the audit log", async () => {
    const requested = serve({
      ["GET /api/admin/audit"]: { items: [], next_cursor: null },
      [`GET ${LIST}`]: { items: [row(1)], next_cursor: null },
    });
    mountRoutes(
      () => (
        <AdminProviders actions={ADMIN_ACTIONS}>
          <Outlet />
        </AdminProviders>
      ),
      "/admin/audit/",
      (root) => [pageRoute(root, "/admin/audit/", () => <AuditPage />)],
    );
    const tab = await screen.findByRole("tab", { name: "Data requests" });
    const before = [...requested];
    fireEvent.click(tab);
    await screen.findByText("person1@example.invalid");
    expect({ before, after: requested }).toEqual({
      before: ["GET /api/admin/audit"],
      after: ["GET /api/admin/audit", `GET ${LIST}`],
    });
  });
});
