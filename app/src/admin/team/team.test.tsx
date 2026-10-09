import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serveAdmin as serve } from "../../../tests/fixtures/admin-serve";
import type { TeamUser } from "../../domain/admin-team";
import { standInForDialogs } from "../ui/test-dialog";
import { AdminProviders } from "../ui/test-providers";
import { TeamPage } from "./TeamPage";

const ADA = "00000000-0000-4000-8000-0000000000a1";
const BOT = "00000000-0000-4000-8000-0000000000b1";
const USERS = "/api/admin/team/users";

const person = (over: Partial<TeamUser> = {}): TeamUser => ({
  user_id: ADA,
  email: "ada@example.invalid",
  display_name: "Ada",
  roles: ["admin", "managing_editor"],
  actor_kind: "human",
  disabled: false,
  last_active_at: null,
  ...over,
});

const reads = (
  limits: unknown = { decisions_per_day: 50, publish_per_day: 5, requests_per_day: 5000 },
) => ({
  [`GET ${USERS}`]: {
    items: [
      person(),
      person({
        user_id: BOT,
        email: "bot@agents.invalid",
        display_name: "Queue bot",
        roles: ["media_ops"],
        actor_kind: "agent",
      }),
    ],
    next_cursor: null,
  },
  "GET /api/admin/team/agents": { items: [], next_cursor: null },
  "GET /api/admin/team/limits": limits,
});

const writes = (requested: string[]) => requested.filter((line) => !line.startsWith("GET "));

function mount() {
  return render(
    <AdminProviders actions={[]}>
      <TeamPage />
    </AdminProviders>,
  );
}

beforeAll(standInForDialogs);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("screen 23", () => {
  it("asks before disabling an account, sends nothing on Cancel, and posts disabled true only once confirmed", async () => {
    const requested = serve({
      ...reads(),
      [`POST ${USERS}/${ADA}/disable`]: { user_id: ADA, disabled: true },
    });
    mount();
    const row = (await screen.findByText("ada@example.invalid")).closest("tr");
    if (row === null) throw new Error("no row for Ada");
    const disable = within(row).getByRole("button", { name: "Disable" });
    fireEvent.click(disable);
    const before = writes(requested);
    const asked = await screen.findByRole("dialog", { name: "Disable this account" });
    fireEvent.click(within(asked).getByRole("button", { name: "Cancel" }));
    const cancelled = writes(requested);
    fireEvent.click(disable);
    const dialog = await screen.findByRole("dialog", { name: "Disable this account" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable account" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([`POST ${USERS}/${ADA}/disable {"disabled":true}`]);
    });
    expect({ before, cancelled }).toEqual({ before: [], cancelled: [] });
  });

  it("asks before removing a role and sends the DELETE only once confirmed", async () => {
    const requested = serve({ ...reads(), [`DELETE ${USERS}/${ADA}/roles/admin`]: {} });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Administrator from Ada" }));
    const before = writes(requested);
    const dialog = await screen.findByRole("dialog", { name: "Remove a role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove role" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([`DELETE ${USERS}/${ADA}/roles/admin`]);
    });
    expect(before).toEqual([]);
  });

  it("asks before sending an invitation and posts it only once confirmed", async () => {
    const requested = serve({ ...reads(), [`POST ${USERS}`]: { user_id: "new" } });
    mount();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Nell" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Visual Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    const before = writes(requested);
    const dialog = await screen.findByRole("dialog", { name: "Send an invitation" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await waitFor(() => {
      expect(writes(requested)).toEqual([
        `POST ${USERS} {"email":"new@example.invalid","display_name":"Nell","roles":["visual_editor"]}`,
      ]);
    });
    expect(before).toEqual([]);
  });

  it("offers Add a role on a person but not on an agent, which keeps the role it was made with", async () => {
    serve(reads());
    mount();
    await screen.findByText("bot@agents.invalid");
    expect({
      person: screen.queryByRole("combobox", { name: "Add a role to Ada" }) !== null,
      agent: screen.queryByRole("combobox", { name: "Add a role to Queue bot" }) !== null,
    }).toEqual({ person: true, agent: false });
  });

  it("shows a failed limits read with its request id instead of loading forever", async () => {
    serve(
      reads(
        Response.json(
          { error: { code: "server", message: "Something went wrong.", requestId: "req-7" } },
          { status: 500 },
        ),
      ),
    );
    mount();
    const section = screen.getByRole("region", { name: "Agent daily limits" });
    expect((await within(section).findByRole("alert")).textContent).toBe(
      "Something went wrong. Request req-7.",
    );
  });
});
