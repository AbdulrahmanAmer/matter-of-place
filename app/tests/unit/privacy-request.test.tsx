// B16 step 6: the privacy request form offers the four kinds, carries the honeypot, preselects from the link on the
// privacy page, tracks after a received request only, and keeps what was typed when the send fails.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PrivacyRequestForm } from "../../src/components/forms/privacy-request-form";
import { subjectRequestKinds } from "../../src/domain/contracts";
import type * as Analytics from "../../src/lib/analytics";
import { track } from "../../src/lib/analytics";
import { getTurnstileToken } from "../../src/lib/turnstile";
import { Route } from "../../src/routes/_site.privacy-request";
import { services, ServiceError } from "../../src/services";
import { createHttpServices } from "../../src/services/http";
import type { FetchImpl } from "../../src/services/http/client";

vi.mock("../../src/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof Analytics>()),
  track: vi.fn(),
}));
vi.mock("../../src/lib/turnstile", () => ({ getTurnstileToken: vi.fn() }));

const RECEIPT = { id: "r1", receivedAt: "2026-10-08T10:00:00Z" };

function fillAndSend(email = "reader@example.com", note = "Please check the 2024 form.") {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/Anything we should know/), { target: { value: note } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  vi.mocked(track).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the kinds offered", () => {
  it("equal subjectRequestKinds, four of them, and correction reads Correct my information", () => {
    render(<PrivacyRequestForm />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual([...subjectRequestKinds]);
    expect(radios).toHaveLength(4);
    expect(screen.getByLabelText("Correct my information").getAttribute("value")).toBe(
      "correction",
    );
  });

  it("renders one honeypot input named website", () => {
    const { container } = render(<PrivacyRequestForm />);
    expect(container.querySelectorAll('input[name="website"]')).toHaveLength(1);
  });
});

describe("the link from the privacy page", () => {
  it("preselects opt out from ?kind=opt_out and nothing for an unknown kind", () => {
    const { validateSearch } = Route.options;
    if (typeof validateSearch !== "function") throw new Error("the route has no validateSearch");
    const { kind } = z
      .object({ kind: z.enum(subjectRequestKinds).optional() })
      .parse(validateSearch({ kind: "opt_out" }));
    expect(validateSearch({ kind: "sell_it" })).toEqual({});
    render(<PrivacyRequestForm {...(kind === undefined ? {} : { kind })} />);
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: "Do not sell or share" }).checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: "Know what you hold about me" }).checked,
    ).toBe(false);
  });
});

describe("the link from the privacy page, through the stored page", () => {
  const path = "/privacy-request?kind=opt_out";
  const checkedKind = (root: ParentNode) =>
    root.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value;

  /** The page of the real route, with its own search validation, under a bare root: the document shell is not under test. */
  async function routerAt(location: string) {
    const { component, validateSearch } = Route.options;
    if (component === undefined) throw new Error("the route has no component");
    const root = createRootRoute({ component: Outlet });
    const page = createRoute({
      getParentRoute: () => root,
      id: Route.id,
      path: "/privacy-request",
      ...(validateSearch === undefined ? {} : { validateSearch }),
      component,
    });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history: createMemoryHistory({ initialEntries: [location] }),
    });
    await router.load();
    return createElement(RouterProvider, { router });
  }

  async function hydratedAt(location: string) {
    const stored = renderToString(await routerAt(location));
    const container = document.createElement("div");
    container.innerHTML = stored;
    document.body.append(container);
    const serverKind = checkedKind(container);
    await act(async () => {
      hydrateRoot(container, await routerAt(location));
    });
    return { container, serverKind };
  }

  async function send(container: HTMLElement) {
    const request = vi.spyOn(services.subjects, "request").mockResolvedValue({ ok: true });
    fireEvent.change(container.querySelector('input[name="email"]') ?? container, {
      target: { value: "reader@example.com" },
    });
    fireEvent.submit(container.querySelector("form") ?? container);
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    return request;
  }

  it("stores the page without the kind, then selects it after hydration and submits it", async () => {
    const { container, serverKind } = await hydratedAt(path);
    expect(serverKind).toBe("access");
    await waitFor(() => {
      expect(checkedKind(container)).toBe("opt_out");
    });
    const request = await send(container);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: "opt_out" }));
    container.remove();
  });

  it("submits the kind the visitor clicks after the link's kind was applied", async () => {
    const { container } = await hydratedAt(path);
    await waitFor(() => {
      expect(checkedKind(container)).toBe("opt_out");
    });
    fireEvent.click(container.querySelector('input[value="access"]') ?? container);
    expect(checkedKind(container)).toBe("access");
    const request = await send(container);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: "access" }));
    container.remove();
  });
});

describe("sending", () => {
  it("sends the kind, the email and the note, then tracks once and confirms", async () => {
    const request = vi.spyOn(services.subjects, "request").mockResolvedValue({ ok: true });
    render(<PrivacyRequestForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Correct my information" }));
    fillAndSend();
    expect(await screen.findByText(/We will reply within 45 days\./)).toBeTruthy();
    expect(request).toHaveBeenCalledWith({
      email: "reader@example.com",
      kind: "correction",
      note: "Please check the 2024 form.",
      website: "",
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("subject_request_submitted");
  });

  it("tracks nothing while the request is still on its way", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    vi.spyOn(services.subjects, "request").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<PrivacyRequestForm />);
    fillAndSend();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sending" })).toBeTruthy();
    });
    expect(track).not.toHaveBeenCalled();
    finish({ ok: true });
    await screen.findByText(/We received your request\./);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 422", new ServiceError("validation", "no", 422), "Please check the highlighted details."],
    [
      "a 500",
      new ServiceError("server", "down", 500),
      "This did not go through. Please try once more.",
    ],
  ])("keeps the typed values and tracks nothing after %s", async (_name, failure, message) => {
    vi.spyOn(services.subjects, "request").mockRejectedValue(failure);
    render(<PrivacyRequestForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Delete my information" }));
    fillAndSend("keep@example.com", "Please remove everything.");
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Email address" }).value).toBe(
      "keep@example.com",
    );
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Anything we should know/ }).value,
    ).toBe("Please remove everything.");
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: "Delete my information" }).checked,
    ).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("the http adapter", () => {
  const Init = z.object({ method: z.string(), headers: z.instanceof(Headers), body: z.string() });
  const bodyOf = (text: string) => z.record(z.string(), z.unknown()).parse(JSON.parse(text));

  it("posts to /subjects/request with x-turnstile-token from its own action and the honeypot as website", async () => {
    vi.mocked(getTurnstileToken).mockResolvedValue("tok");
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(Response.json(RECEIPT)));
    const { subjects } = createHttpServices("/api/public", fetchImpl);
    const answer = await subjects.request({
      email: "reader@example.com",
      kind: "access",
      website: "https://spam.invalid",
    });
    expect(answer).toEqual({ ok: true });
    expect(vi.mocked(getTurnstileToken)).toHaveBeenCalledWith("subjects-request");
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("no request was made");
    const init = Init.parse(call[1]);
    expect(call[0]).toBe("/api/public/subjects/request");
    expect(init.method).toBe("POST");
    expect(init.headers.get("x-turnstile-token")).toBe("tok");
    expect(bodyOf(init.body)).toEqual({
      website: "https://spam.invalid",
      email: "reader@example.com",
      kind: "access",
    });
  });

  it("sends an empty website when the form passes none, and refuses a 422 as validation", async () => {
    vi.mocked(getTurnstileToken).mockResolvedValue("tok");
    const fetchImpl = vi.fn<FetchImpl>(() =>
      Promise.resolve(Response.json({ error: {} }, { status: 422 })),
    );
    const { subjects } = createHttpServices("/api/public", fetchImpl);
    await expect(
      subjects.request({ email: "reader@example.com", kind: "deletion" }),
    ).rejects.toMatchObject({ kind: "validation", status: 422 });
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("no request was made");
    expect(bodyOf(Init.parse(call[1]).body)).toMatchObject({ website: "" });
  });
});
