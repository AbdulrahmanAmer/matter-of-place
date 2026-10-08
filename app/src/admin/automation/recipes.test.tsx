import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { stepSchema } from "../../domain/automation";
import { AdminMeContext, type AdminMe } from "../ui/admin-me";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { ToastProvider } from "../ui/Toast";
import type { RecipeRow, StepSpecView } from "./automation-queries";
import { RecipesPage } from "./RecipesPage";

const RECIPES = "/api/admin/automation/recipes";
const DRY_RUN = "/api/admin/automation/dry-run";
const RECORD = "00000000-0000-4000-8000-0000000000aa";

const step = (id: string, type: string, over: Partial<RecipeRow["steps"][number]> = {}) => ({
  id,
  step_type: type,
  params: {},
  enabled: true,
  requires_approval: false,
  conditions: {},
  ...over,
});

const received: RecipeRow = {
  id: "00000000-0000-4000-8000-000000000001",
  trigger: "submission.received",
  name: "Submission received",
  enabled: true,
  version: 1,
  steps: [
    step("send_received", "send_email", { params: { template: "received" } }),
    step("notify_admin_received", "notify_admin"),
  ],
};

const published: RecipeRow = {
  id: "00000000-0000-4000-8000-000000000002",
  trigger: "property.published",
  name: "Property published",
  enabled: false,
  version: 4,
  steps: [
    step("purge_cache", "purge_cache"),
    step("render_carousel", "render_carousel"),
    step("post_meta", "post_meta", { params: { channels: "from_settings" } }),
    step("render_cover", "render_cover"),
  ],
};

const catalog: StepSpecView[] = [
  {
    type: "send_email",
    label: "Send email",
    description: "Sends one email template to the person the event is about.",
    heavy: false,
    local: false,
    implemented: true,
    fields: [
      { key: "template", label: "Template", kind: "text", required: true },
      {
        key: "to",
        label: "Recipient",
        kind: "select",
        options: [
          { value: "submitter", label: "Submitter" },
          { value: "admins", label: "Admins" },
        ],
      },
    ],
  },
  {
    type: "notify_admin",
    label: "Notify admins",
    description: "Sends a short notice to the admins.",
    heavy: false,
    local: false,
    implemented: true,
    fields: [{ key: "headline", label: "Headline", kind: "text", hint: "Variables are allowed." }],
  },
  {
    type: "purge_cache",
    label: "Purge cache",
    description: "Asks the edge cache to forget pages that changed.",
    heavy: false,
    local: false,
    implemented: true,
    fields: [
      {
        key: "scope",
        label: "Scope",
        kind: "select",
        options: [
          { value: "catalog", label: "Catalog" },
          { value: "all", label: "Everything" },
        ],
        default: "catalog",
      },
      { key: "indexnow", label: "Ping search engines", kind: "boolean", default: false },
    ],
  },
  {
    type: "render_carousel",
    label: "Render carousel",
    description: "Renders the carousel.",
    heavy: true,
    local: false,
    implemented: true,
    fields: [
      { key: "max_slides", label: "Most slides", kind: "number", default: 8, min: 6, max: 8 },
    ],
  },
  {
    type: "post_meta",
    label: "Post to Meta",
    description: "Posts the approved asset to Instagram, or to Facebook when its channel is on.",
    heavy: false,
    local: false,
    implemented: true,
    fields: [
      {
        key: "channels",
        label: "Channels",
        kind: "multiselect",
        options: [
          { value: "instagram", label: "Instagram" },
          { value: "facebook", label: "Facebook" },
        ],
        default: "from_settings",
        hint: "Empty uses the enabled channels in settings.",
      },
    ],
  },
  {
    type: "render_cover",
    label: "Render cover",
    description: "Renders the cover image of the property.",
    heavy: true,
    local: false,
    implemented: false,
    fields: [],
  },
];

const dryRunAnswer = {
  trigger: "submission.received",
  recipe_enabled: true,
  planned: [
    {
      step_id: "send_received",
      type: "send_email",
      heavy: false,
      run_local: false,
      status: "queued",
    },
  ],
  skipped: [{ step_id: "notify_admin_received", type: "notify_admin", reason: "step_disabled" }],
  warnings: [
    {
      code: "template_missing",
      step_id: "send_received",
      message: "The email template received does not exist.",
    },
  ],
};

const editor = ["automation.get", "automation.recipes_put", "automation.dry_run"];

const me = (actions: string[]): AdminMe => ({
  actor: { id: "u1" },
  kind: "human",
  roles: ["chief_editor"],
  scopes: [],
  actions,
  environment: "production",
});

const putBody = z.object({ name: z.string(), enabled: z.boolean(), steps: z.array(stepSchema) });

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The automation API as the Worker answers it: the recipes it holds now (a write replaces one and bumps its version,
 * so the next read shows it), a refusal on request, and a fixed dry run. `requests` lists `METHOD path body` in order.
 */
function open(trigger: string, options: { actions?: string[]; refuse?: string } = {}) {
  let held = [received, published];
  const requests: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    requests.push(`${method} ${path}${typeof init.body === "string" ? ` ${init.body}` : ""}`);
    if (method === "GET" && path === RECIPES) {
      return Promise.resolve(Response.json({ items: held, steps: catalog }));
    }
    if (method === "PUT" && path.startsWith(`${RECIPES}/`)) {
      if (options.refuse !== undefined) {
        return Promise.resolve(
          Response.json(
            { error: { code: "validation", message: options.refuse } },
            { status: 422 },
          ),
        );
      }
      const target = decodeURIComponent(path.slice(RECIPES.length + 1));
      const patch = putBody.parse(JSON.parse(typeof init.body === "string" ? init.body : "null"));
      const base = held.find((recipe) => recipe.trigger === target) ?? received;
      const next = { ...base, ...patch, version: base.version + 1 };
      held = held.map((recipe) => (recipe.trigger === target ? next : recipe));
      return Promise.resolve(Response.json(next));
    }
    if (method === "POST" && path === DRY_RUN) return Promise.resolve(Response.json(dryRunAnswer));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const layout = () => (
    <QueryClientProvider client={client}>
      <AdminMeContext value={me(options.actions ?? editor)}>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </AdminMeContext>
    </QueryClientProvider>
  );
  mountRoutes(layout, `/admin/automation/recipes?trigger=${trigger}`, (root) => [
    pageRoute(root, "/admin/automation/recipes", () => <RecipesPage />),
  ]);
  return {
    requests,
    reads: () => requests.filter((request) => request === `GET ${RECIPES}`).length,
    /** The body of the last write to `path`, parsed. */
    sent: (path: string): unknown => {
      const found = requests.filter((request) => request.startsWith(`PUT ${path} `)).at(-1);
      return JSON.parse(found?.slice(`PUT ${path} `.length) ?? "null");
    },
  };
}

const card = (label: string) => {
  const found = screen.getByText(label, { selector: "strong" }).closest("li");
  if (found === null) throw new Error(`no step card for ${label}`);
  return within(found);
};

const ready = (name: string) => screen.findByRole("article", { name });

const save = () => {
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
};

describe("RecipesPage", () => {
  it("lists a recipe per event with its state and step count, and opens the one in the address", async () => {
    open("property.published");
    const list = await screen.findByRole("navigation", { name: "Events" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("2 steps")).toBeTruthy();
    expect(within(list).getByText("4 steps")).toBeTruthy();
    expect(within(list).getByText("Off")).toBeTruthy();
    expect(
      within(list)
        .getByRole("button", { name: /Property published/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    await ready("Property published");
    expect(card("Purge cache")).toBeTruthy();
    expect(card("Post to Meta")).toBeTruthy();
  });

  it("asks to choose an event when none is open, and opens one from the list", async () => {
    open("");
    expect(await screen.findByText("Choose an event")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Submission received/ }));
    expect(await ready("Submission received")).toBeTruthy();
  });

  it("marks a step the catalog has not built yet", async () => {
    open("property.published");
    await ready("Property published");
    expect(card("Render cover").getByText("Not built yet")).toBeTruthy();
    expect(card("Purge cache").queryByText("Not built yet")).toBeNull();
    expect(card("Render carousel").getByText("Heavy")).toBeTruthy();
  });
});

describe("the settings of a step", () => {
  it("draw one control per field of the spec, with its options, hint, limits and default", async () => {
    open("property.published");
    await ready("Property published");
    const purge = card("Purge cache");
    const scope = purge.getByLabelText("Scope");
    expect(
      within(scope)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Default", "Catalog", "Everything"]);
    expect(purge.getByLabelText("Ping search engines")).toHaveProperty("checked", false);
    const slides = card("Render carousel").getByLabelText("Most slides");
    expect(slides.getAttribute("min")).toBe("6");
    expect(slides.getAttribute("max")).toBe("8");
    expect(slides.getAttribute("placeholder")).toBe("8");
    const meta = card("Post to Meta");
    expect(meta.getByText("Empty uses the enabled channels in settings.")).toBeTruthy();
    expect(meta.getAllByRole("checkbox", { name: /Instagram|Facebook/ })).toHaveLength(2);
  });

  it("are written only for the keys the person set, and a key set back to default is dropped", async () => {
    const api = open("property.published");
    await ready("Property published");
    const purge = card("Purge cache");
    fireEvent.change(purge.getByLabelText("Scope"), { target: { value: "all" } });
    fireEvent.click(purge.getByLabelText("Ping search engines"));
    fireEvent.change(card("Render carousel").getByLabelText("Most slides"), {
      target: { value: "7" },
    });
    fireEvent.click(card("Post to Meta").getByLabelText("Facebook"));
    save();
    await screen.findByText("Recipe saved. It applies to the next event.");
    expect(api.sent(`${RECIPES}/property.published`)).toMatchObject({
      steps: [
        { id: "purge_cache", params: { scope: "all", indexnow: true } },
        { id: "render_carousel", params: { max_slides: 7 } },
        { id: "post_meta", params: { channels: ["facebook"] } },
        { id: "render_cover", params: {} },
      ],
    });
    fireEvent.change(card("Purge cache").getByLabelText("Scope"), { target: { value: "" } });
    fireEvent.change(card("Render carousel").getByLabelText("Most slides"), {
      target: { value: "" },
    });
    fireEvent.click(card("Post to Meta").getByLabelText("Facebook"));
    save();
    await waitFor(() => {
      expect(api.reads()).toBe(3);
    });
    expect(api.sent(`${RECIPES}/property.published`)).toMatchObject({
      steps: [
        { id: "purge_cache", params: { indexnow: true } },
        { id: "render_carousel", params: {} },
        { id: "post_meta", params: {} },
        { id: "render_cover", params: {} },
      ],
    });
  });

  it("stop a save with a message under the field when a required value is empty or a number is out of range", async () => {
    const api = open("submission.received");
    await ready("Submission received");
    fireEvent.change(card("Send email").getByLabelText("Template"), { target: { value: "" } });
    save();
    expect(await card("Send email").findByText("Required")).toBeTruthy();
    expect(api.requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  });

  it("refuse a number over the limit of its field", async () => {
    const api = open("property.published");
    await ready("Property published");
    fireEvent.change(card("Render carousel").getByLabelText("Most slides"), {
      target: { value: "9" },
    });
    save();
    expect(await card("Render carousel").findByText("At most 8")).toBeTruthy();
    expect(api.requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  });
});

describe("the conditions of a step", () => {
  it("are written as the groups picked, and a group with nothing picked is left out", async () => {
    const api = open("submission.received");
    await ready("Submission received");
    const notify = card("Notify admins");
    fireEvent.click(notify.getByLabelText("Campaign"));
    fireEvent.click(notify.getByLabelText("Florida"));
    save();
    await screen.findByText("Recipe saved. It applies to the next event.");
    expect(api.sent(`${RECIPES}/submission.received`)).toMatchObject({
      steps: [
        { id: "send_received", conditions: {} },
        { id: "notify_admin_received", conditions: { tiers: ["Campaign"], markets: ["florida"] } },
      ],
    });
    fireEvent.click(card("Notify admins").getByLabelText("Campaign"));
    save();
    await waitFor(() => {
      expect(api.reads()).toBe(3);
    });
    expect(api.sent(`${RECIPES}/submission.received`)).toMatchObject({
      steps: [{}, { conditions: { markets: ["florida"] } }],
    });
  });
});

describe("saving a recipe", () => {
  it("sends the changed recipe, refetches the recipes through the query and shows what the server holds", async () => {
    const api = open("submission.received");
    await ready("Submission received");
    expect(api.reads()).toBe(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Send email: on" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Request received" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    save();
    await waitFor(() => {
      expect(api.reads()).toBe(2);
    });
    expect(api.sent(`${RECIPES}/submission.received`)).toMatchObject({
      name: "Request received",
      enabled: true,
      steps: [
        { id: "send_received", enabled: false },
        { id: "notify_admin_received", enabled: true },
      ],
    });
    expect(
      await within(screen.getByRole("navigation", { name: "Events" })).findByText(
        "Request received",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });
    expect(screen.getByRole("checkbox", { name: "Send email: on" })).toHaveProperty(
      "checked",
      false,
    );
  });

  it("shows the server's refusal and keeps the draft", async () => {
    const api = open("submission.received", { refuse: "That recipe could not be saved." });
    await ready("Submission received");
    fireEvent.click(screen.getByRole("checkbox", { name: "Notify admins: on" }));
    save();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That recipe could not be saved.",
    );
    expect(screen.getByRole("checkbox", { name: "Notify admins: on" })).toHaveProperty(
      "checked",
      false,
    );
    expect(api.requests.filter((request) => request.startsWith("PUT"))).toHaveLength(1);
  });

  it("puts steps in the order chosen, drops a removed one and names an added one without clashing", async () => {
    const api = open("property.published");
    await ready("Property published");
    fireEvent.click(screen.getByRole("button", { name: "Move Purge cache down" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Render cover" }));
    fireEvent.change(screen.getByLabelText("Add a step"), { target: { value: "purge_cache" } });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    save();
    await screen.findByText("Recipe saved. It applies to the next event.");
    const body = putBody.parse(api.sent(`${RECIPES}/property.published`));
    expect(body.steps.map((item) => item.id)).toEqual([
      "render_carousel",
      "purge_cache",
      "post_meta",
      "purge_cache_2",
    ]);
  });

  it("can be discarded back to what the server holds", async () => {
    const api = open("submission.received");
    await ready("Submission received");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Submission received");
    expect(api.requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  });

  it("leaves a person without the recipes permission with the recipe to read and no Save", async () => {
    open("submission.received", { actions: ["automation.get"] });
    await ready("Submission received");
    expect(screen.queryByRole("button", { name: "Save recipe" })).toBeNull();
    expect(screen.getByLabelText("Name").matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Run dry run" })).toBeNull();
  });
});

describe("the dry run", () => {
  it("plans the saved recipe for the trigger, then lists what would queue, what would skip and why", async () => {
    const api = open("submission.received");
    await ready("Submission received");
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    const result = await screen.findByRole("heading", { name: "Would queue" });
    expect(api.requests.filter((request) => request.startsWith("POST"))).toEqual([
      `POST ${DRY_RUN} ${JSON.stringify({ trigger: "submission.received" })}`,
    ]);
    const panel = within(result.closest("section") ?? document.body);
    expect(panel.getByText("Queued")).toBeTruthy();
    expect(panel.getByText("The step is off")).toBeTruthy();
    expect(panel.getByText("The email template received does not exist.")).toBeTruthy();
  });

  it("sends the record id when one is given, refuses one that is not an id, and warns of unsaved edits", async () => {
    const api = open("submission.received");
    await ready("Submission received");
    fireEvent.change(screen.getByLabelText("Record id"), { target: { value: "not an id" } });
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    expect(await screen.findByText(/Use the id of a record/)).toBeTruthy();
    expect(api.requests.filter((request) => request.startsWith("POST"))).toEqual([]);
    expect(screen.queryByText(/not your unsaved changes/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited" } });
    expect(screen.getByText(/not your unsaved changes/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Record id"), { target: { value: RECORD } });
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await screen.findByRole("heading", { name: "Would queue" });
    expect(api.requests.filter((request) => request.startsWith("POST"))).toEqual([
      `POST ${DRY_RUN} ${JSON.stringify({ trigger: "submission.received", entity_id: RECORD })}`,
    ]);
  });
});
