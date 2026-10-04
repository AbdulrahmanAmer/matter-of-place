// FE-09: the browser's side of `POST /client-error`. The module keeps its dedupe set in module state, so every
// test loads a fresh copy under a stubbed browser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const beaconBody = z.record(z.string(), z.unknown());

class FakeBlob {
  constructor(
    readonly parts: string[],
    readonly options: { type: string },
  ) {}
}

interface Sent {
  url: string;
  type: string;
  body: Record<string, unknown>;
}

function stubBrowser() {
  const sent: Sent[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("Blob", FakeBlob);
  vi.stubGlobal("navigator", {
    sendBeacon: (url: string, blob: FakeBlob) => {
      sent.push({
        url,
        type: blob.options.type,
        body: beaconBody.parse(JSON.parse(blob.parts.join(""))),
      });
      return true;
    },
  });
  vi.stubGlobal("window", {
    location: { pathname: "/properties" },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  });
  return { sent, listeners };
}

async function load() {
  vi.resetModules();
  return import("../../src/lib/report-error");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportClientError", () => {
  it("sends one JSON beacon to the client-error route with the message, stack and route", async () => {
    const { sent } = stubBrowser();
    const { reportClientError } = await load();
    reportClientError(new Error("boom"), { route: "/properties", requestId: "req-1" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: "/api/public/client-error",
      type: "application/json",
      body: { message: "boom", route: "/properties", requestId: "req-1" },
    });
    expect(typeof sent[0]?.body["stack"]).toBe("string");
  });

  it("sends two identical errors on one route as one beacon, and the same message on another route as a second", async () => {
    const { sent } = stubBrowser();
    const { reportClientError } = await load();
    reportClientError(new Error("same"), { route: "/a" });
    reportClientError(new Error("same"), { route: "/a" });
    expect(sent).toHaveLength(1);
    reportClientError(new Error("same"), { route: "/b" });
    expect(sent.map((beacon) => beacon.body["route"])).toEqual(["/a", "/b"]);
  });

  it("sends 12 distinct errors as 10 beacons", async () => {
    const { sent } = stubBrowser();
    const { reportClientError } = await load();
    for (let n = 0; n < 12; n += 1)
      reportClientError(new Error(`failure ${String(n)}`), { route: "/a" });
    expect(sent).toHaveLength(10);
  });

  it("cuts the stack to 2,048 characters, the message to 500 and the route to 200", async () => {
    const { sent } = stubBrowser();
    const { reportClientError } = await load();
    const error = new Error("m".repeat(900));
    error.stack = `Error: m\n${"    at frame (file.js:1:1)\n".repeat(400)}`;
    reportClientError(error, { route: `/${"r".repeat(400)}` });
    const body = sent[0]?.body;
    expect(String(body?.["stack"]).length).toBe(2048);
    expect(String(body?.["message"]).length).toBe(500);
    expect(String(body?.["route"]).length).toBe(200);
  });

  it("reports something that is not an Error by its text, with no stack", async () => {
    const { sent } = stubBrowser();
    const { reportClientError } = await load();
    reportClientError("plain text", { route: "/a" });
    expect(sent[0]?.body).toEqual({ message: "plain text", route: "/a" });
  });

  it("takes the request id from an error that carries one", async () => {
    const { sent } = stubBrowser();
    const { reportClientError } = await load();
    reportClientError(Object.assign(new Error("api"), { requestId: "req-from-api" }), {
      route: "/a",
    });
    expect(sent[0]?.body["requestId"]).toBe("req-from-api");
  });

  it("does nothing on the server", async () => {
    const { sent } = stubBrowser();
    vi.stubGlobal("window", undefined);
    const { reportClientError } = await load();
    reportClientError(new Error("ssr"), { route: "/a" });
    expect(sent).toHaveLength(0);
  });
});

describe("installClientErrorListeners", () => {
  it("adds one error and one unhandledrejection listener that report with the page path, and the remover takes both off", async () => {
    const { sent, listeners } = stubBrowser();
    const { installClientErrorListeners } = await load();
    const remove = installClientErrorListeners();
    expect([...listeners.keys()].sort()).toEqual(["error", "unhandledrejection"]);
    listeners.get("error")?.({ error: new Error("thrown"), message: "thrown" });
    listeners.get("error")?.({ error: undefined, message: "Script error." });
    listeners.get("unhandledrejection")?.({ reason: new Error("rejected") });
    expect(sent.map((beacon) => [beacon.body["message"], beacon.body["route"]])).toEqual([
      ["thrown", "/properties"],
      ["Script error.", "/properties"],
      ["rejected", "/properties"],
    ]);
    remove();
    expect(listeners.size).toBe(0);
  });
});
