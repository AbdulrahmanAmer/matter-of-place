import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { MarketDetail } from "../../domain/admin-markets";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { ComingSoonToggle } from "./ComingSoonToggle";
import { MarketEditor } from "./MarketEditor";

const UPDATED = "2026-10-08T12:00:00.123456+00:00";
const PATH = "/api/admin/markets/california";
const UPLOAD = "https://storage.test/upload";
const MARKET_STAGED = "staging/market/california/00000000-0000-4000-8000-0000000000c1.jpg";
const REGION_STAGED = "staging/region/bay-area/00000000-0000-4000-8000-0000000000c2.jpg";

const viewerActions = ["markets.list", "markets.get"];
const editorActions = [...viewerActions, "markets.edit", "markets.coming_soon"];

const market = (over: Partial<MarketDetail> = {}): MarketDetail => ({
  slug: "california",
  name: "California",
  coming_soon: true,
  sort_order: 0,
  image_url: null,
  interest: { confirmed: 3, pending: 2 },
  intro: "The coast.",
  places: ["Malibu", "Carmel"],
  interest_copy: null,
  updated_at: UPDATED,
  regions: [
    {
      slug: "bay-area",
      name: "Bay Area",
      intro: "The bay.",
      places: ["Marin"],
      sort_order: 0,
      image_url: "/media/r/bay-0a1b2c3d.webp",
    },
    {
      slug: "los-angeles",
      name: "Los Angeles",
      intro: "The basin.",
      places: [],
      sort_order: 1,
      image_url: null,
    },
  ],
  notes: [
    { label: "Light", text: "l" },
    { label: "Water", text: "w" },
  ],
  guide_entries: [
    { section: "need", region_slug: null, label: "Parking", text: "p" },
    { section: "neighborhood", region_slug: "bay-area", label: "Marin", text: "m" },
  ],
  ...over,
});

const saved = { slug: "california", updated_at: UPDATED };

/** The JSON body of the one request that began with `line`. */
function bodyOf(requested: string[], line: string): unknown {
  const found = requested.find((entry) => entry.startsWith(`${line} `));
  if (found === undefined) throw new Error(`no request ${line}`);
  return JSON.parse(found.slice(line.length + 1));
}

function mount(actions: string[], detail = market()) {
  return render(
    <AdminProviders actions={actions}>
      <MarketEditor market={detail} />
    </AdminProviders>,
  );
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const press = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const picture = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], "coast.jpg", { type: "image/jpeg" });

/** The answers for a staged upload: the signed URL request names the path, and the PUT is accepted. */
const uploads = (path: string) => ({
  "POST /api/admin/media/upload-url": { path, url: UPLOAD },
  [`PUT ${UPLOAD}`]: {},
});

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ComingSoonToggle", () => {
  it("shows the interest signups split into confirmed and pending, asks before opening, and posts coming_soon false once confirmed", async () => {
    const requested = serve({
      [`POST ${PATH}/coming-soon`]: { ...saved, coming_soon: false },
    });
    render(
      <AdminProviders actions={editorActions}>
        <ComingSoonToggle market={market()} />
      </AdminProviders>,
    );
    const interest = screen.getByText("Interest: 3 confirmed, 2 waiting to confirm.");
    fireEvent.click(screen.getByRole("button", { name: "Open this market" }));
    const asked = requested.length;
    const dialog = await screen.findByRole("dialog", { name: "Open California" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(requested.some((line) => line.startsWith(`POST ${PATH}/coming-soon`))).toBe(true);
    });
    expect({
      interest: interest.textContent,
      asked,
      body: bodyOf(requested, `POST ${PATH}/coming-soon`),
    }).toEqual({
      interest: "Interest: 3 confirmed, 2 waiting to confirm.",
      asked: 0,
      body: { coming_soon: false },
    });
  });

  it("offers Return to coming soon on an open market and posts coming_soon true", async () => {
    const requested = serve({ [`POST ${PATH}/coming-soon`]: { ...saved, coming_soon: true } });
    render(
      <AdminProviders actions={editorActions}>
        <ComingSoonToggle market={market({ coming_soon: false })} />
      </AdminProviders>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Return to coming soon" }));
    const dialog = await screen.findByRole("dialog", { name: "Return California to coming soon" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Return" }));
    await waitFor(() => {
      expect(requested.some((line) => line.startsWith(`POST ${PATH}/coming-soon`))).toBe(true);
    });
    expect(bodyOf(requested, `POST ${PATH}/coming-soon`)).toEqual({ coming_soon: true });
  });

  it("shows the state and the counts but no button to someone without markets.coming_soon", () => {
    render(
      <AdminProviders actions={viewerActions}>
        <ComingSoonToggle market={market()} />
      </AdminProviders>,
    );
    expect({
      state: screen.getByText("Coming soon").textContent,
      buttons: screen.queryAllByRole("button").length,
    }).toEqual({ state: "Coming soon", buttons: 0 });
  });
});

describe("MarketEditor", () => {
  it("keeps Save off until something changes, and PATCHes only the changed market fields, leaving the regions, notes and guide out", async () => {
    const requested = serve({ [`PATCH ${PATH}`]: saved });
    mount(editorActions);
    const before = screen.getByRole("button", { name: "Save" }).hasAttribute("disabled");
    type("Intro", "A longer coast.");
    const after = screen.getByRole("button", { name: "Save" }).hasAttribute("disabled");
    press("Save");
    await screen.findByText("Saved.");
    expect({ before, after, body: bodyOf(requested, `PATCH ${PATH}`) }).toEqual({
      before: true,
      after: false,
      body: { patch: { intro: "A longer coast." } },
    });
  });

  it("sends the notes in display order after a note is moved up", async () => {
    const requested = serve({ [`PATCH ${PATH}`]: saved });
    mount(editorActions);
    press("Move note 2 up");
    press("Save");
    await screen.findByText("Saved.");
    expect(bodyOf(requested, `PATCH ${PATH}`)).toEqual({
      patch: {},
      notes: [
        { label: "Water", text: "w" },
        { label: "Light", text: "l" },
      ],
    });
  });

  it("sends the guide entries in display order, with the section and region of each, after one is moved down and one is added", async () => {
    const requested = serve({ [`PATCH ${PATH}`]: saved });
    mount(editorActions);
    press("Move guide entry 1 down");
    press("Add guide entry");
    type("Guide entry 3 label", "Movers");
    type("Guide entry 3 text", "We know two.");
    type("Guide entry 3 section", "service");
    press("Save");
    await screen.findByText("Saved.");
    expect(bodyOf(requested, `PATCH ${PATH}`)).toEqual({
      patch: {},
      guide_entries: [
        { section: "neighborhood", region_slug: "bay-area", label: "Marin", text: "m" },
        { section: "need", region_slug: null, label: "Parking", text: "p" },
        { section: "service", region_slug: null, label: "Movers", text: "We know two." },
      ],
    });
  });

  it("keeps an existing region image on save: an edited region goes with no image key and the other regions stay out", async () => {
    const requested = serve({ [`PATCH ${PATH}`]: saved });
    mount(editorActions);
    type("Region bay area name", "San Francisco Bay");
    press("Save");
    await screen.findByText("Saved.");
    const body = bodyOf(requested, `PATCH ${PATH}`);
    expect({ body, hasImage: JSON.stringify(body).includes("image") }).toEqual({
      body: {
        patch: {},
        regions: [
          {
            slug: "bay-area",
            name: "San Francisco Bay",
            intro: "The bay.",
            places: ["Marin"],
            sort_order: 0,
          },
        ],
      },
      hasImage: false,
    });
  });

  it("stages a picked region image on the signed URL and sends its path with that region only", async () => {
    const requested = serve({ ...uploads(REGION_STAGED), [`PATCH ${PATH}`]: saved });
    mount(editorActions);
    fireEvent.change(screen.getByLabelText("Replace image for bay area"), {
      target: { files: [picture()] },
    });
    await screen.findByText(
      "coast.jpg is ready. It replaces the image once the market is saved and the image is prepared.",
    );
    press("Save");
    await screen.findByText("Saved. The images are being prepared and show here when ready.");
    expect(bodyOf(requested, `PATCH ${PATH}`)).toEqual({
      patch: {},
      regions: [
        {
          slug: "bay-area",
          name: "Bay Area",
          intro: "The bay.",
          places: ["Marin"],
          sort_order: 0,
          image_staging_path: REGION_STAGED,
        },
      ],
    });
  });

  it("stages a picked market image and sends its path beside the other changes", async () => {
    const requested = serve({ ...uploads(MARKET_STAGED), [`PATCH ${PATH}`]: saved });
    mount(editorActions);
    fireEvent.change(screen.getByLabelText("Choose image"), { target: { files: [picture()] } });
    await screen.findByText(/coast.jpg is ready/);
    press("Save");
    await screen.findByText("Saved. The images are being prepared and show here when ready.");
    expect(bodyOf(requested, `PATCH ${PATH}`)).toEqual({
      patch: {},
      image_staging_path: MARKET_STAGED,
    });
  });

  it("keeps Save off while a note has no text or a neighborhood has no region", () => {
    mount(editorActions);
    type("Note 1 text", "");
    const noText = screen.getByRole("button", { name: "Save" }).hasAttribute("disabled");
    type("Note 1 text", "l");
    type("Guide entry 2 region", "");
    expect({
      noText,
      noRegion: screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    }).toEqual({ noText: true, noRegion: true });
  });

  it("shows a viewer the fields and no Save, Add or Move button", () => {
    mount(viewerActions);
    expect({
      save: screen.queryByRole("button", { name: "Save" }),
      add: screen.queryByRole("button", { name: "Add note" }),
      move: screen.queryByRole("button", { name: "Move note 2 up" }),
      intro: screen.getByLabelText<HTMLTextAreaElement>("Intro").value,
    }).toEqual({ save: null, add: null, move: null, intro: "The coast." });
  });
});
