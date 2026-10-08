import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelHealth } from "../../domain/channels";
import { channelHealth } from "../../../tests/fixtures/channel-health";
import { ChannelHealthTile } from "./ChannelHealthTile";

const tokenAt = (daysLeft: number, level: ChannelHealth["level"]): ChannelHealth["token"] => ({
  expiresAt: "2026-10-20T00:00:00.000Z",
  daysLeft,
  level,
});

function mount(rows: ChannelHealth[] | Response) {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(rows instanceof Response ? rows : Response.json(rows)),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChannelHealthTile />
    </QueryClientProvider>,
  );
}

const channel = (name: string) => screen.getByRole("listitem", { name });
const findChannel = (name: string) => screen.findByRole("listitem", { name });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChannelHealthTile", () => {
  it("shows amber at 14 days left and red at 6", async () => {
    mount([
      channelHealth("instagram", { level: "amber", token: tokenAt(14, "amber") }),
      channelHealth("x", { level: "red", token: tokenAt(6, "red") }),
      channelHealth("linkedin"),
    ]);
    await screen.findByText("14 days left");
    expect({
      amber: within(channel("Instagram")).getByText("Attention").getAttribute("data-tone"),
      red: within(channel("X")).getByText("Reconnect needed").getAttribute("data-tone"),
      redDays: within(channel("X")).getByText("6 days left").tagName,
      ok: within(channel("LinkedIn")).getByText("Working").getAttribute("data-tone"),
    }).toEqual({ amber: "warning", red: "danger", redDays: "DD", ok: "ok" });
  });

  it("says never for a token with no expiry", async () => {
    mount([
      channelHealth("instagram", { token: { expiresAt: null, daysLeft: null, level: "ok" } }),
      channelHealth("x"),
      channelHealth("linkedin"),
    ]);
    expect(await within(await findChannel("Instagram")).findByText("Never expires")).toBeTruthy();
  });

  it("says not connected while a channel has no ids", async () => {
    mount([
      channelHealth("instagram", { connected: false, level: "red", token: tokenAt(0, "red") }),
      channelHealth("x"),
      channelHealth("linkedin"),
    ]);
    const item = await findChannel("Instagram");
    expect(within(item).getByText("Not connected")).toBeTruthy();
    expect(within(item).queryByText(/days? left/)).toBeNull();
  });

  it("is red for a dead token whatever days are left", async () => {
    mount([
      channelHealth("instagram", { level: "red", token: tokenAt(60, "ok") }),
      channelHealth("x"),
      channelHealth("linkedin"),
    ]);
    const item = await findChannel("Instagram");
    expect(within(item).getByText("Reconnect needed").getAttribute("data-tone")).toBe("danger");
    expect(within(item).getByText("60 days left")).toBeTruthy();
  });

  it("shows the last post and the last error of each channel", async () => {
    mount([
      channelHealth("instagram", {
        lastPost: { at: "2026-10-05T14:00:00Z", permalink: "https://www.instagram.com/p/AAA/" },
      }),
      channelHealth("x", { lastError: { at: "2026-10-06T09:00:00Z", error: "outcome_unknown" } }),
      channelHealth("linkedin"),
    ]);
    const first = await findChannel("Instagram");
    expect(within(first).getByRole("link", { name: "View post" }).getAttribute("href")).toBe(
      "https://www.instagram.com/p/AAA/",
    );
    expect(within(channel("X")).getByText(/outcome_unknown/)).toBeTruthy();
    expect(within(channel("LinkedIn")).getByText("None yet")).toBeTruthy();
  });

  it("leaves out Facebook, which is a disabled block", async () => {
    mount([
      channelHealth("instagram"),
      channelHealth("facebook"),
      channelHealth("x"),
      channelHealth("linkedin"),
    ]);
    await findChannel("Instagram");
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Instagram",
      "X",
      "LinkedIn",
    ]);
  });

  it("names the failure when the health cannot be read", async () => {
    mount(
      Response.json(
        { error: { code: "unavailable", message: "The database did not answer." } },
        { status: 503 },
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("The database did not answer.");
  });
});
