import { Outlet } from "@tanstack/react-router";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AdminShell } from "./AdminShell";
import { adminFetch, bindAdminFetch } from "./admin-fetch";
import type { AdminMe } from "./admin-me";
import { RoleGate } from "./RoleGate";
import { mountRoutes, pageRoute } from "./test-router";

const me: AdminMe = {
  actor: { id: "u1" },
  kind: "human",
  roles: ["managing_editor"],
  scopes: ["submissions"],
  actions: ["submissions.list", "people.list"],
  environment: "production",
};

const shell = (actor: AdminMe) =>
  function Layout() {
    return (
      <AdminShell me={actor}>
        <Outlet />
      </AdminShell>
    );
  };

const IDS = ["/admin/", "/admin/requests/", "/admin/people/", "/admin/people/$id"];

async function mount(actor: AdminMe, at = "/admin", ids = IDS) {
  const router = mountRoutes(shell(actor), at, (root) => ids.map((id) => pageRoute(root, id)));
  await screen.findByRole("navigation", { name: "Admin" });
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminShell", () => {
  it("carries data-print hide on the shell, the top bar and the nav", async () => {
    await mount(me);
    const hidden = (selector: string) =>
      document.querySelector(selector)?.getAttribute("data-print");
    expect([hidden(".admin-shell"), hidden("header.admin-bar"), hidden("nav.admin-nav")]).toEqual([
      "hide",
      "hide",
      "hide",
    ]);
    expect(document.querySelector("main")?.closest("[data-print='hide']")).toBeNull();
  });

  it("names the environment on preview and local and says nothing on production", async () => {
    await mount({ ...me, environment: "preview" });
    expect(document.querySelector(".admin-env")?.textContent).toBe("preview");
  });

  it("shows no environment badge on production", async () => {
    await mount(me);
    expect(document.querySelector(".admin-env")).toBeNull();
  });

  it("shows who is signed in, with the agent pill for an agent", async () => {
    await mount({ ...me, kind: "agent" });
    expect(screen.getByText("Managing Editor")).not.toBeNull();
    expect(screen.getByText("Agent")).not.toBeNull();
  });

  it("opens the request list with the search text", async () => {
    const router = await mount(me);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search requests" }), {
      target: { value: "12 Alder & Co" },
    });
    fireEvent.submit(screen.getByRole("search"));
    await vi.waitFor(() => {
      const opened = new URL(router.state.location.href, "http://admin.test");
      expect([opened.pathname, opened.searchParams.get("search")]).toEqual([
        "/admin/requests",
        "12 Alder & Co",
      ]);
    });
  });

  it("links only the screens whose route exists and the actor may open", async () => {
    await mount(me);
    const links = within(screen.getByRole("navigation", { name: "Admin" })).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Dashboard", "Requests", "People"]);
  });

  it("keeps the People link marked while a person is open", async () => {
    await mount(me, "/admin/people/c1");
    expect(screen.getByRole("link", { name: "People" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Requests" }).hasAttribute("aria-current")).toBe(false);
  });

  it("shows the service banner after a 503 and removes it after an answer", async () => {
    await mount(me);
    bindAdminFetch({
      queryClient: new QueryClient(),
      currentPath: () => "/admin",
      navigate: vi.fn(),
    });
    const answer = (status: number) => () => Promise.resolve(Response.json({}, { status }));
    vi.stubGlobal("fetch", vi.fn(answer(503)));
    await act(() => adminFetch("/api/admin/dashboard", z.unknown()).catch(() => undefined));
    expect(screen.getByText("Service unavailable, retrying")).not.toBeNull();
    vi.stubGlobal("fetch", vi.fn(answer(200)));
    await act(() => adminFetch("/api/admin/dashboard", z.unknown()));
    expect(screen.queryByText("Service unavailable, retrying")).toBeNull();
  });
});

describe("RoleGate", () => {
  it("shows a control only for an action the actor holds", async () => {
    mountRoutes(shell(me), "/admin", (root) => [
      pageRoute(root, "/admin/", () => (
        <>
          <RoleGate action="people.list">
            <p>People tools</p>
          </RoleGate>
          <RoleGate action="team.invite">
            <p>Invite tools</p>
          </RoleGate>
        </>
      )),
    ]);
    expect(await screen.findByText("People tools")).not.toBeNull();
    expect(screen.queryByText("Invite tools")).toBeNull();
  });
});
