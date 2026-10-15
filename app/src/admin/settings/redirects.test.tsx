import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { LinkCheck, OldAddress, RedirectPage, RedirectRow } from "../../domain/admin-settings";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { RedirectsSection } from "./RedirectsSection";

// Screen 24's redirects (B7 step 15a, invariant 16): the active rows, an add or edit form that refuses an invalid or
// looping row inline before it sends anything, and remove, which archives the row through DELETE. W7 item 6 adds the
// old addresses of renamed properties (read only) and a box that tests where a link leads.

const LIST = "/api/admin/settings/redirects";
const ID_A = "00000000-0000-4000-8000-0000000000c1";
const ID_B = "00000000-0000-4000-8000-0000000000c2";

const rows: RedirectRow[] = [
  { id: ID_A, from_path: "/summer", to_path: "/markets", status: 302 },
  { id: ID_B, from_path: "/markets", to_path: "/markets/california", status: 301 },
];

const PROPERTY = "00000000-0000-4000-8000-0000000000d1";

const oldAddresses: OldAddress[] = [
  {
    slug: "old-ridge",
    property_id: PROPERTY,
    title: "The Ridge",
    current_slug: "the-ridge",
    live: true,
  },
  {
    slug: "old-cove",
    property_id: PROPERTY,
    title: "The Cove",
    current_slug: "the-cove",
    live: false,
  },
];

/** The answer of the read: the redirect rows, the old addresses and, once a path was sent, its check. */
function answer(overrides: Partial<RedirectPage> = {}): RedirectPage {
  return {
    items: rows,
    next_cursor: null,
    old_addresses: { items: [], next_cursor: null },
    check: null,
    ...overrides,
  };
}

const writes = (requested: string[]) => requested.filter((line) => !line.startsWith("GET "));

function mount(answers: Record<string, unknown> = {}) {
  const requested = serve({ [`GET ${LIST}`]: answer(), ...answers });
  render(
    <AdminProviders actions={[]}>
      <RedirectsSection />
    </AdminProviders>,
  );
  return requested;
}

function fill(from: string, to: string, status = "301") {
  fireEvent.change(screen.getByLabelText("Old address"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("New address"), { target: { value: to } });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: status } });
  fireEvent.click(screen.getByRole("button", { name: /redirect$/ }));
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("screen 24, redirects", () => {
  it("refuses an /admin source, an outside target and a loop inline, and sends nothing", async () => {
    const requested = mount();
    await screen.findByText("/summer");
    const refused: string[] = [];
    for (const [from, to] of [
      ["/admin/x", "/"],
      ["/old", "https://example.com/x"],
      ["/markets/california", "/summer"],
    ] as const) {
      fill(from, to);
      refused.push(screen.getByRole("alert").textContent);
    }
    expect({ refused, writes: writes(requested) }).toEqual({
      refused: [
        "Admin and API addresses cannot be redirected.",
        "The new address must be a path on this site.",
        "These addresses would redirect in a loop.",
      ],
      writes: [],
    });
  });

  it("adds a valid row through PUT, and shows the server's refusal beside the form", async () => {
    const requested = mount({
      [`PUT ${LIST}`]: new Response(
        JSON.stringify({
          error: { code: "invalid_redirect", message: "That old address is already redirected." },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    });
    await screen.findByText("/summer");
    fill("/winter", "/stories", "302");
    await screen.findByText("That old address is already redirected.");
    expect(writes(requested)).toEqual([
      `PUT ${LIST} ${JSON.stringify({ from_path: "/winter", to_path: "/stories", status: 302 })}`,
    ]);
  });

  it("edits a row by its id, and removes one through DELETE after one confirmation", async () => {
    const requested = mount({
      [`PUT ${LIST}`]: { ...rows[0], to_path: "/stories" },
      [`DELETE ${LIST}`]: { ...rows[1], archived_at: "2026-10-10T08:00:00+00:00" },
    });
    const summer = (await screen.findByText("/summer")).closest("tr");
    if (summer === null) throw new Error("no /summer row");
    fireEvent.click(within(summer).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("New address"), { target: { value: "/stories" } });
    fireEvent.click(screen.getByRole("button", { name: "Save redirect" }));
    await waitFor(() => {
      expect(writes(requested)).toHaveLength(1);
    });
    const markets = screen.getByText("/markets/california").closest("tr");
    if (markets === null) throw new Error("no /markets row");
    fireEvent.click(within(markets).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this redirect" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(writes(requested)).toHaveLength(2);
    });
    expect(writes(requested)).toEqual([
      `PUT ${LIST} ${JSON.stringify({ id: ID_A, from_path: "/summer", to_path: "/stories", status: 302 })}`,
      `DELETE ${LIST} ${JSON.stringify({ id: ID_B })}`,
    ]);
  });

  it("pages on with the cursor of the last row and back to the first page", async () => {
    const requested = serve({
      [`GET ${LIST}`]: answer({ next_cursor: "/summer" }),
      [`GET ${LIST}?cursor=%2Fsummer`]: answer({
        items: [{ id: ID_A, from_path: "/winter", to_path: "/stories", status: 301 }],
      }),
    });
    render(
      <AdminProviders actions={[]}>
        <RedirectsSection />
      </AdminProviders>,
    );
    await screen.findByText("/summer");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText("/winter");
    const paged = [...requested];
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect({ paged, back: (await screen.findByText("/summer")).textContent }).toEqual({
      paged: [`GET ${LIST}`, `GET ${LIST}?cursor=%2Fsummer`],
      back: "/summer",
    });
  });

  it("lists each old property address read only, with the page it leads to and whether that property is published", async () => {
    mount({
      [`GET ${LIST}`]: answer({ old_addresses: { items: oldAddresses, next_cursor: null } }),
    });
    const table = await screen.findByRole("table", { name: "Old property addresses" });
    const lines = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
    expect({ lines, buttons: within(table).queryAllByRole("button").length }).toEqual({
      lines: [
        "/property/old-ridge/property/the-ridge (The Ridge)Published",
        "/property/old-cove/property/the-cove (The Cove)Not published",
      ],
      buttons: 0,
    });
  });

  it("pages the old addresses on their own cursor and leaves the redirect rows where they were", async () => {
    const requested = serve({
      [`GET ${LIST}`]: answer({
        old_addresses: { items: oldAddresses.slice(0, 1), next_cursor: "old-ridge" },
      }),
      [`GET ${LIST}?old_cursor=old-ridge`]: answer({
        old_addresses: { items: oldAddresses.slice(1), next_cursor: null },
      }),
    });
    render(
      <AdminProviders actions={[]}>
        <RedirectsSection />
      </AdminProviders>,
    );
    const table = await screen.findByRole("table", { name: "Old property addresses" });
    await within(table).findByText("/property/old-ridge");
    const next = screen.getAllByRole("button", { name: /next/i });
    fireEvent.click(next[next.length - 1] as HTMLElement);
    await screen.findByText("/property/old-cove");
    expect(requested).toEqual([`GET ${LIST}`, `GET ${LIST}?old_cursor=old-ridge`]);
  });

  it("tests a typed path through the read and shows each hop, and asks for a path when the box is empty", async () => {
    const check: LinkCheck = {
      path: "/summer",
      loop: false,
      steps: [
        { from: "/summer", to: "/markets", status: 302, source: "redirect" },
        { from: "/markets", to: "/property/the-ridge", status: 301, source: "old_address" },
      ],
    };
    const requested = mount({ [`GET ${LIST}?path=%2Fsummer`]: answer({ check }) });
    await screen.findByText("/summer");
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    const empty = screen.getByText("Type an address to test.");
    fireEvent.change(screen.getByLabelText("Address to test"), { target: { value: " /summer " } });
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    const status = await screen.findByRole("status");
    expect({
      empty: empty.textContent,
      hops: within(status)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
      requested,
    }).toEqual({
      empty: "Type an address to test.",
      hops: [
        "/summer goes to /markets (302, redirect).",
        "/markets goes to /property/the-ridge (301, old property address).",
      ],
      requested: [`GET ${LIST}`, `GET ${LIST}?path=%2Fsummer`],
    });
  });

  it("says there is no redirect for a path nothing leads from, and says when hops run in a circle", async () => {
    mount({
      [`GET ${LIST}?path=%2Fnothing`]: answer({
        check: { path: "/nothing", loop: false, steps: [] },
      }),
      [`GET ${LIST}?path=%2Fa`]: answer({
        check: {
          path: "/a",
          loop: true,
          steps: [
            { from: "/a", to: "/b", status: 301, source: "redirect" },
            { from: "/b", to: "/a", status: 301, source: "redirect" },
          ],
        },
      }),
    });
    await screen.findByText("/summer");
    const box = screen.getByLabelText("Address to test");
    fireEvent.change(box, { target: { value: "/nothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    const none = (await screen.findByRole("status")).textContent;
    fireEvent.change(box, { target: { value: "/a" } });
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    await screen.findByText("These addresses lead in a circle.");
    expect(none).toBe("No redirect: the site answers /nothing as it is.");
  });

  it("hides the last answer while the next path is being checked", async () => {
    mount({
      [`GET ${LIST}?path=%2Fnothing`]: answer({
        check: { path: "/nothing", loop: false, steps: [] },
      }),
    });
    await screen.findByText("/summer");
    const box = screen.getByLabelText("Address to test");
    fireEvent.change(box, { target: { value: "/nothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    await screen.findByRole("status");
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    fireEvent.change(box, { target: { value: "/later" } });
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
