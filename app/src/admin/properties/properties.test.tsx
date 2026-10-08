import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropertyDetail, PropertyListRow } from "../../domain/admin-properties";
import type { SubmissionListRow } from "../../domain/admin-submissions";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { mountRoutes } from "../ui/test-router";
import { ToastProvider } from "../ui/Toast";
import { NewFromRequest } from "./NewFromRequest";
import { PropertiesTable } from "./PropertiesTable";
import { PropertyEditor } from "./PropertyEditor";
import { SequenceTab } from "./SequenceTab";

// Screens 7 and 8 (B7 step 7) in jsdom, with `fetch` stubbed (P-2128).

const ID = "00000000-0000-4000-8000-0000000000b1";
const PATH = `/api/admin/properties/${ID}`;

const detail = (
  version = 3,
  state: PropertyDetail["property"]["editorial_state"] = "review",
): PropertyDetail => ({
  property: {
    id: ID,
    slug: "san-francisco-00000000",
    title: "A House Above the Water",
    market_slug: "california",
    region_slug: "bay-area",
    city: "San Francisco",
    neighborhood: "Sea Cliff",
    state: "California",
    country: "United States",
    address: "1 Fixture Lane",
    price: 4_200_000,
    beds: 4,
    baths: 3.5,
    interior_sq_ft: 3400,
    lot_acres: 0.3,
    year_built: 1931,
    type: "Residence",
    style: "Mediterranean",
    architect: null,
    designer: null,
    status: "Active",
    story: ["One.", "Two."],
    place: "Above the water.",
    representative_id: null,
    presented_by_owner: true,
    listing_url: null,
    hero_rank: null,
    featured_rank: null,
    hero_image: "o/sea-cliff/1-0a1b2c3d.webp",
    campaign_tier: "Feature",
    source: "Submission",
    submission_id: null,
    editorial_state: state,
    published_at: null,
    first_published_at: null,
    taken_down_at: null,
    updated_at: "2026-10-07T12:00:00Z",
    version,
  },
  media: [1, 2, 3, 4, 5, 6].map((n) => ({
    id: `00000000-0000-4000-8000-00000000010${String(n)}`,
    media_key: `o/sea-cliff/${String(n)}-0a1b2c3d.webp`,
    staging_path: null,
    alt: `Room ${String(n)}`,
    orientation: n === 1 ? null : "landscape",
    sort_order: n,
  })),
  features: [],
  related: [],
  representative: null,
  submission: null,
});

const me = (actions: string[]): AdminMe => ({
  actor: { id: "u1" },
  kind: "human",
  roles: ["managing_editor"],
  scopes: [],
  actions,
  environment: "production",
});

const editorActions = ["properties.update", "properties.publish", "properties.preview_token"];

/** Answers each `METHOD path` from `answers` (a function is called with the body), records every request. */
function serve(answers: Record<string, unknown>) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    requested.push(typeof init.body === "string" ? `${key} ${init.body}` : key);
    const answer = answers[key];
    if (answer instanceof Response) return Promise.resolve(answer.clone());
    return Promise.resolve(
      answer === undefined ? new Response("{}", { status: 404 }) : Response.json(answer),
    );
  });
  return requested;
}

function mountEditor(onReload: () => Promise<PropertyDetail>, start = detail()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mountRoutes(
    () => (
      <QueryClientProvider client={client}>
        <AdminMeContext value={me(editorActions)}>
          <ToastProvider>
            <PropertyEditor detail={start} onReload={onReload} />
          </ToastProvider>
        </AdminMeContext>
      </QueryClientProvider>
    ),
    "/",
    () => [],
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PropertyEditor", () => {
  it("a 409 from another session shows Reload, someone saved and keeps the field text", async () => {
    serve({
      [`PATCH ${PATH}`]: Response.json(
        { error: { code: "stale", message: "This changed since you opened it." } },
        { status: 409 },
      ),
    });
    mountEditor(() => Promise.resolve(detail(9)));
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Mine" } });
    expect(await screen.findByText(/Reload, someone saved/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Mine");
  });

  it("Reload lays the unsaved field over the fresh row, and the editor saves it at the fresh version", async () => {
    const answers: Record<string, unknown> = {
      [`PATCH ${PATH}`]: Response.json(
        { error: { code: "stale", message: "Stale." } },
        { status: 409 },
      ),
    };
    const requested = serve(answers);
    mountEditor(() => {
      answers[`PATCH ${PATH}`] = { version: 10 };
      return Promise.resolve(detail(9));
    });
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Mine" } });
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Save my edits" }));
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeTruthy();
    });
    expect({
      field: screen.getByLabelText("Title"),
      patches: requested.filter((line) => line.startsWith("PATCH")),
    }).toEqual({
      field: expect.objectContaining({ value: "Mine" }) as unknown,
      patches: [
        `PATCH ${PATH} {"expected_version":3,"patch":{"title":"Mine"}}`,
        `PATCH ${PATH} {"expected_version":9,"patch":{"title":"Mine"}}`,
      ],
    });
  });

  it("publishes a ready property at its version and shows it live", async () => {
    const requested = serve({
      [`POST ${PATH}/publish`]: { event_id: ID, jobs: [], version: 5 },
    });
    mountEditor(() => Promise.resolve(detail()));
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Live. Each edit saves to the public page.")).toBeTruthy();
    expect(requested.filter((line) => line.startsWith("POST"))).toEqual([
      `POST ${PATH}/publish {"expected_version":3}`,
    ]);
  });

  it("keeps Publish off while a checklist item fails", async () => {
    serve({});
    const draft = detail();
    mountEditor(() => Promise.resolve(draft), {
      ...draft,
      property: { ...draft.property, style: null },
    });
    const publish = await screen.findByRole("button", { name: "Publish" });
    expect(publish).toHaveProperty("disabled", true);
    expect(screen.getByText(/: style/)).toBeTruthy();
  });
});

describe("SequenceTab", () => {
  it("shows orientation as text with no control for it, and a row without one renders blank (G63)", () => {
    render(<SequenceTab media={detail().media} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect({
      controls: screen.queryAllByRole("combobox").length + screen.queryAllByRole("textbox").length,
      first: within(rows[0] ?? document.body)
        .getAllByRole("cell")
        .at(-1)?.textContent,
      second: within(rows[1] ?? document.body)
        .getAllByRole("cell")
        .at(-1)?.textContent,
    }).toEqual({ controls: 0, first: "", second: "landscape" });
  });
});

describe("screen 7", () => {
  const row: PropertyListRow = {
    id: ID,
    slug: "san-francisco-00000000",
    title: "A House Above the Water",
    market_slug: "california",
    region_slug: null,
    editorial_state: "draft",
    campaign_tier: "Editorial",
    hero_rank: null,
    featured_rank: 2,
    published_at: null,
    source: "Submission",
    updated_at: "2026-10-07T12:00:00Z",
  };

  it("lists a property with its state and links it to its editor", () => {
    render(<PropertiesTable filters={{ values: {}, onChange: () => undefined }} rows={[row]} />);
    const link = screen.getByRole("link", { name: "A House Above the Water" });
    expect({
      href: link.getAttribute("href"),
      state: within(screen.getByRole("table")).getByText("Draft").tagName,
      ranks: within(screen.getByRole("table")).getByText("/ 2").textContent,
    }).toEqual({ href: `/admin/properties/${ID}`, state: "SPAN", ranks: " / 2" });
  });

  it("offers Create property for each accepted request without one, to the roles that may", () => {
    const request = {
      id: "00000000-0000-4000-8000-0000000000c1",
      address: "12 Fixture Lane",
      city: "Montecito",
    } satisfies Partial<SubmissionListRow>;
    const onCreate = vi.fn();
    const rendered = (actions: string[]) =>
      render(
        <AdminMeContext value={me(actions)}>
          <NewFromRequest
            requests={[{ ...requestRow, ...request }]}
            creating={null}
            onCreate={onCreate}
          />
        </AdminMeContext>,
      );
    const { unmount } = rendered(["properties.create_from_submission"]);
    fireEvent.click(screen.getByRole("button", { name: "Create property" }));
    unmount();
    rendered([]);
    expect({
      created: onCreate.mock.calls,
      hidden: screen.queryByRole("button", { name: "Create property" }),
    }).toEqual({ created: [[request.id]], hidden: null });
  });
});

const requestRow: SubmissionListRow = {
  id: "",
  received_at: "2026-10-01T12:00:00Z",
  workflow_state: "Accepted",
  accepted_at: "2026-10-02T12:00:00Z",
  address: "",
  city: "",
  state: "California",
  package: "The Feature",
  submitter_kind: "agent",
  submitter_name: "Ana Fixture",
  brokerage: null,
  duplicate_of: null,
  property_id: null,
  turnstile_ok: true,
};
