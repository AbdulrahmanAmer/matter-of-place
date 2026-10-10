import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AdminProviders } from "../ui/test-providers";
import { FlagsSection } from "./FlagsSection";

const FLAGS = "/api/admin/automation/flags";

const putBody = z.record(z.string(), z.boolean());

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The flags route as the Worker answers it: a read of the five flags and a write that merges the names it is sent.
 * `writes` holds the body of each `PUT`.
 */
function open(actions: string[]) {
  let held = {
    new_channels: false,
    archive_pages: false,
    csp_enforce: false,
    maintenance: false,
    coming_soon: false,
  };
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    if (path !== FLAGS) return Promise.resolve(new Response("{}", { status: 404 }));
    if (init.method === "PUT") {
      const patch = putBody.parse(JSON.parse(typeof init.body === "string" ? init.body : "null"));
      writes.push(patch);
      held = { ...held, ...patch };
    }
    return Promise.resolve(Response.json(held));
  });
  render(
    <AdminProviders actions={actions}>
      <FlagsSection />
    </AdminProviders>,
  );
  return writes;
}

describe("the feature flags", () => {
  it("saves archive pages with one request and shows the saved state", async () => {
    const writes = open(["automation.get", "automation.flags_put"]);
    const box = await screen.findByLabelText("Archive pages");
    expect(box).toHaveProperty("checked", false);
    fireEvent.click(box);
    await screen.findByText("Archive pages saved.");
    expect(writes).toEqual([{ archive_pages: true }]);
    await waitFor(() => {
      expect(screen.getByLabelText("Archive pages")).toHaveProperty("checked", true);
    });
    expect(screen.getByLabelText("New channels")).toHaveProperty("checked", false);
  });

  it("describes each flag in a line", async () => {
    open(["automation.get"]);
    await screen.findByLabelText("Maintenance notice");
    expect(screen.getByText("Answers public pages with a short maintenance notice.")).toBeTruthy();
  });

  it("shows the flags to a role that cannot change them, switches disabled", async () => {
    const writes = open(["automation.get"]);
    const box = await screen.findByLabelText("Archive pages");
    expect(box).toHaveProperty("disabled", true);
    fireEvent.click(box);
    expect(writes).toEqual([]);
  });
});
