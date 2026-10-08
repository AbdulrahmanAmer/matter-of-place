import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { emailBlockSchema, sampleVariables, type EmailBlock } from "../../domain/email";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { AdminProviders } from "../ui/test-providers";
import type { TemplateRow } from "./automation-queries";
import { EmailsPage } from "./EmailsPage";

const TEMPLATES = "/api/admin/automation/templates";
const PREVIEW = `${TEMPLATES}/preview`;
const SEND_TEST = `${TEMPLATES}/received/send-test`;
const SITE = "https://matterofplace.com";

const received: TemplateRow = {
  key: "received",
  subject: "We have your request, {{submitter_name}}",
  preheader: "Thank you for sending {{property_address}}.",
  body: [
    { type: "heading", text: "Thank you, {{submitter_name}}", level: 1 },
    { type: "paragraph", text: "We have {{property_address}} in {{city}}, {{state}}." },
    { type: "facts", rows: [{ label: "Package", value: "{{package}}" }] },
    { type: "signature" },
  ],
  variables: ["submitter_name", "property_address", "city", "state", "package"],
  enabled: true,
  version: 3,
  class: "transactional",
};

const standalone: TemplateRow = {
  key: "standalone",
  subject: "A note from Matter of Place",
  preheader: "",
  body: [{ type: "paragraph", text: "Written by an editor." }],
  variables: [],
  enabled: false,
  version: 1,
  class: "transactional",
};

const editor = [
  "automation.get",
  "automation.templates_put",
  "automation.templates_preview",
  "automation.templates_send_test",
];

const putBody = z.object({
  subject: z.string(),
  preheader: z.string(),
  enabled: z.boolean(),
  body: z.array(emailBlockSchema),
});
const previewBody = z.object({ key: z.string(), variables: z.record(z.string(), z.string()) });

afterEach(() => {
  vi.unstubAllGlobals();
});

const bodyOf = (init: RequestInit): unknown =>
  JSON.parse(typeof init.body === "string" ? init.body : "null");

/**
 * The automation API as the Worker answers it: the templates it holds now (a write replaces one and bumps its version),
 * a stand-in for the preview route (the sample variables with the request's on top, as `previewTemplate` builds them,
 * written into the subject and one line of html; that it equals `renderTemplate` is tests/unit/automation/email-templates.test.ts),
 * and the test send. `requests` lists `METHOD path` in order.
 */
function open(key: string, options: { actions?: string[]; queued?: boolean } = {}) {
  let held = [received, standalone];
  const requests: string[] = [];
  const bodies: Record<string, unknown[]> = {};
  const answer = (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    requests.push(`${method} ${path}`);
    (bodies[`${method} ${path}`] ??= []).push(init.body === undefined ? null : bodyOf(init));
    if (method === "GET" && path === TEMPLATES) return Response.json({ items: held });
    if (method === "PUT" && path.startsWith(`${TEMPLATES}/`)) {
      const target = path.slice(TEMPLATES.length + 1);
      const patch = putBody.parse(bodyOf(init));
      const base = held.find((template) => template.key === target) ?? received;
      const next = { ...base, ...patch, version: base.version + 1 };
      held = held.map((template) => (template.key === target ? next : template));
      return Response.json(next);
    }
    if (method === "POST" && path === PREVIEW) {
      const asked = previewBody.parse(bodyOf(init));
      const row = held.find((template) => template.key === asked.key) ?? received;
      const values = { ...sampleVariables("received", SITE), ...asked.variables };
      const subject = row.subject.replace(
        /\{\{(\w+)\}\}/g,
        (_match, name: string) => values[name] ?? "",
      );
      const rendered = {
        subject,
        preheader: "",
        html: `<html><body><p>${subject}</p></body></html>`,
        text: subject,
      };
      return Response.json(rendered);
    }
    if (method === "POST" && path === SEND_TEST) {
      return Response.json({ queued: options.queued ?? true, to: "chief@matterofplace.com" });
    }
    return new Response("{}", { status: 404 });
  };
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) =>
    Promise.resolve(answer(path, init)),
  );
  const layout = () => (
    <AdminProviders actions={options.actions ?? editor}>
      <Outlet />
    </AdminProviders>
  );
  mountRoutes(layout, `/admin/automation/emails?key=${key}`, (root) => [
    pageRoute(root, "/admin/automation/emails", () => <EmailsPage />),
  ]);
  return {
    requests,
    count: (request: string) => requests.filter((entry) => entry === request).length,
    /** The body of the last request `METHOD path`, parsed. */
    last: (request: string): unknown => bodies[request]?.at(-1),
  };
}

const ready = (key: string) => screen.findByRole("article", { name: key });

const block = (label: string, position: number) => {
  const found = screen.getAllByText(label, { selector: "strong" }).at(position)?.closest("li");
  if (found === null || found === undefined)
    throw new Error(`no ${label} block at ${String(position)}`);
  return within(found);
};

/** Adds a button block at the end and fills it. */
const addButton = (label: string, link: string) => {
  fireEvent.change(screen.getByLabelText("Add a block"), { target: { value: "button" } });
  fireEvent.click(screen.getByRole("button", { name: "Add block" }));
  const added = block("Button", 0);
  fireEvent.change(added.getByLabelText("Label"), { target: { value: label } });
  fireEvent.change(added.getByLabelText("Link"), { target: { value: link } });
};

/** A save starts its request a tick after the click; a count of zero is read after that tick. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 25));

const frame = async () => {
  const found = await screen.findByTitle("Email preview");
  return found.getAttribute("srcdoc");
};

describe("EmailsPage", () => {
  it("lists a template per key with its state, and opens the one in the address", async () => {
    open("received");
    const list = await screen.findByRole("navigation", { name: "Templates" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Off")).toBeTruthy();
    expect(
      within(list)
        .getByRole("button", { name: /We have your request/ })
        .getAttribute("aria-current"),
    ).toBe("true");
    await ready("received");
    expect(screen.getByLabelText("Subject")).toHaveProperty(
      "value",
      "We have your request, {{submitter_name}}",
    );
  });

  it("asks to choose a template when none is open, and opens one from the list", async () => {
    open("");
    expect(await screen.findByText("Choose a template")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /A note from Matter of Place/ }));
    expect(await ready("standalone")).toBeTruthy();
    expect(screen.getByText("This email takes no variables.")).toBeTruthy();
  });
});

describe("the variables", () => {
  it("name what the template may use and mark those the text uses", async () => {
    open("received");
    await ready("received");
    const list = within(screen.getByRole("region", { name: "Variables" }));
    expect(list.getAllByRole("listitem")).toHaveLength(5);
    const used = list.getByText("{{city}}").closest("li");
    expect(within(used ?? document.body).getByText("Used")).toBeTruthy();
    expect(list.getByLabelText("Preview value for city").getAttribute("placeholder")).toBe(
      sampleVariables("received", SITE)["city"],
    );
  });

  it("warn about a name the template cannot supply, and keep Save from sending it", async () => {
    const api = open("received");
    await ready("received");
    expect(screen.queryByText(/Not available in this email/)).toBeNull();
    fireEvent.change(block("Paragraph", 0).getByLabelText("Text"), {
      target: { value: "Hello {{nickname}} and {{city}}" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Not available in this email: {{nickname}}. The email would not send with it. Remove it to save.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await settled();
    expect(api.count(`PUT ${TEMPLATES}/received`)).toBe(0);
  });
});

describe("the preview", () => {
  it("draws what the preview route answers for the sample variables", async () => {
    const api = open("received");
    await ready("received");
    await waitFor(async () => {
      expect(await frame()).toBe(
        "<html><body><p>We have your request, Jordan Lee</p></body></html>",
      );
    });
    expect(api.last(`POST ${PREVIEW}`)).toEqual({ key: "received", variables: {} });
    expect(screen.getAllByText("We have your request, Jordan Lee").length).toBeGreaterThan(0);
    expect(screen.getByText("Plain text")).toBeTruthy();
  });

  it("asks again with the values typed beside it and draws the new answer", async () => {
    const api = open("received");
    await ready("received");
    await frame();
    fireEvent.change(screen.getByLabelText("Preview value for submitter_name"), {
      target: { value: "Avery Quinn" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draw preview" }));
    await waitFor(async () => {
      expect(await frame()).toBe(
        "<html><body><p>We have your request, Avery Quinn</p></body></html>",
      );
    });
    expect(api.last(`POST ${PREVIEW}`)).toEqual({
      key: "received",
      variables: { submitter_name: "Avery Quinn" },
    });
    expect(api.count(`POST ${PREVIEW}`)).toBe(2);
  });

  it("says it shows the saved template while there are unsaved changes", async () => {
    open("received");
    await ready("received");
    expect(screen.queryByText(/Your unsaved changes are not in it/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Changed" } });
    expect(screen.getByText(/Your unsaved changes are not in it/)).toBeTruthy();
  });
});

describe("send test to me", () => {
  it("posts once to the send-test route of the template and says where it went", async () => {
    const api = open("received");
    await ready("received");
    const button = screen.getByRole("button", { name: "Send test to me" });
    fireEvent.click(button);
    expect(
      await screen.findByText("A test is on its way to chief@matterofplace.com."),
    ).toBeTruthy();
    expect(api.count(`POST ${SEND_TEST}`)).toBe(1);
  });

  it("says so when this minute already holds a test", async () => {
    open("received", { queued: false });
    await ready("received");
    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    expect(
      await screen.findByText("A test of this template was already queued this minute."),
    ).toBeTruthy();
  });

  it("waits for a save while there are unsaved changes, because it sends the saved template", async () => {
    const api = open("received");
    await ready("received");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Changed" } });
    const button = screen.getByRole("button", { name: "Send test to me" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText("Save first. The test sends the saved template.")).toBeTruthy();
    expect(api.count(`POST ${SEND_TEST}`)).toBe(0);
  });

  it("is not offered to a role the matrix leaves out", async () => {
    open("received", { actions: ["automation.get", "automation.templates_preview"] });
    await ready("received");
    expect(screen.queryByRole("button", { name: "Send test to me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
    expect(screen.getByLabelText("Subject").matches(":disabled")).toBe(true);
  });
});

describe("saving", () => {
  it("sends the four fields with the blocks as edited, then shows the new version", async () => {
    const api = open("received");
    await ready("received");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Received" } });
    fireEvent.click(screen.getByLabelText("Template on"));
    addButton("Open", "{{city}}");
    fireEvent.click(screen.getByRole("button", { name: "Move Button 5 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Heading 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await screen.findByText("Template saved. The next send uses it.");
    const sent = putBody.parse(api.last(`PUT ${TEMPLATES}/received`));
    expect(sent).toMatchObject({
      subject: "Received",
      preheader: received.preheader,
      enabled: false,
    });
    const types: EmailBlock["type"][] = sent.body.map((entry) => entry.type);
    expect(types).toEqual(["paragraph", "facts", "button", "signature"]);
    expect(sent.body[2]).toEqual({ type: "button", label: "Open", url: "{{city}}" });
    await waitFor(() => {
      expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Received");
    });
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("names the block and the field that are not ready, and sends nothing", async () => {
    const api = open("received");
    await ready("received");
    fireEvent.change(screen.getByLabelText("Add a block"), { target: { value: "paragraph" } });
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    const alerts = (await screen.findAllByRole("alert")).map((alert) => alert.textContent);
    expect(alerts).toEqual(["Required", "Required"]);
    expect(screen.getByLabelText("Subject").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Preheader").getAttribute("aria-invalid")).toBe("false");
    expect(block("Paragraph", 1).getByRole("alert").textContent).toBe("Required");
    await settled();
    expect(api.count(`PUT ${TEMPLATES}/received`)).toBe(0);
  });

  it("refuses a link that is not https, mailto or a variable", async () => {
    const api = open("received");
    await ready("received");
    addButton("Open", "http://example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(
      await screen.findByText("Use an https address, a mailto address or a variable"),
    ).toBeTruthy();
    await settled();
    expect(api.count(`PUT ${TEMPLATES}/received`)).toBe(0);
  });
});
