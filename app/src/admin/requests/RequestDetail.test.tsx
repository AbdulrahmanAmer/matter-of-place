import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SubmissionDetail,
  SubmissionNote,
  TimelineEntry,
} from "../../domain/admin-submissions";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { ToastProvider } from "../ui/Toast";
import { NotesPanel } from "./NotesPanel";
import { PhotoStrip } from "./PhotoStrip";
import { RequestDetail } from "./RequestDetail";
import { SubmittedFields } from "./SubmittedFields";

const ID = "00000000-0000-4000-8000-0000000000c1";
const PHOTO = "00000000-0000-4000-8000-0000000000d1";
const PHOTO_B = "00000000-0000-4000-8000-0000000000d2";

const detail = (overrides: Partial<SubmissionDetail> = {}): SubmissionDetail => ({
  id: ID,
  received_at: "2026-10-01T12:00:00Z",
  workflow_state: "Submitted",
  accepted_at: null,
  decline_note: null,
  duplicate_of: null,
  address: "12 Fixture Lane",
  city: "Montecito",
  state: "California",
  zip: "93108",
  property_type: "Residence",
  price: 4_500_000,
  currency: "USD",
  beds: 5,
  baths: 4.5,
  interior_sq_ft: 4320,
  year_built: null,
  year_renovated: null,
  architect: null,
  designer: null,
  package: "The Feature",
  media_budget: null,
  contact_id: null,
  submitter_kind: "agent",
  submitter_name: "Ana Fixture",
  submitter_email: "ana@example.test",
  submitter_phone: null,
  brokerage: "Fixture Brokerage",
  listed_with_agent: null,
  listing_agent_name: null,
  listing_agent_brokerage: null,
  listing_url: "https://listing.example.test/12",
  source_url: "javascript:alert(1)",
  photography_url: null,
  video_url: null,
  story: "A house on a hill.",
  significance: "Built for the view.",
  property_id: null,
  payment_id: null,
  notes: [],
  media: [
    {
      id: PHOTO,
      name: "front.jpg",
      mime: "image/jpeg",
      bytes: 1000,
      sort_order: 1,
      uploaded_at: "2026-10-01T12:05:00Z",
      thumb_url: "https://signed.test/front.thumb.jpg",
    },
    {
      id: PHOTO_B,
      name: "heic.heic",
      mime: "image/heic",
      bytes: 1000,
      sort_order: 2,
      uploaded_at: "2026-10-01T12:06:00Z",
      thumb_url: null,
    },
  ],
  ...overrides,
});

const note = (text: string, id: string): SubmissionNote => ({
  id,
  text,
  actor_id: "00000000-0000-4000-8000-000000000001",
  actor_kind: "human",
  at: "2026-10-01T13:00:00Z",
});

describe("SubmittedFields", () => {
  it("groups what was submitted and leaves out what was not", () => {
    render(<SubmittedFields detail={detail()} />);
    const people = within(screen.getByRole("region", { name: "People" }));
    expect({
      groups: screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
      price: within(screen.getByRole("region", { name: "Property" })).getByText("$4,500,000"),
      phone: people.queryByText("Phone"),
      brokerage: people.getByText("Fixture Brokerage").textContent,
    }).toMatchObject({
      groups: ["Property", "People", "Links", "Story", "Significance"],
      phone: null,
      brokerage: "Fixture Brokerage",
    });
  });

  it("links the person while there is a contact, and the property otherwise", () => {
    const contact = "00000000-0000-4000-8000-0000000000aa";
    const property = "00000000-0000-4000-8000-0000000000bb";
    const withContact = render(
      <SubmittedFields detail={detail({ contact_id: contact, property_id: property })} />,
    );
    const person = screen.getByRole("link", { name: "Open person" }).getAttribute("href");
    const propertyLink = screen.queryByRole("link", { name: "Open property" });
    withContact.unmount();
    render(<SubmittedFields detail={detail({ property_id: property })} />);
    expect({
      person,
      propertyWithContact: propertyLink,
      property: screen.getByRole("link", { name: "Open property" }).getAttribute("href"),
    }).toEqual({
      person: `/admin/people/${contact}`,
      propertyWithContact: null,
      property: `/admin/properties/${property}`,
    });
  });

  it("opens only web addresses, so a script address stays plain text", () => {
    render(<SubmittedFields detail={detail()} />);
    const links = within(screen.getByRole("region", { name: "Links" }));
    expect({
      listing: links.getByRole("link").getAttribute("href"),
      script: links.queryAllByRole("link").length,
      text: links.getByText("javascript:alert(1)").tagName,
    }).toEqual({ listing: "https://listing.example.test/12", script: 1, text: "DD" });
  });

  it("asks an owner about the agent they list with", () => {
    render(
      <SubmittedFields
        detail={detail({
          submitter_kind: "owner",
          brokerage: null,
          listed_with_agent: true,
          listing_agent_name: "Lee Agent",
          listing_agent_brokerage: "Agent House",
        })}
      />,
    );
    const people = within(screen.getByRole("region", { name: "People" }));
    expect([
      people.getByText("Listed with an agent").nextSibling?.textContent,
      people.getByText("Lee Agent").textContent,
      people.queryByText("Brokerage"),
    ]).toEqual(["Yes", "Lee Agent", null]);
  });
});

describe("PhotoStrip", () => {
  it("shows a placeholder where the thumbnail is null, and asks for no original until it is pressed", () => {
    const onOpen = vi.fn();
    render(<PhotoStrip photos={detail().media} opening={null} onOpen={onOpen} />);
    const before = onOpen.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Open original" })[1] ?? document.body);
    expect({
      images: screen
        .getAllByRole("img")
        .map((image) => image.getAttribute("aria-label") ?? image.getAttribute("alt")),
      before,
      opened: onOpen.mock.calls,
    }).toEqual({
      images: ["Photograph 1 of 2", "No preview"],
      before: 0,
      opened: [[PHOTO_B]],
    });
  });
});

describe("NotesPanel", () => {
  const panel = (canNote: boolean, onAdd = vi.fn(() => Promise.resolve(true))) => (
    <NotesPanel
      notes={[note("First", "n1"), note("Second", "n2")]}
      marketSlug="california"
      canNote={canNote}
      pending={false}
      error={null}
      onAdd={onAdd}
    />
  );

  it("lists the notes newest first", () => {
    render(panel(false));
    expect(screen.getAllByText(/^(First|Second)$/).map((item) => item.textContent)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("has no form for an actor who may not note", () => {
    render(panel(false));
    expect(screen.queryByLabelText("Add a note")).toBeNull();
  });

  it("sends the words typed and clears the field once the note is kept", async () => {
    const onAdd = vi.fn(() => Promise.resolve(true));
    render(panel(true, onAdd));
    const field = screen.getByLabelText("Add a note");
    fireEvent.change(field, { target: { value: "Call the agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => {
      expect(field).toHaveProperty("value", "");
    });
    expect(onAdd.mock.calls).toEqual([["Call the agent"]]);
  });
});

const me = (actions: string[]): AdminMe => ({
  actor: { id: "u1" },
  kind: "human",
  roles: ["managing_editor"],
  scopes: [],
  actions,
  environment: "production",
});

function mount(actions: string[], page: ReactNode = <RequestDetail id={ID} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminMeContext value={me(actions)}>
        <ToastProvider>{page}</ToastProvider>
      </AdminMeContext>
    </QueryClientProvider>,
  );
}

const history: TimelineEntry[] = [
  {
    source: "audit",
    id: "audit-1",
    at: "2026-10-01T14:00:00Z",
    action: "submissions.note",
    actor_id: "00000000-0000-4000-8000-000000000001",
    actor_kind: "human",
    note: null,
    job_type: null,
  },
];

const DETAIL_PATH = `/api/admin/submissions/${ID}`;

/** Answers the paths of screen 4 from `answers`, records each request as `METHOD path body`, refuses the rest. */
function serve(answers: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    [`GET ${DETAIL_PATH}`]: detail(),
    [`GET ${DETAIL_PATH}/timeline`]: { items: history },
    ...answers,
  };
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    requested.push(typeof init.body === "string" ? `${key} ${init.body}` : key);
    const body = table[key];
    return Promise.resolve(
      body === undefined ? new Response("{}", { status: 404 }) : Response.json(body),
    );
  });
  return requested;
}

describe("RequestDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the address and state, the photographs, the notes box and the history", async () => {
    serve();
    mount(["submissions.note", "submissions.start_review"]);
    expect(await screen.findByRole("heading", { level: 1, name: "12 Fixture Lane" })).toBeTruthy();
    expect({
      state: within(screen.getByRole("region", { name: "Status" })).getByText("Submitted").tagName,
      photos: screen.getAllByRole("img").length,
      note: screen.queryByLabelText("Add a note") === null,
      history: (await screen.findByText("Note added")).tagName,
    }).toEqual({ state: "SPAN", photos: 2, note: false, history: "P" });
  });

  it("starts the review of this request alone", async () => {
    const requested = serve({ "POST /api/admin/submissions/start-review": { started: 1 } });
    mount(["submissions.start_review"]);
    fireEvent.click(await screen.findByRole("button", { name: "Start review" }));
    await waitFor(() => {
      expect(requested.some((line) => line.startsWith("POST"))).toBe(true);
    });
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
      `POST /api/admin/submissions/start-review {"ids":["${ID}"]}`,
    ]);
  });

  it("offers no Start review to an actor without the action", async () => {
    serve();
    mount(["submissions.note"]);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  });

  it("hides Start review once the request is under review", async () => {
    serve({ [`GET ${DETAIL_PATH}`]: detail({ workflow_state: "Under Review" }) });
    mount(["submissions.start_review"]);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  });

  it("opens an original only after the button is pressed, in a new tab", async () => {
    const requested = serve({
      [`GET ${DETAIL_PATH}/media/${PHOTO}/original`]: { url: "https://signed.test/front.jpg" },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mount([]);
    const buttons = await screen.findAllByRole("button", { name: "Open original" });
    const before = requested.filter((line) => line.includes("/original"));
    fireEvent.click(buttons[0] ?? document.body);
    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
    expect({
      before,
      asked: requested.filter((line) => line.includes("/original")),
      opened: open.mock.calls,
    }).toEqual({
      before: [],
      asked: [`GET ${DETAIL_PATH}/media/${PHOTO}/original`],
      opened: [["https://signed.test/front.jpg", "_blank", "noopener,noreferrer"]],
    });
  });
});
