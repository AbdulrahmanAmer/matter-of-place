import { Outlet } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { InquiryDetail, InquiryRow } from "../../domain/admin-inquiries";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { InquiriesPage } from "./InquiriesPage";
import { InquiriesTable } from "./InquiriesTable";
import { InquiryDrawer } from "./InquiryDrawer";

const INQUIRY = "00000000-0000-4000-8000-0000000000f1";
const OTHER = "00000000-0000-4000-8000-0000000000f4";
const EDITOR = "00000000-0000-4000-8000-0000000000f2";
const JOB = "00000000-0000-4000-8000-0000000000f3";

const editorActions = [
  "inquiries.list",
  "inquiries.get",
  "inquiries.assignees",
  "inquiries.assign",
  "inquiries.forward",
  "inquiries.close",
];
const readerActions = ["inquiries.list", "inquiries.get", "inquiries.assignees"];

const row = (over: Partial<InquiryRow> = {}): InquiryRow => ({
  id: INQUIRY,
  intent: "showing",
  topic: null,
  subject_kind: "property",
  subject_slug: "montecito-1a2b3c4d",
  subject_title: "A House on the Hill",
  name: "Ana Fixture",
  email: "ana@example.test",
  phone: "+1 805 555 0100",
  location: "Santa Barbara",
  message: "May we see it on Saturday?",
  details: { party: 2 },
  source_path: "/property/montecito-1a2b3c4d",
  state: "new",
  received_at: "2026-10-06T16:00:00Z",
  forwarded_at: null,
  assigned_to: null,
  anonymised_at: null,
  ...over,
});

const detail = (over: Partial<InquiryDetail> = {}): InquiryDetail => ({
  ...row(),
  forward_available: true,
  ...over,
});

const anonymised = {
  name: "",
  email: "0f1e@anonymised.invalid",
  phone: null,
  location: null,
  message: "",
  details: {},
  anonymised_at: "2026-10-07T00:00:00Z",
};

const PATH = `/api/admin/inquiries/${INQUIRY}`;
const ASSIGNEES = "/api/admin/inquiries/assignees";
const editors = { items: [{ id: EDITOR, name: "Bea Editor" }] };

function openDrawer(actions: string[], answers: Record<string, unknown>) {
  const requested = serve(answers);
  render(
    <AdminProviders actions={actions}>
      <InquiryDrawer id={INQUIRY} assignees={editors.items} onClose={() => undefined} />
    </AdminProviders>,
  );
  return requested;
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InquiriesPage", () => {
  it("opened at /admin/inquiries?id=<uuid> shows InquiryDrawer on that inquiry, read by its own GET", async () => {
    const requested = serve({
      "GET /api/admin/inquiries": {
        items: [row({ id: OTHER, intent: "general", subject_title: null })],
        next_cursor: null,
        forward_available: true,
      },
      [`GET ${ASSIGNEES}`]: editors,
      [`GET ${PATH}`]: detail(),
    });
    mountRoutes(
      () => (
        <AdminProviders actions={editorActions}>
          <Outlet />
        </AdminProviders>
      ),
      `/admin/inquiries/?id=${INQUIRY}`,
      (root) => [pageRoute(root, "/admin/inquiries/", () => <InquiriesPage />)],
    );
    const drawer = await screen.findByRole("dialog", { name: "Showing" });
    await within(drawer).findByText("May we see it on Saturday?");
    expect({
      table: screen.getAllByRole("table", { name: "Inquiries" }).length,
      read: requested.includes(`GET ${PATH}`),
      property: within(drawer).getAllByText("A House on the Hill").length,
    }).toEqual({ table: 1, read: true, property: 1 });
  });
});

describe("InquiryDrawer", () => {
  it("disables Forward with a note while forward_available is false, and enables it once it is true", async () => {
    openDrawer(editorActions, { [`GET ${PATH}`]: detail({ forward_available: false }) });
    const off = await screen.findByRole("button", { name: "Forward to Omnikom" });
    const note = screen.queryByText("Forwarding to Omnikom is not switched on yet.");
    vi.unstubAllGlobals();
    cleanup();
    openDrawer(editorActions, { [`GET ${PATH}`]: detail() });
    const on = await screen.findByRole("button", { name: "Forward to Omnikom" });
    expect({
      off: off.hasAttribute("disabled"),
      note: note !== null,
      on: on.hasAttribute("disabled"),
    }).toEqual({ off: true, note: true, on: false });
  });

  it("an anonymised inquiry shows Anonymised and no contact fields, message or details", async () => {
    openDrawer(editorActions, { [`GET ${PATH}`]: detail(anonymised) });
    const drawer = await screen.findByRole("dialog", { name: "Showing" });
    await within(drawer).findByText("Anonymised");
    const terms = within(drawer)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect({
      terms,
      email: within(drawer).queryByText(anonymised.email),
      message: within(drawer).queryByRole("heading", { name: "Message" }),
      forward: within(drawer)
        .getByRole("button", { name: "Forward to Omnikom" })
        .hasAttribute("disabled"),
    }).toEqual({
      terms: ["Property", "Received", "Assigned", "Source page"],
      email: null,
      message: null,
      forward: true,
    });
  });

  it("shows no Assign, Forward or Close to a reader (commercial is read-only, S26)", async () => {
    openDrawer(readerActions, { [`GET ${PATH}`]: detail() });
    await screen.findByText("May we see it on Saturday?");
    expect(
      ["Assign", "Forward to Omnikom", "Close inquiry"].map((name) =>
        screen.queryByRole("button", { name }),
      ),
    ).toEqual([null, null, null]);
  });

  it("Forward posts once, then follows the job until it ends skipped while Omnikom has no address", async () => {
    const requested = openDrawer(editorActions, {
      [`GET ${PATH}`]: detail(),
      [`POST ${PATH}/forward`]: { job_id: JOB },
      [`GET /api/admin/jobs/${JOB}`]: {
        id: JOB,
        type: "webhook_omnikom",
        status: "done",
        attempts: 1,
        max_attempts: 5,
        run_after: "2026-10-08T12:00:00Z",
        run_local: false,
        payload: { params: {}, data: { inquiry_id: INQUIRY } },
        result: { skipped: "not_configured" },
        error: null,
        idempotency_key: `webhook_omnikom:${INQUIRY}:1`,
        created_at: "2026-10-08T12:00:00Z",
        finished_at: "2026-10-08T12:00:01Z",
        events: [],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Forward to Omnikom" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await screen.findByText("Not sent: Omnikom has no address yet, so the inquiry stays as it is.");
    const watched = within(screen.getByRole("list", { name: "Jobs started" }));
    expect({
      posts: requested.filter((line) => line.startsWith("POST")),
      status: watched.getAllByText("Done").length,
    }).toEqual({ posts: [`POST ${PATH}/forward`], status: 1 });
  });

  it("Assign posts the chosen editor", async () => {
    const requested = openDrawer(editorActions, {
      [`GET ${PATH}`]: detail(),
      [`POST ${PATH}/assign`]: { state: "in_progress" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Assign" }));
    const dialog = screen.getByRole("dialog", { name: "Assign this inquiry" });
    fireEvent.change(within(dialog).getByLabelText("Editor"), { target: { value: EDITOR } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() => {
      expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
        `POST ${PATH}/assign ${JSON.stringify({ assignee: EDITOR })}`,
      ]);
    });
  });
});

describe("InquiriesTable", () => {
  it("shows Anonymised in place of the name and email of an anonymised row", () => {
    render(
      <InquiriesTable
        rows={[row(anonymised)]}
        filters={{ values: {}, onChange: () => undefined }}
        assigneeName={() => "Bea Editor"}
      />,
    );
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual([
      "Showing",
      "A House on the Hill",
      "Anonymised",
      "Anonymised",
      cells[4],
      "New",
      "No one",
    ]);
  });
});
