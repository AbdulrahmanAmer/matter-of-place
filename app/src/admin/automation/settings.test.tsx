import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { channelSettingsSchema, type Channel } from "../../domain/automation";
import { SettingsPage } from "./SettingsPage";
import { mountAdminPage } from "./test-mount";

const BASE = "/api/admin/automation";
const HEALTH = "/api/admin/channels/health";

// The secret name a row carries on the wire; the screen must never draw it (G-006).
const SECRET = "meta_app_secret_name";

const window9to6 = (tz: string) => ({
  days: [1, 2, 3, 4, 5],
  from: "09:00",
  to: "18:00",
  tz,
  daily_cap: 2,
});

interface ChannelWire {
  channel: Channel;
  enabled: boolean;
  posting_window: ReturnType<typeof window9to6>;
  approval_mode: Record<"Feature" | "Reach" | "Campaign", "manual" | "auto">;
  auto_after: string | null;
  credentials_ref: string;
}

interface ScheduleWire {
  key: string;
  cron: string;
  interval_days: number | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

const channelRow = (channel: Channel, tz = "America/Los_Angeles"): ChannelWire => ({
  channel,
  enabled: channel === "newsletter",
  posting_window: window9to6(tz),
  approval_mode: { Feature: "manual", Reach: "manual", Campaign: "manual" },
  auto_after: null,
  credentials_ref: SECRET,
});

const channelRows: ChannelWire[] = [
  channelRow("instagram"),
  channelRow("x"),
  channelRow("linkedin", "Europe/London"),
  channelRow("facebook"),
  channelRow("youtube"),
  channelRow("newsletter"),
];

const scheduleRows: ScheduleWire[] = [
  {
    key: "digest",
    cron: "0 14 * * 2",
    interval_days: 14,
    enabled: false,
    last_run_at: null,
    next_run_at: "2026-10-13T14:00:00.000Z",
  },
  {
    key: "keepwarm",
    cron: "*/10 * * * *",
    interval_days: null,
    enabled: true,
    last_run_at: "2026-10-08T10:00:00.000Z",
    next_run_at: "2026-10-08T10:10:00.000Z",
  },
];

const health = (channel: string, connected: boolean, daysLeft: number | null) => ({
  channel,
  connected,
  level: "ok",
  label: null,
  lastPost: null,
  lastError: null,
  token: {
    expiresAt: daysLeft === null ? null : "2026-10-20T00:00:00.000Z",
    daysLeft,
    level: "ok",
  },
});

const editor = ["automation.get", "automation.channels_put", "automation.schedules_put"];

const channelBody = z.object({
  enabled: z.boolean(),
  posting_window: channelSettingsSchema.shape.posting_window,
  approval_mode: channelSettingsSchema.shape.approval_mode,
  auto_after: channelSettingsSchema.shape.auto_after,
});
const scheduleBody = z.object({
  enabled: z.boolean().optional(),
  cron: z.string().optional(),
  interval_days: z.number().nullable().optional(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const bodyOf = (init: RequestInit): unknown =>
  JSON.parse(typeof init.body === "string" ? init.body : "null");

interface Options {
  actions?: string[];
  flags?: { new_channels: boolean };
  /** `null` is a Worker without B10's route: it answers 404. */
  health?: unknown[] | null;
}

/**
 * The automation API and the health route as the Worker answers them, with the rows it holds now (a write merges the
 * patch and the next read shows it). `bodies` holds what each write sent, by `METHOD path`.
 */
function open(options: Options = {}) {
  let channels = [...channelRows];
  let schedules = [...scheduleRows];
  const bodies: Record<string, unknown[]> = {};
  const answer = (path: string, init: RequestInit): Response => {
    const method = init.method ?? "GET";
    if (method !== "GET") (bodies[`${method} ${path}`] ??= []).push(bodyOf(init));
    if (path === `${BASE}/channel-settings` && method === "GET") {
      return Response.json({ items: channels });
    }
    if (path.startsWith(`${BASE}/channel-settings/`) && method === "PUT") {
      const channel = path.slice(`${BASE}/channel-settings/`.length);
      const patch = channelBody.parse(bodyOf(init));
      channels = channels.map((row) => (row.channel === channel ? { ...row, ...patch } : row));
      return Response.json(channels.find((row) => row.channel === channel));
    }
    if (path === `${BASE}/schedule-settings` && method === "GET") {
      return Response.json({ items: schedules });
    }
    if (path.startsWith(`${BASE}/schedule-settings/`) && method === "PUT") {
      const key = path.slice(`${BASE}/schedule-settings/`.length);
      const patch = scheduleBody.parse(bodyOf(init));
      schedules = schedules.map((row) =>
        row.key === key
          ? {
              ...row,
              enabled: patch.enabled ?? row.enabled,
              cron: patch.cron ?? row.cron,
              interval_days:
                patch.interval_days === undefined ? row.interval_days : patch.interval_days,
            }
          : row,
      );
      return Response.json(schedules.find((row) => row.key === key));
    }
    if (path === `${BASE}/flags` && method === "GET") {
      return Response.json({
        new_channels: options.flags?.new_channels ?? false,
        archive_pages: false,
        csp_enforce: false,
        maintenance: false,
        coming_soon: false,
      });
    }
    if (path === HEALTH && options.health !== null && options.health !== undefined) {
      return Response.json(options.health);
    }
    return new Response("{}", { status: 404 });
  };
  mountAdminPage({
    actions: options.actions ?? editor,
    path: "/admin/automation/settings",
    page: <SettingsPage />,
    answer,
  });
  return {
    last: (request: string): unknown => bodies[request]?.at(-1),
    count: (request: string) => bodies[request]?.length ?? 0,
  };
}

const channel = (name: string) => within(screen.getByRole("article", { name }));

const ready = () => screen.findByRole("article", { name: "Instagram" });

describe("a channel's window", () => {
  it("saves a window in America/New_York and reads it back with that zone", async () => {
    const api = open();
    await ready();
    fireEvent.change(channel("Instagram").getByLabelText("Time zone"), {
      target: { value: "America/New_York" },
    });
    fireEvent.click(channel("Instagram").getByRole("button", { name: "Save Instagram" }));
    await screen.findByText("Instagram saved.");
    expect(channelBody.parse(api.last(`PUT ${BASE}/channel-settings/instagram`))).toMatchObject({
      posting_window: { tz: "America/New_York", from: "09:00", to: "18:00", daily_cap: 2 },
    });
    await waitFor(() => {
      expect(channel("Instagram").getByLabelText("Time zone")).toHaveProperty(
        "value",
        "America/New_York",
      );
    });
    expect(channel("Instagram").queryByText("Unsaved changes")).toBeNull();
  });

  it("offers the three zones and keeps a stored zone that is another IANA name", async () => {
    open();
    await ready();
    const options = (name: string) =>
      channel(name)
        .getAllByRole("option", { hidden: true })
        .map((option) => option.getAttribute("value"));
    const zones = options("Instagram").filter((value) => value?.includes("/") || value === "UTC");
    expect(zones).toEqual(["America/Los_Angeles", "America/New_York", "UTC"]);
    expect(options("LinkedIn")).toContain("Europe/London");
    expect(channel("LinkedIn").getByLabelText("Time zone")).toHaveProperty(
      "value",
      "Europe/London",
    );
  });

  it("refuses a daily cap of 0 and sends nothing", async () => {
    const api = open();
    await ready();
    fireEvent.change(channel("Instagram").getByLabelText("Daily cap"), { target: { value: "0" } });
    fireEvent.click(channel("Instagram").getByRole("button", { name: "Save Instagram" }));
    expect(await screen.findByText("Use a whole number from 1 to 25")).toBeTruthy();
    expect(api.count(`PUT ${BASE}/channel-settings/instagram`)).toBe(0);
  });

  it("refuses a window that ends before it starts", async () => {
    const api = open();
    await ready();
    fireEvent.change(channel("Instagram").getByLabelText("To"), { target: { value: "08:00" } });
    fireEvent.click(channel("Instagram").getByRole("button", { name: "Save Instagram" }));
    expect(await screen.findByText("The window must start before it ends")).toBeTruthy();
    expect(api.count(`PUT ${BASE}/channel-settings/instagram`)).toBe(0);
  });
});

describe("the blocked channels", () => {
  it("keeps the Facebook and YouTube switches off while new channels is off", async () => {
    open({ flags: { new_channels: false } });
    await ready();
    expect(channel("Facebook").getByLabelText("Facebook on")).toHaveProperty("disabled", true);
    expect(channel("YouTube").getByLabelText("YouTube on")).toHaveProperty("disabled", true);
    expect(channel("Facebook").getByText("Not enabled yet.")).toBeTruthy();
  });

  it("lets Facebook be switched on once new channels is on, and keeps YouTube off", async () => {
    open({ flags: { new_channels: true } });
    await ready();
    await waitFor(() => {
      expect(channel("Facebook").getByLabelText("Facebook on")).toHaveProperty("disabled", false);
    });
    expect(channel("YouTube").getByLabelText("YouTube on")).toHaveProperty("disabled", true);
    expect(channel("YouTube").getByText("Not enabled yet.")).toBeTruthy();
  });
});

describe("sign-in status", () => {
  it("reads not connected when the health route is missing", async () => {
    open({ health: null });
    await ready();
    await waitFor(() => {
      expect(channel("Instagram").getByText("Not connected")).toBeTruthy();
    });
    expect(channel("Place Notes").queryByText("Sign-in")).toBeNull();
  });

  it("reads connected and expired from the health route and draws no secret", async () => {
    open({
      health: [
        health("instagram", true, 40),
        health("x", true, -3),
        health("linkedin", false, null),
      ],
    });
    await ready();
    await waitFor(() => {
      expect(channel("X").getByText("Expired")).toBeTruthy();
    });
    expect(channel("Instagram").getByText("Connected")).toBeTruthy();
    expect(channel("LinkedIn").getByText("Not connected")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});

describe("the clocks", () => {
  it("shows the next run in UTC and in the market zone, with the cron labelled UTC", async () => {
    open();
    const digest = within(await screen.findByRole("article", { name: "digest" }));
    expect(digest.getByText("Oct 13, 2026, 2:00 PM UTC")).toBeTruthy();
    expect(digest.getByText("Oct 13, 2026, 10:00 AM ET")).toBeTruthy();
    expect(digest.getByLabelText("Cron (UTC)")).toHaveProperty("value", "0 14 * * 2");
    expect(digest.getByText("Cadence: every 14 days")).toBeTruthy();
  });

  it("says that a clock moves against local time twice a year", async () => {
    open();
    await ready();
    expect(screen.getByText(/twice a year/)).toBeTruthy();
  });

  it("shows an external clock's cron read only, with its badge", async () => {
    open();
    const keepwarm = within(await screen.findByRole("article", { name: "keepwarm" }));
    expect(keepwarm.getByText("External clock")).toBeTruthy();
    expect(keepwarm.getByText("*/10 * * * *").tagName).toBe("CODE");
    expect(keepwarm.queryByLabelText("Cron (UTC)")).toBeNull();
  });

  it("saves a switched clock with its own cron and interval", async () => {
    const api = open();
    const digest = within(await screen.findByRole("article", { name: "digest" }));
    fireEvent.click(digest.getByLabelText("Clock on"));
    fireEvent.change(digest.getByLabelText("Days between runs"), { target: { value: "7" } });
    fireEvent.click(digest.getByRole("button", { name: "Save digest" }));
    await screen.findByText("digest saved.");
    expect(api.last(`PUT ${BASE}/schedule-settings/digest`)).toEqual({
      enabled: true,
      cron: "0 14 * * 2",
      interval_days: 7,
    });
  });

  it("sends no cron for an external clock", async () => {
    const api = open();
    const keepwarm = within(await screen.findByRole("article", { name: "keepwarm" }));
    fireEvent.click(keepwarm.getByLabelText("Clock on"));
    fireEvent.click(keepwarm.getByRole("button", { name: "Save keepwarm" }));
    await screen.findByText("keepwarm saved.");
    expect(api.last(`PUT ${BASE}/schedule-settings/keepwarm`)).toEqual({ enabled: false });
  });

  it("refuses a cron that has not five fields", async () => {
    const api = open();
    const digest = within(await screen.findByRole("article", { name: "digest" }));
    fireEvent.change(digest.getByLabelText("Cron (UTC)"), { target: { value: "0 14 *" } });
    fireEvent.click(digest.getByRole("button", { name: "Save digest" }));
    expect(await screen.findByText("Use five cron fields")).toBeTruthy();
    expect(api.count(`PUT ${BASE}/schedule-settings/digest`)).toBe(0);
  });
});

describe("a role without the write", () => {
  it("shows the settings and no save control", async () => {
    open({ actions: ["automation.get"] });
    await ready();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(channel("Instagram").getByLabelText("Time zone").matches(":disabled")).toBe(true);
  });
});
