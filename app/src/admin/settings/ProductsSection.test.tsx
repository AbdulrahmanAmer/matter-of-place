import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { serveAdmin } from "../../../tests/fixtures/admin-serve";
import type { ProductsPreview, SettingsAnswer } from "../../domain/admin-settings";
import { productsSettingSchema, toOffering, type ProductPlan } from "../../domain/exposure";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { ProductsSection } from "./ProductsSection";

// B18 step 2 (H80): the Products section of screen 24. Four plans bound to the request forms' products, reordered and
// flagged here; Save waits for a preview of exactly the form, and a changed price asks first.

const PUT = "PUT /api/admin/settings/products";
const PREVIEW = "POST /api/admin/settings/products/preview";

const plan = (id: ProductPlan["id"], name: string, price: number): ProductPlan => ({
  id,
  name,
  price,
  line: `What ${name} does.`,
  note: null,
  items: [`${name} first item`, `${name} second item`],
  cta: `Ask about ${name}`,
  recommended: id === "reach",
});

const stored = [
  plan("feature", "The Feature", 295),
  plan("reach", "The Reach", 695),
  plan("campaign", "The Campaign", 1495),
  plan("five-features", "Five Features", 1250),
];

const products: SettingsAnswer["products"] = {
  current: { plans: stored },
  defaults: { plans: stored },
};

const previewOf = (changes: ProductsPreview["changes"] = []): ProductsPreview => ({
  plans: stored,
  surfaces: {
    exposure: stored.map(toOffering),
    home: stored.map(toOffering),
    homeHeading: "Four ways in.",
    invoice: stored.map((item) => ({
      product: item.name,
      description: `${item.name}. ${item.line}`,
      amount: "$1.00",
    })),
    faq: "The cost answer.",
  },
  changes,
  warnings: changes.length === 0 ? [] : ["New invoices will use the new price."],
});

const bodiesOf = (requested: string[], key: string) =>
  requested
    .filter((line) => line.startsWith(`${key} `))
    .map((line) => productsSettingSchema.parse(JSON.parse(line.slice(key.length + 1))));

const group = (name: string) => screen.getByRole("group", { name });
const saveButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "Save plans" });

function mount() {
  return render(
    <AdminProviders actions={[]}>
      <ProductsSection products={products} />
    </AdminProviders>,
  );
}

async function previewed() {
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("heading", { name: "Preview" });
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Products section", () => {
  it("draws the four plans with their fixed ids and no control that adds or removes a plan", () => {
    serveAdmin({});
    mount();
    const groups = screen.getAllByRole("group");
    expect({
      legends: groups.map((item) => item.querySelector("legend")?.textContent),
      ids: screen.getAllByText(/^Id .*, fixed\.$/).map((item) => item.textContent),
      addOrRemove: screen
        .getAllByRole("button")
        .filter((button) => /add|remove|delete/i.test(button.textContent)),
      help: screen.getByText(/adding or removing a plan needs a migration/).textContent,
    }).toEqual({
      legends: ["The Feature", "The Reach", "The Campaign", "Five Features"],
      ids: [
        "Id feature, fixed.",
        "Id reach, fixed.",
        "Id campaign, fixed.",
        "Id five-features, fixed.",
      ],
      addOrRemove: [],
      help: "Each plan is bound to a product of the request forms; adding or removing a plan needs a migration. Price never stands for merit, and no plan promises leads, buyers or sales.",
    });
  });

  it("moves a plan down, flags another as recommended and previews the plans in that order", async () => {
    const requested = serveAdmin({ [PREVIEW]: previewOf() });
    mount();
    fireEvent.click(within(group("The Feature")).getByRole("button", { name: "Move down" }));
    fireEvent.click(within(group("The Campaign")).getByRole("radio", { name: "Recommended" }));
    await previewed();
    const [sent] = bodiesOf(requested, PREVIEW);
    expect({
      legends: screen
        .getAllByRole("group")
        .map((item) => item.querySelector("legend")?.textContent),
      sent: sent?.plans.map((item) => `${item.id} ${String(item.recommended)}`),
    }).toEqual({
      legends: ["The Reach", "The Feature", "The Campaign", "Five Features"],
      sent: ["reach false", "feature false", "campaign true", "five-features false"],
    });
  });

  it("keeps Save disabled until a preview of exactly this form has answered", async () => {
    const requested = serveAdmin({ [PREVIEW]: previewOf(), [PUT]: { plans: stored } });
    mount();
    const before = saveButton().disabled;
    await previewed();
    const afterPreview = saveButton().disabled;
    fireEvent.change(within(group("The Reach")).getByLabelText("Name"), {
      target: { value: "The Wider Reach" },
    });
    const afterEdit = saveButton().disabled;
    fireEvent.click(saveButton());
    const sentWhileStale = bodiesOf(requested, PUT).length;
    await previewed();
    await waitFor(() => {
      expect(saveButton().disabled).toBe(false);
    });
    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(bodiesOf(requested, PUT).map((body) => body.plans[1]?.name)).toEqual([
        "The Wider Reach",
      ]);
    });
    expect({ before, afterPreview, afterEdit, sentWhileStale }).toEqual({
      before: true,
      afterPreview: false,
      afterEdit: true,
      sentWhileStale: 0,
    });
  });

  it("asks before saving a changed price: Cancel sends nothing, confirming sends the plans once", async () => {
    const change = {
      id: "feature" as const,
      name: "The Feature",
      moved: false,
      edited: ["price"],
      oldPrice: 295,
      newPrice: 325,
    };
    const requested = serveAdmin({ [PREVIEW]: previewOf([change]), [PUT]: { plans: stored } });
    mount();
    fireEvent.change(within(group("The Feature")).getByLabelText("Price"), {
      target: { value: "325" },
    });
    await previewed();
    fireEvent.click(saveButton());
    const asked = await screen.findByRole("dialog", { name: "Change a price" });
    fireEvent.click(within(asked).getByRole("button", { name: "Cancel" }));
    const cancelled = bodiesOf(requested, PUT).length;
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole("dialog", { name: "Change a price" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the new prices" }));
    await waitFor(() => {
      expect(bodiesOf(requested, PUT).map((body) => body.plans[0]?.price)).toEqual([325]);
    });
    expect(cancelled).toBe(0);
  });

  it("shows the issues by field and sends nothing until the form parses", async () => {
    const requested = serveAdmin({ [PREVIEW]: previewOf() });
    mount();
    const featureName = within(group("The Feature")).getByLabelText("Name");
    const reachPrice = within(group("The Reach")).getByLabelText("Price");
    fireEvent.change(featureName, { target: { value: " " } });
    fireEvent.change(reachPrice, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const fieldErrors = {
      name: featureName.getAttribute("aria-invalid"),
      price: reachPrice.getAttribute("aria-invalid"),
      reachName: within(group("The Reach")).getByLabelText("Name").getAttribute("aria-invalid"),
    };
    fireEvent.change(featureName, { target: { value: "The Reach" } });
    fireEvent.change(reachPrice, { target: { value: "695" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect({
      fieldErrors,
      list: (await screen.findByText("Each plan needs its own name.")).getAttribute("role"),
      sent: requested.length,
    }).toEqual({
      fieldErrors: { name: "true", price: "true", reachName: "false" },
      list: "alert",
      sent: 0,
    });
  });

  it("keeps what the admin typed when the save answers 503", async () => {
    const busy = { error: { code: "unavailable", message: "The service is busy." } };
    serveAdmin({
      [PREVIEW]: previewOf(),
      [PUT]: new Response(JSON.stringify(busy), { status: 503 }),
    });
    mount();
    const line = within(group("Five Features")).getByLabelText<HTMLInputElement>("Line");
    fireEvent.change(line, { target: { value: "For agents with several properties." } });
    await previewed();
    fireEvent.click(saveButton());
    const status = z
      .string()
      .parse(
        (await screen.findByText("The service is busy.")).closest("[role]")?.getAttribute("role"),
      );
    expect({ status, kept: line.value }).toEqual({
      status: "status",
      kept: "For agents with several properties.",
    });
  });
});
