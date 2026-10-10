import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { InvoiceSettings, SettingsAnswer } from "../../domain/admin-settings";
import { siteFieldSpecs, siteSettingsSchema } from "../../domain/settings";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { SettingsPage } from "./SettingsPage";

// Screen 24 (B7 step 15): identity from B16's field specs with the readiness list, invoicing from B6's schema, the
// coming-soon switch behind a confirmation and the alert recipients, each saved through its own route.

const SETTINGS = "/api/admin/settings";

const invoice: InvoiceSettings = {
  prefix: "MOP",
  due_days: 14,
  terms: "Due in 14 days.",
  late_terms: "Late after 30 days.",
  tax_line: "No tax applies.",
  payment_methods: [{ id: "wire", label: "Wire", instructions: "Account 1" }],
  campaign_days: {
    "The Feature": null,
    "The Reach": null,
    "The Campaign": 30,
    "Five Features": null,
  },
  billing_email: "billing@example.invalid",
};

const answer = (over: Partial<SettingsAnswer> = {}): SettingsAnswer => ({
  site: siteSettingsSchema.parse({ contact: { email: "hello@example.invalid" } }),
  invoice,
  coming_soon_global: false,
  notifications: { recipients: [] },
  agent_daily_limits: null,
  readiness: ["legal.entity", "legal.address"],
  ...over,
});

const writes = (requested: string[]) => requested.filter((line) => !line.startsWith("GET "));

function mount() {
  return render(
    <AdminProviders actions={[]}>
      <SettingsPage />
    </AdminProviders>,
  );
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("screen 24", () => {
  it("draws the identity fields in B16's order and names each unset one in the banner and beside its field", async () => {
    serve({ [`GET ${SETTINGS}`]: answer() });
    mount();
    const identity = (await screen.findByRole("heading", { name: "Identity" })).closest("section");
    if (identity === null) throw new Error("no identity section");
    const labels = within(identity)
      .getAllByText((_, element) => element?.tagName === "LABEL")
      .map((label) => label.textContent);
    const banner = screen.getByRole("heading", { name: "Before launch" }).closest("section");
    if (banner === null) throw new Error("no readiness banner");
    expect({
      labels,
      banner: within(banner)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
      entityHint: within(identity).getByText(/^Shown on the legal page and on every invoice\./)
        .textContent,
      email: within(identity).getByLabelText<HTMLInputElement>("Contact email").value,
    }).toEqual({
      labels: siteFieldSpecs.map((spec) => spec.label),
      banner: ["Legal entity", "Registered address"],
      entityHint: "Shown on the legal page and on every invoice. Needed before launch.",
      email: "hello@example.invalid",
    });
  });

  it("says every setting is in place when the readiness list is empty", async () => {
    serve({ [`GET ${SETTINGS}`]: answer({ readiness: [] }) });
    mount();
    expect(
      (await screen.findByText("Every setting the site and its invoices need is in place."))
        .textContent,
    ).toBe("Every setting the site and its invoices need is in place.");
  });

  it("checks the invoicing form with B6's schema: a bad prefix is refused inline and nothing is sent", async () => {
    const requested = serve({ [`GET ${SETTINGS}`]: answer() });
    mount();
    const prefix = await screen.findByLabelText("Number prefix");
    fireEvent.change(prefix, { target: { value: "mop-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save invoicing" }));
    const invalid = await waitFor(() => {
      const value = prefix.getAttribute("aria-invalid");
      expect(value).toBe("true");
      return value;
    });
    expect({ invalid, writes: writes(requested) }).toEqual({ invalid: "true", writes: [] });
  });

  it("sends the invoicing form to its own route once it parses", async () => {
    const changed = { ...invoice, prefix: "MOPX" };
    const requested = serve({
      [`GET ${SETTINGS}`]: answer(),
      [`PUT ${SETTINGS}/invoice`]: changed,
    });
    mount();
    fireEvent.change(await screen.findByLabelText("Number prefix"), { target: { value: "MOPX" } });
    fireEvent.click(screen.getByRole("button", { name: "Save invoicing" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([`PUT ${SETTINGS}/invoice ${JSON.stringify(changed)}`]);
    });
  });

  it("asks before showing the coming-soon page, sends nothing on Cancel, and puts true once confirmed", async () => {
    const requested = serve({
      [`GET ${SETTINGS}`]: answer(),
      [`PUT ${SETTINGS}/coming-soon`]: { coming_soon_global: true },
    });
    mount();
    const toggle = await screen.findByRole("button", { name: "Show the coming-soon page" });
    fireEvent.click(toggle);
    const asked = await screen.findByRole("dialog", { name: "Show the coming-soon page" });
    fireEvent.click(within(asked).getByRole("button", { name: "Cancel" }));
    const cancelled = writes(requested);
    fireEvent.click(toggle);
    const dialog = await screen.findByRole("dialog", { name: "Show the coming-soon page" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Show coming soon" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([
        `PUT ${SETTINGS}/coming-soon {"coming_soon_global":true}`,
      ]);
    });
    expect(cancelled).toEqual([]);
  });

  it("puts the alert recipients one per line, lower case, and refuses a bad address inline", async () => {
    const requested = serve({
      [`GET ${SETTINGS}`]: answer(),
      [`PUT ${SETTINGS}/notifications`]: { recipients: ["ops@example.invalid"] },
    });
    mount();
    const list = await screen.findByLabelText("Alert recipients");
    fireEvent.change(list, { target: { value: "not an address" } });
    fireEvent.click(screen.getByRole("button", { name: "Save recipients" }));
    await screen.findByText("Invalid email");
    const refused = writes(requested);
    fireEvent.change(list, { target: { value: " Ops@Example.invalid \n\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save recipients" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([
        `PUT ${SETTINGS}/notifications {"recipients":["ops@example.invalid"]}`,
      ]);
    });
    expect(refused).toEqual([]);
  });
});
