import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ReasonRow } from "./automation-queries";
import { ReasonsPage } from "./ReasonsPage";
import { mountAdminPage } from "./test-mount";

const REASONS = "/api/admin/automation/reasons";

const reason = (id: string, code: string, label: string, sort: number): ReasonRow => ({
  id,
  code,
  label,
  email_paragraph: `Paragraph for ${code}.`,
  sort,
  enabled: true,
});

const seeded = [
  reason("a1", "not_a_fit", "Not a fit", 1),
  reason("b2", "outside_markets", "Outside our markets", 2),
  { ...reason("c3", "other", "Other", 3), email_paragraph: "" },
];

const editor = ["automation.get", "automation.reasons_put"];

const order = z.object({ ids: z.array(z.string()) });
const created = z.object({
  code: z.string(),
  label: z.string(),
  email_paragraph: z.string(),
  enabled: z.boolean(),
});
const edited = z.object({ label: z.string(), email_paragraph: z.string(), enabled: z.boolean() });

afterEach(() => {
  vi.unstubAllGlobals();
});

const bodyOf = (init: RequestInit): unknown =>
  JSON.parse(typeof init.body === "string" ? init.body : "null");

/**
 * The decline reasons as the Worker holds them: a list in `sort` order, a create that goes last, an edit by id and the
 * one order route that renumbers. `requests` lists `METHOD path` in order, `bodies` what each write sent.
 */
function open(options: { actions?: string[]; refuse?: string; none?: boolean } = {}) {
  let held = options.none === true ? [] : [...seeded];
  const requests: string[] = [];
  const bodies: Record<string, unknown[]> = {};
  const answer = (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    requests.push(`${method} ${path}`);
    if (method !== "GET") (bodies[`${method} ${path}`] ??= []).push(bodyOf(init));
    if (options.refuse !== undefined && method !== "GET") {
      return Response.json(
        { error: { code: "validation", message: options.refuse } },
        { status: 422 },
      );
    }
    if (method === "GET" && path === REASONS) {
      return Response.json({ items: [...held].sort((a, b) => a.sort - b.sort) });
    }
    if (method === "POST" && path === REASONS) {
      const draft = created.parse(bodyOf(init));
      const row = { ...draft, id: "d4", sort: held.length + 1 };
      held = [...held, row];
      return Response.json(row);
    }
    if (method === "PUT" && path === `${REASONS}/order`) {
      const { ids } = order.parse(bodyOf(init));
      held = ids.flatMap((id, index) => {
        const row = held.find((entry) => entry.id === id);
        return row === undefined ? [] : [{ ...row, sort: index + 1 }];
      });
      return Response.json({ ok: true });
    }
    if (method === "PUT" && path.startsWith(`${REASONS}/`)) {
      const id = path.slice(REASONS.length + 1);
      const patch = edited.parse(bodyOf(init));
      held = held.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
      return Response.json(held.find((entry) => entry.id === id));
    }
    return new Response("{}", { status: 404 });
  };
  mountAdminPage({
    actions: options.actions ?? editor,
    path: "/admin/automation/reasons",
    page: <ReasonsPage />,
    answer,
  });
  return {
    count: (request: string) => requests.filter((entry) => entry === request).length,
    last: (request: string): unknown => bodies[request]?.at(-1),
  };
}

/** The labels in the table, top to bottom. */
const labels = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.querySelector("span")?.textContent);

const ready = () => screen.findByRole("table");

describe("the list", () => {
  it("shows the reasons in the order of the decline menu with their state", async () => {
    open();
    await ready();
    expect(labels()).toEqual(["Not a fit", "Outside our markets", "Other"]);
    expect(screen.getByText("Paragraph for not_a_fit.")).toBeTruthy();
    expect(screen.getByText("The editor's note is the message.")).toBeTruthy();
  });

  it("offers no edit control to a role the matrix leaves out", async () => {
    open({ actions: ["automation.get"] });
    await ready();
    expect(labels()).toHaveLength(3);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Change")).toBeNull();
  });
});

describe("an empty list", () => {
  it("says so and still offers the add control", async () => {
    open({ none: true });
    expect(await screen.findByText("No decline reasons")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Add a reason" })).toBeTruthy();
  });
});

describe("adding", () => {
  it("sends the new reason, then lists it last", async () => {
    const api = open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add a reason" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "price_only" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Price only" } });
    fireEvent.change(screen.getByLabelText("Email paragraph"), {
      target: { value: "We do not take a property on price alone." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add reason" }));
    await screen.findByText("Price only");
    expect(api.last(`POST ${REASONS}`)).toEqual({
      code: "price_only",
      label: "Price only",
      email_paragraph: "We do not take a property on price alone.",
      enabled: true,
    });
    expect(labels().at(-1)).toBe("Price only");
  });

  it("names the field that is not ready and sends nothing", async () => {
    const api = open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add a reason" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "Not A Slug" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reason" }));
    const alerts = (await screen.findAllByRole("alert")).map((alert) => alert.textContent);
    expect(alerts).toEqual(["Use lowercase letters, digits, hyphens and underscores", "Required"]);
    expect(api.count(`POST ${REASONS}`)).toBe(0);
  });

  it("shows the server's words when it refuses, and keeps the form", async () => {
    open({ refuse: "That code is taken." });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add a reason" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Other again" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reason" }));
    expect(await screen.findByText(/That code is taken\./)).toBeTruthy();
    expect(screen.getByLabelText("Label")).toHaveProperty("value", "Other again");
  });
});

describe("editing", () => {
  it("sends the changed fields to that reason and keeps its code", async () => {
    const api = open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Edit Outside our markets" }));
    expect(screen.getByLabelText("Code").matches(":disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Outside the markets" } });
    fireEvent.click(screen.getByLabelText("Reason on"));
    fireEvent.click(screen.getByRole("button", { name: "Save reason" }));
    await screen.findByText("Outside the markets");
    expect(api.last(`PUT ${REASONS}/b2`)).toEqual({
      label: "Outside the markets",
      email_paragraph: "Paragraph for outside_markets.",
      enabled: false,
    });
    expect(screen.getAllByText("Off")).toHaveLength(1);
  });
});

describe("reordering", () => {
  it("sends one request with the new order of every id", async () => {
    const api = open();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Move Not a fit down" }));
    await waitFor(() => {
      expect(labels()).toEqual(["Outside our markets", "Not a fit", "Other"]);
    });
    expect(api.count(`PUT ${REASONS}/order`)).toBe(1);
    expect(api.last(`PUT ${REASONS}/order`)).toEqual({ ids: ["b2", "a1", "c3"] });
  });

  it("cannot move the first reason up or the last one down", async () => {
    open();
    await ready();
    expect(screen.getByRole("button", { name: "Move Not a fit up" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Move Other down" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
