import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `src/lib/turnstile.ts` keeps the loading script in module state, so every test loads a fresh copy.
async function load() {
  vi.resetModules();
  return import("../../src/lib/turnstile");
}

type Options = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];

/** A widget that hands its options back to the test, which plays Cloudflare's part. */
function fakeApi() {
  const rendered: { container: HTMLElement; options: Options }[] = [];
  const api = {
    render: vi.fn((container: HTMLElement, options: Options) => {
      rendered.push({ container, options });
      return `widget-${String(rendered.length)}`;
    }),
    execute: vi.fn<(widgetId: string) => void>(),
    remove: vi.fn<(widgetId: string) => void>(),
  };
  return { api, rendered };
}

const scripts = () => [...document.head.querySelectorAll("script")];

beforeEach(() => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
});

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, "turnstile");
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("getTurnstileToken", () => {
  it("answers null with no site key, and loads nothing", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    const { getTurnstileToken } = await load();
    expect(await getTurnstileToken("inquiries")).toBeNull();
    expect(scripts()).toEqual([]);
    expect(document.getElementById("turnstile-host")).toBeNull();
  });

  it("runs an execute-mode widget for the action in one fixed container, and answers its token", async () => {
    const { api, rendered } = fakeApi();
    window.turnstile = api;
    const { getTurnstileToken } = await load();
    const pending = getTurnstileToken("inquiries");
    await vi.waitFor(() => {
      expect(api.execute).toHaveBeenCalledWith("widget-1");
    });
    const [first] = rendered;
    expect(first?.options).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "inquiries",
      execution: "execute",
    });
    expect(first?.container.id).toBe("turnstile-host");
    expect(first?.container.className).toBe("turnstile-host");
    first?.options.callback("token-1");
    expect(await pending).toBe("token-1");
    expect(api.remove).toHaveBeenCalledWith("widget-1");

    const second = getTurnstileToken("subscribers");
    await vi.waitFor(() => {
      expect(api.execute).toHaveBeenCalledWith("widget-2");
    });
    rendered[1]?.options.callback("token-2");
    expect(await second).toBe("token-2");
    expect(rendered[1]?.options.action).toBe("subscribers");
    expect(document.querySelectorAll("#turnstile-host")).toHaveLength(1);
  });

  it("answers null when Cloudflare reports an error or a timeout", async () => {
    const { api, rendered } = fakeApi();
    window.turnstile = api;
    const { getTurnstileToken } = await load();
    const failed = getTurnstileToken("inquiries");
    await vi.waitFor(() => {
      expect(api.execute).toHaveBeenCalledTimes(1);
    });
    rendered[0]?.options["error-callback"]();
    expect(await failed).toBeNull();
    const timedOut = getTurnstileToken("inquiries");
    await vi.waitFor(() => {
      expect(api.execute).toHaveBeenCalledTimes(2);
    });
    rendered[1]?.options["timeout-callback"]();
    expect(await timedOut).toBeNull();
    expect(api.remove).toHaveBeenCalledTimes(2);
  });

  it("loads the script once, on the first call, and renders when it has loaded", async () => {
    const { api, rendered } = fakeApi();
    const { getTurnstileToken } = await load();
    const first = getTurnstileToken("inquiries");
    const second = getTurnstileToken("subscribers");
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(api.render).not.toHaveBeenCalled();
    window.turnstile = api;
    scripts()[0]?.onload?.(new Event("load"));
    await vi.waitFor(() => {
      expect(rendered).toHaveLength(2);
    });
    rendered[0]?.options.callback("a");
    rendered[1]?.options.callback("b");
    expect(await Promise.all([first, second])).toEqual(["a", "b"]);
  });

  it("answers null when the script is blocked, and tries again on the next call", async () => {
    const { getTurnstileToken } = await load();
    const blocked = getTurnstileToken("inquiries");
    scripts()[0]?.onerror?.(new Event("error"));
    expect(await blocked).toBeNull();
    void getTurnstileToken("inquiries");
    expect(scripts()).toHaveLength(2);
  });
});
