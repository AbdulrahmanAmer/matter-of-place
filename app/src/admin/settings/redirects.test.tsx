import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { RedirectRow } from "../../domain/admin-settings";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { RedirectsSection } from "./RedirectsSection";

// Screen 24's redirects (B7 step 15a, invariant 16): the active rows, an add or edit form that refuses an invalid or
// looping row inline before it sends anything, and remove, which archives the row through DELETE.

const LIST = "/api/admin/settings/redirects";
const ID_A = "00000000-0000-4000-8000-0000000000c1";
const ID_B = "00000000-0000-4000-8000-0000000000c2";

const rows: RedirectRow[] = [
  { id: ID_A, from_path: "/summer", to_path: "/markets", status: 302 },
  { id: ID_B, from_path: "/markets", to_path: "/markets/california", status: 301 },
];

const writes = (requested: string[]) => requested.filter((line) => !line.startsWith("GET "));

function mount(answers: Record<string, unknown> = {}) {
  const requested = serve({ [`GET ${LIST}`]: { items: rows, next_cursor: null }, ...answers });
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
      [`GET ${LIST}`]: { items: rows, next_cursor: "/summer" },
      [`GET ${LIST}?cursor=%2Fsummer`]: {
        items: [{ id: ID_A, from_path: "/winter", to_path: "/stories", status: 301 }],
        next_cursor: null,
      },
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
});
