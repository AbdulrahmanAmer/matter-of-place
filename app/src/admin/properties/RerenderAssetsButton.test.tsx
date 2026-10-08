import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminAsset } from "../../domain/admin-assets";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { PublishBar } from "./PublishBar";
import { RerenderAssetsButton } from "./RerenderAssetsButton";

const PROPERTY = "00000000-0000-4000-8000-0000000000a1";
const LIST = `GET /api/admin/assets?property_id=${PROPERTY}`;
const JOB = "00000000-0000-4000-8000-0000000000f1";

const row = (id: string, overrides: Partial<AdminAsset>): AdminAsset => ({
  id,
  property_id: PROPERTY,
  kind: "cover",
  revision: 1,
  status: "pending",
  caption: null,
  alt_text: null,
  meta: {},
  files: [],
  rejection_note: null,
  render_error: null,
  job_id: null,
  approved_at: null,
  created_at: "2026-10-07T09:00:00Z",
  updated_at: "2026-10-07T09:00:00Z",
  captions_waiting: false,
  ...overrides,
});

const idOf = (n: number) => `00000000-0000-4000-8000-0000000000c${String(n)}`;

function mount(
  actions: string[],
  page: ReactNode = <RerenderAssetsButton propertyId={PROPERTY} />,
) {
  return render(<AdminProviders actions={actions}>{page}</AdminProviders>);
}

function serve(items: AdminAsset[]) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    requested.push(key);
    if (key === LIST) return Promise.resolve(Response.json({ items, total: items.length }));
    if (key.startsWith("POST") && key.endsWith("/rerender")) {
      return Promise.resolve(Response.json({ asset_id: path.split("/")[4], job_id: JOB }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  return requested;
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RerenderAssetsButton", () => {
  it("is not drawn for an actor without assets.re_render", async () => {
    const requested = serve([row(idOf(1), {})]);
    mount(["assets.list"]);
    await waitFor(() => {
      expect(requested).toContain(LIST);
    });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("makes one call for each current asset: the highest revision of a kind that is not rejected", async () => {
    const requested = serve([
      row(idOf(1), { kind: "cover", revision: 1, status: "rejected" }),
      row(idOf(2), { kind: "cover", revision: 2, status: "pending" }),
      row(idOf(3), { kind: "cover", revision: 3, status: "rejected" }),
      row(idOf(4), { kind: "story", revision: 1, status: "approved" }),
      row(idOf(5), { kind: "carousel", revision: 1, status: "rejected" }),
    ]);
    mount(["assets.re_render"]);
    const button = await screen.findByRole("button", { name: "Request re-render of assets" });
    await waitFor(() => {
      expect(button).toHaveProperty("disabled", false);
    });
    fireEvent.click(button);
    const dialog = within(screen.getByRole("dialog", { name: "Request re-render of assets" }));
    const before = requested.filter((line) => line.startsWith("POST"));
    fireEvent.click(dialog.getByRole("button", { name: "Re-render" }));
    expect(await screen.findByText("render cover")).toBeTruthy();
    expect(before).toEqual([]);
    expect(requested.filter((line) => line.startsWith("POST")).sort()).toEqual([
      `POST /api/admin/assets/${idOf(2)}/rerender`,
      `POST /api/admin/assets/${idOf(4)}/rerender`,
    ]);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "render coverQueued",
      "render storyQueued",
    ]);
  });

  it("is drawn in the publish bar of the open property", async () => {
    const requested = serve([row(idOf(1), {})]);
    mount(
      ["assets.re_render"],
      <PublishBar
        propertyId={PROPERTY}
        state="draft"
        checklist={[]}
        pending={false}
        jobs={[]}
        onMove={() => undefined}
        onPublish={() => undefined}
      />,
    );
    expect(await screen.findByRole("button", { name: "Request re-render of assets" })).toBeTruthy();
    expect(requested).toContain(LIST);
  });

  it("is disabled and says there are no assets yet when the property has none", async () => {
    serve([]);
    mount(["assets.re_render"]);
    expect(await screen.findByText("No assets yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request re-render of assets" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
