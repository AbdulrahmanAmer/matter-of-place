import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { ToastProvider } from "../ui/Toast";
import { InvoiceDetail } from "./InvoiceDetail";
import { InvoiceDraft } from "./InvoiceDraft";
import { InvoiceForm } from "./InvoiceForm";
import type { Payment } from "./payments-api";
import { VoidDialog } from "./VoidDialog";

// jsdom has no showModal or close on <dialog>; these stand in for the browser's, which only toggle `open`.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

const ID = "00000000-0000-4000-8000-0000000000a1";
const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";
const PROPERTY = "00000000-0000-4000-8000-0000000000e1";
const PAYMENT_PATH = `/api/admin/payments/${ID}`;
const REQUEST_PATH = `/api/admin/submissions/${SUBMISSION}`;

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: ID,
  submission_id: SUBMISSION,
  property_id: null,
  product: "The Feature",
  amount: 295,
  status: "due",
  invoice_number: "MOP-2026-0007",
  invoice_file_key: "2026/MOP-2026-0007.pdf",
  invoice_snapshot: {
    invoice_number: "MOP-2026-0007",
    issue_date: "2026-10-07",
    due_date: "2026-10-21",
    entity: "Example Media LLC",
    address: "100 Example Street, New York, NY 10001",
    contact: { email: "hello@example.invalid", phone: null },
    description: "The Feature. One property, one editorial feature.",
    amount: 295,
    currency: "USD",
    tax_line: "No sales tax is charged on this invoice.",
    instructions: [
      { id: "bank_transfer", label: "Bank transfer", instructions: "Account 000 at Example Bank." },
    ],
    preferred_method: "bank_transfer",
    terms: "Payable within 14 days of the invoice date.",
    late_terms: "Overdue amounts may be subject to a late charge.",
    billing_email: "billing@matterofplace.com",
    bill_to: {
      name: "Avery Stone",
      email: "avery@example.invalid",
      brokerage: null,
      property: "12 Elm Street, Brooklyn, NY 11201",
    },
  },
  preferred_method: "bank_transfer",
  issued_at: "2026-10-07T12:00:00Z",
  due_at: "2026-10-21T12:00:00Z",
  paid_at: null,
  paid_method: null,
  paid_reference: null,
  notes: null,
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  id: SUBMISSION,
  received_at: "2026-10-01T12:00:00Z",
  workflow_state: "Accepted",
  accepted_at: "2026-10-02T12:00:00Z",
  decline_note: null,
  duplicate_of: null,
  address: "88 Harbour Row",
  city: "Sarasota",
  state: "Florida",
  zip: "34236",
  property_type: "Residence",
  price: 2_750_000,
  currency: "USD",
  beds: 3,
  baths: 2.5,
  interior_sq_ft: 2100,
  year_built: 1998,
  year_renovated: 2019,
  architect: "Ada Reed",
  designer: null,
  package: "The Feature",
  media_budget: null,
  contact_id: null,
  submitter_kind: "owner",
  submitter_name: "Noor Example",
  submitter_email: "noor@example.test",
  submitter_phone: "+1 941 555 0100",
  brokerage: null,
  listed_with_agent: false,
  listing_agent_name: null,
  listing_agent_brokerage: null,
  listing_url: null,
  source_url: null,
  photography_url: null,
  video_url: null,
  story: "A house on the water.",
  significance: "Rebuilt around its courtyard.",
  property_id: null,
  payment_id: null,
  notes: [],
  media: [],
  ...overrides,
});

const me = (actions: string[]): AdminMe => ({
  actions,
  actor: { id: "user-invoices" },
  environment: "preview",
  kind: "human",
  roles: ["admin"],
  scopes: [],
});

const MANAGING = ["payments.mark_paid", "payments.waive", "payments.issue", "submissions.activate"];
const ADMIN = [...MANAGING, "payments.void"];

function mount(actions: string[], page: ReactNode) {
  const shell = (
    <AdminMeContext value={me(actions)}>
      <ToastProvider>{page}</ToastProvider>
    </AdminMeContext>
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{shell}</QueryClientProvider>);
}

/** Answers `METHOD path` from `answers` (a `Response` as it is, anything else as JSON), records each request. */
function serve(answers: Record<string, unknown>) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    requested.push(typeof init.body === "string" ? `${key} ${init.body}` : key);
    const body = answers[key];
    return Promise.resolve(
      body instanceof Response
        ? body
        : body === undefined
          ? new Response("{}", { status: 404 })
          : Response.json(body),
    );
  });
  return requested;
}

const written = { payment_id: ID, event_id: "event-1", jobs: [] };

/** Presses Issue, then the confirmation's own Issue. */
function confirmIssue(): void {
  fireEvent.click(screen.getByRole("button", { name: "Issue and email" }));
  const dialog = screen.getByRole("dialog", { name: "Issue and email this invoice" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Issue and email" }));
}

const buttons = () => screen.getAllByRole("button").map((button) => button.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InvoiceDetail states", () => {
  it("shows a due invoice with its preview, the PDF link and every move open to an admin", async () => {
    serve({ [`GET ${PAYMENT_PATH}`]: payment() });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    expect(await screen.findByRole("heading", { level: 1, name: "MOP-2026-0007" })).toBeTruthy();
    expect({
      pill: document.querySelector(".admin-invoice-page__state .admin-pill")?.textContent,
      preview: screen.getByText("Preview. The PDF is the official copy.").tagName,
      pdf: screen.getByRole("link", { name: "Open the PDF" }).getAttribute("href"),
      moves: buttons().filter((name) => name !== "Print preview"),
    }).toEqual({
      pill: "Due",
      preview: "P",
      pdf: `${PAYMENT_PATH}/pdf`,
      moves: ["Mark paid", "Waive", "Void"],
    });
  });

  it("offers Activate on a paid invoice and no payment move", async () => {
    serve({
      [`GET ${PAYMENT_PATH}`]: payment({
        status: "paid",
        paid_at: "2026-10-09T12:00:00Z",
        paid_method: "Bank transfer",
        paid_reference: "REF-1",
      }),
    });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    await screen.findByRole("heading", { level: 1 });
    expect({
      moves: buttons().filter((name) => name !== "Print preview"),
      paid: screen.getByText(/Bank transfer, reference REF-1/).tagName,
    }).toEqual({ moves: ["Activate"], paid: "DD" });
  });

  it("reads No invoice for a waiver without one, says why there is no preview and offers Activate", async () => {
    serve({
      [`GET ${PAYMENT_PATH}`]: payment({
        status: "waived",
        invoice_number: null,
        invoice_file_key: null,
        invoice_snapshot: null,
        notes: "Five Features credit",
      }),
    });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    expect(await screen.findByRole("heading", { level: 1, name: "No invoice" })).toBeTruthy();
    expect({
      empty: screen.getByRole("heading", { name: "No invoice was issued" }).tagName,
      reason: screen.getByText("Five Features credit").tagName,
      moves: buttons(),
      pdf: screen.queryByRole("link", { name: "Open the PDF" }),
    }).toEqual({ empty: "H2", reason: "DD", moves: ["Activate"], pdf: null });
  });

  it("links a void invoice to its corrected one and offers no move on the old one", async () => {
    serve({ [`GET ${PAYMENT_PATH}`]: payment({ status: "void", notes: "Wrong product" }) });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    const link = await screen.findByRole("link", { name: "Issue corrected invoice" });
    expect({
      href: link.getAttribute("href"),
      moves: buttons().filter((name) => name !== "Print preview"),
    }).toEqual({ href: `/admin/invoices/new?submission_id=${SUBMISSION}`, moves: [] });
  });

  it("names an activated invoice and links its property instead of offering Activate", async () => {
    serve({ [`GET ${PAYMENT_PATH}`]: payment({ status: "paid", property_id: PROPERTY }) });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    const link = await screen.findByRole("link", { name: "Open property" });
    expect({
      href: link.getAttribute("href"),
      pill: screen.getByText("Activated").tagName,
      activate: screen.queryByRole("button", { name: "Activate" }),
    }).toEqual({ href: `/admin/properties/${PROPERTY}`, pill: "SPAN", activate: null });
  });

  it("activates after a confirmation and lists the copy job beside the event's jobs", async () => {
    const requested = serve({
      [`GET ${PAYMENT_PATH}`]: payment({ status: "paid" }),
      [`POST ${REQUEST_PATH}/activate`]: {
        property_id: PROPERTY,
        event_id: "event-2",
        jobs: [{ id: "job-1", type: "render_property", status: "queued" }],
        copy_job_id: "job-2",
      },
    });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));
    const dialog = screen.getByRole("dialog", { name: "Activate this request" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
    const jobs = await screen.findByRole("list", { name: "Jobs started" });
    expect({
      jobs: within(jobs)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
      posts: requested.filter((line) => line.startsWith("POST")),
    }).toEqual({
      jobs: ["render propertyQueued", "copy submission mediaQueued"],
      posts: [`POST ${REQUEST_PATH}/activate {}`],
    });
  });
});

describe("the moves on an invoice", () => {
  it("refuses a payment date in the future and sends a day that has begun", async () => {
    const requested = serve({
      [`GET ${PAYMENT_PATH}`]: payment(),
      [`POST ${PAYMENT_PATH}/mark-paid`]: written,
    });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
    const dialog = screen.getByRole("dialog", { name: "Mark this invoice paid" });
    const submit = within(dialog).getByRole("button", { name: "Mark paid" });
    fireEvent.change(within(dialog).getByLabelText("Method"), { target: { value: "Wire" } });
    fireEvent.change(within(dialog).getByLabelText("Date received"), {
      target: { value: "2999-01-01" },
    });
    expect({
      refusal: within(dialog).getByRole("alert").textContent,
      disabled: submit.hasAttribute("disabled"),
    }).toEqual({ refusal: "The payment date cannot be in the future.", disabled: true });
    fireEvent.change(within(dialog).getByLabelText("Date received"), {
      target: { value: "2026-10-01" },
    });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(requested.some((line) => line.startsWith("POST"))).toBe(true);
    });
    const [post] = requested.filter((line) => line.startsWith("POST"));
    expect(post).toBe(
      `POST ${PAYMENT_PATH}/mark-paid {"paidAt":"2026-10-01T16:00:00.000Z","method":"Wire"}`,
    );
  });

  it("waives with a reason", async () => {
    const requested = serve({
      [`GET ${PAYMENT_PATH}`]: payment(),
      [`POST ${PAYMENT_PATH}/waive`]: written,
    });
    mount(ADMIN, <InvoiceDetail id={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Waive" }));
    const dialog = screen.getByRole("dialog", { name: "Waive this invoice" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Credit holder" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Waive" }));
    await waitFor(() => {
      expect(requested.some((line) => line.startsWith("POST"))).toBe(true);
    });
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
      `POST ${PAYMENT_PATH}/waive {"reason":"Credit holder"}`,
    ]);
  });
});

describe("VoidDialog", () => {
  it("is hidden for a managing editor and shown for an admin", () => {
    const view = mount(MANAGING, <VoidDialog onVoid={() => Promise.resolve()} />);
    const editor = screen.queryByRole("button", { name: "Void" });
    view.unmount();
    mount(ADMIN, <VoidDialog onVoid={() => Promise.resolve()} />);
    expect({ editor, admin: screen.getByRole("button", { name: "Void" }).tagName }).toEqual({
      editor: null,
      admin: "BUTTON",
    });
  });

  it("keeps its submit off below 3 characters and sends the trimmed reason", async () => {
    const onVoid = vi.fn(() => Promise.resolve());
    mount(ADMIN, <VoidDialog onVoid={onVoid} />);
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    const dialog = screen.getByRole("dialog", { name: "Void this invoice" });
    const submit = within(dialog).getByRole("button", { name: "Void invoice" });
    const reason = within(dialog).getByLabelText("Reason");
    fireEvent.change(reason, { target: { value: " ab " } });
    const short = submit.hasAttribute("disabled");
    fireEvent.change(reason, { target: { value: " abc " } });
    const enough = submit.hasAttribute("disabled");
    fireEvent.click(submit);
    await waitFor(() => {
      expect(onVoid).toHaveBeenCalled();
    });
    expect({ short, enough, sent: onVoid.mock.calls }).toEqual({
      short: true,
      enough: false,
      sent: [["abc"]],
    });
  });

  it("stays open with the server's message when the void is refused", async () => {
    mount(ADMIN, <VoidDialog onVoid={() => Promise.reject(new Error("This invoice is paid."))} />);
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    const dialog = screen.getByRole("dialog", { name: "Void this invoice" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Entered twice" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void invoice" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("This invoice is paid.");
  });
});

describe("the draft", () => {
  it("shows Waive without invoice beside Issue", async () => {
    serve({ [`GET ${REQUEST_PATH}`]: request() });
    mount(ADMIN, <InvoiceDraft submissionId={SUBMISSION} />);
    expect(await screen.findByRole("heading", { level: 1, name: "New invoice" })).toBeTruthy();
    const issue = screen.getByRole("button", { name: "Issue and email" });
    const waive = screen.getByRole("button", { name: "Waive without invoice" });
    expect(issue.parentElement).toBe(waive.parentElement);
  });

  it("keeps Issue off until the request is accepted", async () => {
    serve({
      [`GET ${REQUEST_PATH}`]: request({ workflow_state: "Under Review", accepted_at: null }),
    });
    mount(ADMIN, <InvoiceDraft submissionId={SUBMISSION} />);
    await screen.findByRole("heading", { level: 1, name: "New invoice" });
    fireEvent.change(screen.getByLabelText("Preferred payment method"), {
      target: { value: "bank_transfer" },
    });
    expect({
      off: screen.getByRole("button", { name: "Issue and email" }).hasAttribute("disabled"),
      why: screen.getByText("Accept this request before issuing an invoice.").tagName,
    }).toEqual({ off: true, why: "P" });
  });

  it("issues with the product and method only, then names the jobs it started", async () => {
    const requested = serve({
      [`GET ${REQUEST_PATH}`]: request(),
      "POST /api/admin/payments/issue-invoice": {
        ...written,
        jobs: [{ id: "job-1", type: "invoice_pdf", status: "queued" }],
      },
    });
    mount(ADMIN, <InvoiceDraft submissionId={SUBMISSION} />);
    fireEvent.change(await screen.findByLabelText("Preferred payment method"), {
      target: { value: "bank_transfer" },
    });
    confirmIssue();
    const jobs = await screen.findByRole("list", { name: "Jobs started" });
    expect({
      jobs: within(jobs).getAllByRole("listitem").length,
      posts: requested.filter((line) => line.startsWith("POST")),
      open: screen.getByRole("link", { name: "Open it" }).getAttribute("href"),
    }).toEqual({
      jobs: 1,
      posts: [
        `POST /api/admin/payments/issue-invoice {"submissionId":"${SUBMISSION}","product":"The Feature","preferredMethod":"bank_transfer"}`,
      ],
      open: `/admin/invoices/${ID}`,
    });
  });

  it("lists the missing settings and turns Issue off when the server says the invoice is not ready", async () => {
    serve({
      [`GET ${REQUEST_PATH}`]: request(),
      "POST /api/admin/payments/issue-invoice": new Response(
        JSON.stringify({
          error: {
            code: "invoice_not_ready",
            message: "Invoice settings are missing: legal.entity, tax_line.",
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    });
    mount(ADMIN, <InvoiceDraft submissionId={SUBMISSION} />);
    fireEvent.change(await screen.findByLabelText("Preferred payment method"), {
      target: { value: "bank_transfer" },
    });
    confirmIssue();
    const list = await screen.findByRole("region", { name: "Before this invoice can be issued" });
    expect({
      missing: within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
      off: screen.getAllByRole("button", { name: "Issue and email" })[0]?.hasAttribute("disabled"),
    }).toEqual({ missing: ["The legal entity", "The tax line"], off: true });
  });
});

describe("InvoiceForm", () => {
  it("turns Issue off and names every missing setting while the list is not empty", () => {
    mount(
      ADMIN,
      <InvoiceForm
        initialProduct="The Feature"
        canIssue
        missing={["legal.entity", "payment_methods.instructions"]}
        onIssue={() => Promise.resolve()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Preferred payment method"), {
      target: { value: "wire" },
    });
    const items = within(screen.getByRole("region", { name: "Before this invoice can be issued" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect({
      off: screen.getByRole("button", { name: "Issue and email" }).hasAttribute("disabled"),
      items,
    }).toEqual({
      off: true,
      items: ["The legal entity", "Instructions for at least one payment method"],
    });
  });

  it("turns Issue on once the product, the method and the readiness are there", () => {
    mount(
      ADMIN,
      <InvoiceForm
        initialProduct="The Reach"
        canIssue
        missing={[]}
        onIssue={() => Promise.resolve()}
      />,
    );
    const issue = screen.getByRole("button", { name: "Issue and email" });
    const before = issue.hasAttribute("disabled");
    fireEvent.change(screen.getByLabelText("Preferred payment method"), {
      target: { value: "wire" },
    });
    expect({ before, after: issue.hasAttribute("disabled") }).toEqual({
      before: true,
      after: false,
    });
  });
});
