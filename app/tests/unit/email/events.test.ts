import "../../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEmailEvent, resendEvent } from "../../../src/server/email/events";
import { handleResend } from "../../../src/server/hooks/resend";
import { env } from "../../../src/server/lib/env";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

// `applyEmailEvent` maps a verified Resend event to the one argument of `apply_email_event` and calls it once
// (invariant 9, G43). The client is `fakeDb`: it throws on any table or RPC the case did not register.

const ID = "msg_2LoMPUDSTzf5lEbmVR4DbQmgAj9";
const EMAIL_ID = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";
const AT = "2026-10-06T09:30:00.000Z";
const BOUNCE = { type: "Permanent", subType: "General", message: "The recipient is not there." };

const emailEvent = (type: string, data: Record<string, unknown> = {}) =>
  resendEvent.parse({
    type,
    created_at: AT,
    data: {
      email_id: EMAIL_ID,
      from: "Matter of Place <notify@notify.matterofplace.com>",
      to: ["owner@example.com"],
      tags: { env: "preview" },
      ...data,
    },
  });

const unsubscribe = (unsubscribed: boolean) =>
  resendEvent.parse({
    type: "contact.updated",
    created_at: AT,
    data: {
      id: "contact-1",
      audience_id: "aud-1",
      email: "reader@example.com",
      unsubscribed,
    },
  });

const rpcCalls = (db: FakeDb) => db.calls.filter((call) => call.kind === "rpc");

/** What went over the wire for each RPC: JSON drops the keys whose value is undefined. */
const wire = (db: FakeDb): unknown[] =>
  rpcCalls(db).map((call): unknown => JSON.parse(JSON.stringify(call.args[0])));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyEmailEvent", () => {
  const messageBase = {
    provider_event_id: ID,
    resend_email_id: EMAIL_ID,
    to_email: "owner@example.com",
    at: AT,
  };
  const cases = [
    {
      name: "email.sent",
      event: emailEvent("email.sent"),
      p: { ...messageBase, type: "email.sent", data: {} },
    },
    {
      name: "email.delivered",
      event: emailEvent("email.delivered"),
      p: { ...messageBase, type: "email.delivered", data: {} },
    },
    {
      name: "email.bounced Permanent",
      event: emailEvent("email.bounced", { bounce: BOUNCE }),
      p: { ...messageBase, type: "email.bounced", data: { bounce_type: "Permanent" } },
    },
    {
      name: "email.bounced Transient",
      event: emailEvent("email.bounced", { bounce: { ...BOUNCE, type: "Transient" } }),
      p: { ...messageBase, type: "email.bounced", data: { bounce_type: "Transient" } },
    },
    {
      name: "email.complained",
      event: emailEvent("email.complained"),
      p: { ...messageBase, type: "email.complained", data: {} },
    },
    {
      name: "email.clicked",
      event: emailEvent("email.clicked", {
        click: { link: "https://matterofplace.com/p/one", timestamp: AT },
      }),
      p: {
        ...messageBase,
        type: "email.clicked",
        data: { link: "https://matterofplace.com/p/one" },
      },
    },
    {
      name: "a Broadcast event",
      event: emailEvent("email.delivered", {
        broadcast_id: "bc-1",
        audience_id: "aud-1",
        tags: undefined,
      }),
      p: {
        ...messageBase,
        type: "email.delivered",
        broadcast_id: "bc-1",
        audience_id: "aud-1",
        data: {},
      },
    },
    {
      name: "contact.updated",
      event: unsubscribe(true),
      p: {
        provider_event_id: ID,
        type: "contact.updated",
        audience_id: "aud-1",
        to_email: "reader@example.com",
        at: AT,
        data: { unsubscribed: true },
      },
    },
  ];

  it.each(cases)("$name maps to p and makes one call and no table write", async (c) => {
    const db = fakeDb({ rpc: { apply_email_event: () => true } });
    await applyEmailEvent(db, { ...c.event, id: ID }, "preview");
    expect(db.calls).toMatchObject([
      { kind: "rpc", name: "apply_email_event", args: [{ p: c.p }] },
    ]);
  });

  it("click link: data.click.link becomes p.data.link and the rest of the click stays out", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => true } });
    const click = { link: "https://matterofplace.com/stories/one?utm=x", timestamp: AT };
    await applyEmailEvent(db, { ...emailEvent("email.clicked", { click }), id: ID }, "preview");
    expect(wire(db)).toMatchObject([
      { p: { data: { link: "https://matterofplace.com/stories/one?utm=x" } } },
    ]);
    expect(JSON.stringify(wire(db))).not.toContain("timestamp");
  });

  it("unsubscribed: a contact.updated takes the address from data.email and the flag into p.data", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => true } });
    await applyEmailEvent(db, { ...unsubscribe(true), id: ID }, "production");
    await applyEmailEvent(db, { ...unsubscribe(false), id: "msg_other" }, "production");
    expect(wire(db)).toMatchObject([
      { p: { to_email: "reader@example.com", data: { unsubscribed: true } } },
      { p: { provider_event_id: "msg_other", data: { unsubscribed: false } } },
    ]);
  });

  it("a recipient sent as a string is read as the one address", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => true } });
    await applyEmailEvent(
      db,
      { ...emailEvent("email.sent", { to: "single@example.com" }), id: ID },
      "preview",
    );
    expect(rpcCalls(db)[0]?.args[0]).toMatchObject({ p: { to_email: "single@example.com" } });
  });

  it("a false return, a replay, is a no-op", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => false } });
    await expect(
      applyEmailEvent(db, { ...emailEvent("email.sent"), id: ID }, "preview"),
    ).resolves.toBeUndefined();
    expect(rpcCalls(db)).toHaveLength(1);
  });

  it("an RPC error is thrown so the receipt can be forgotten", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => new Error("connection refused") } });
    await expect(
      applyEmailEvent(db, { ...emailEvent("email.sent"), id: ID }, "preview"),
    ).rejects.toMatchObject({ code: "server" });
  });

  it("foreign env: an event tagged production given to a preview handler makes no call and logs it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = fakeDb();
    const event = emailEvent("email.bounced", { bounce: BOUNCE, tags: { env: "production" } });
    await applyEmailEvent(db, { ...event, id: ID }, "preview");
    expect(db.calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ level: "info", event: "email_event_foreign_env", type: "email.bounced" }),
    );
  });

  it("foreign env: a contact.updated is judged by its audience in the database, never by tags", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => true } });
    const event = resendEvent.parse({
      type: "contact.updated",
      created_at: AT,
      data: { email: "reader@example.com", audience_id: "aud-1", tags: { env: "production" } },
    });
    await applyEmailEvent(db, { ...event, id: ID }, "preview");
    expect(rpcCalls(db)).toHaveLength(1);
  });

  it("an event tagged with its own env, or with none, goes through", async () => {
    const db = fakeDb({ rpc: { apply_email_event: () => true } });
    await applyEmailEvent(db, { ...emailEvent("email.sent"), id: ID }, "preview");
    await applyEmailEvent(db, { ...emailEvent("email.sent", { tags: {} }), id: ID }, "preview");
    expect(rpcCalls(db)).toHaveLength(2);
  });
});

describe("the hook", () => {
  const SECRET = "whsec_dGVzdC1zZWNyZXQtZm9yLXRoZS11bml0LXRlc3Rz";

  function delivery(event: object, id: string): Request {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
    const signature = createHmac("sha256", key)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return new Request("http://localhost/api/hooks/resend", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
      body,
    });
  }

  const hookEnv = (stage: "preview" | "production") => ({
    ...env,
    RESEND_WEBHOOK_SECRET: SECRET,
    MOP_ENV: stage,
  });

  const hookDb = (applied: () => boolean | Error = () => true) =>
    fakeDb({
      rpc: {
        record_webhook_receipt: () => true,
        forget_webhook_receipt: () => undefined,
        apply_email_event: applied,
      },
    });

  it("hands the svix-id and its own stage to applyEmailEvent", async () => {
    const db = hookDb();
    const sent = emailEvent("email.delivered");
    const answer = await handleResend(delivery(sent, ID), db, hookEnv("preview"));
    expect(answer.status).toBe(200);
    expect(rpcCalls(db).map((call) => call.name)).toEqual([
      "record_webhook_receipt",
      "apply_email_event",
    ]);
    expect(rpcCalls(db)[1]?.args[0]).toMatchObject({
      p: { provider_event_id: ID, type: "email.delivered" },
    });
  });

  it("drops an event of another stage after the receipt and answers 200", async () => {
    const db = hookDb();
    const answer = await handleResend(
      delivery(emailEvent("email.delivered"), ID),
      db,
      hookEnv("production"),
    );
    expect(answer.status).toBe(200);
    expect(rpcCalls(db).map((call) => call.name)).toEqual(["record_webhook_receipt"]);
  });

  it("forgets the receipt and answers 500 when apply_email_event fails", async () => {
    const db = hookDb(() => new Error("connection refused"));
    await expect(
      handleResend(delivery(emailEvent("email.sent"), ID), db, hookEnv("preview")),
    ).rejects.toMatchObject({ code: "server" });
    expect(rpcCalls(db).map((call) => call.name)).toEqual([
      "record_webhook_receipt",
      "apply_email_event",
      "forget_webhook_receipt",
    ]);
  });
});
