import { Outlet } from "@tanstack/react-router";
import { fireEvent, screen, within } from "@testing-library/react";
import { createRoute } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { reportClientError } from "../../lib/report-error";
import { adminRouteOptions } from "../query";
import { AdminApiError } from "./admin-fetch";
import type { AdminMe } from "./admin-me";
import { AdminShell } from "./AdminShell";
import { mountRoutes, pageRoute } from "./test-router";

vi.mock("../../lib/report-error", () => ({ reportClientError: vi.fn() }));

const me: AdminMe = {
  actor: { id: "u1" },
  kind: "human",
  roles: ["managing_editor"],
  scopes: [],
  actions: [],
  environment: "production",
};

function Layout() {
  return (
    <AdminShell me={me}>
      <Outlet />
    </AdminShell>
  );
}

describe("an admin child route that fails", () => {
  it("renders AdminRouteError inside the shell with the request id", async () => {
    mountRoutes(Layout, "/admin/requests", (root) => [
      pageRoute(root, "/admin/"),
      createRoute({
        getParentRoute: () => root,
        path: "/admin/requests",
        ...adminRouteOptions(),
        loader: () => {
          throw new AdminApiError(500, "server", "The request failed.", "req-42");
        },
      }),
    ]);
    const main = await screen.findByRole("main");
    expect(await within(main).findByText("req-42")).not.toBeNull();
    expect(
      within(main).getByRole("heading", { name: "This screen did not open as it should." }),
    ).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "Admin" })).not.toBeNull();
  });

  it("calls reportClientError once, with the route and the request id", async () => {
    vi.mocked(reportClientError).mockClear();
    mountRoutes(Layout, "/admin/requests", (root) => [
      createRoute({
        getParentRoute: () => root,
        path: "/admin/requests",
        ...adminRouteOptions(),
        loader: () => {
          throw new AdminApiError(500, "server", "The request failed.", "req-43");
        },
      }),
    ]);
    await screen.findByText("req-43");
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith(expect.any(AdminApiError), {
      route: "/admin/requests",
      requestId: "req-43",
    });
  });

  it("offers Try again, which loads the route once more", async () => {
    let attempts = 0;
    mountRoutes(Layout, "/admin/requests", (root) => [
      createRoute({
        getParentRoute: () => root,
        path: "/admin/requests",
        ...adminRouteOptions(),
        loader: () => {
          attempts += 1;
          if (attempts === 1)
            throw new AdminApiError(500, "server", "The request failed.", "req-44");
          return "loaded";
        },
        component: () => <p>Requests loaded</p>,
      }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Requests loaded")).not.toBeNull();
    expect(attempts).toBe(2);
  });
});
