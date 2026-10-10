// B8b step 8: the two functions behind the template routes of screen 18 (`src/server/automation/service.ts`).
// `previewEmailTemplate` is B5's render of the stored row; `sendTemplateTest` reads the address of the person who asked and
// queues one job. Neither sends mail (B5 invariant 10).
import { describe, expect, it } from "vitest";
import { siteConfig } from "../../../src/config/site";
import type { Tables } from "../../../src/db";
import { sampleVariables } from "../../../src/domain/email";
import { previewEmailTemplate, sendTemplateTest } from "../../../src/server/automation/service";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate } from "../../../src/server/email/render";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { resetPublicStateMemo } from "../../../src/server/public/state";
import { fakeDb } from "../../fixtures/fake-db";
import { stateJson } from "../../fixtures/snapshot";

const USER = "00000000-0000-4000-8000-000000000001";

const actor = (
  roles: AdminActor["roles"],
  kind: AdminActor["kind"] = "human",
  scopes: string[] = [],
): AdminActor => ({ userId: USER, kind, roles, scopes, requestId: "req-test" });

/** The service's client with the one Auth call it makes: `getUserById` answering `email`, or an error. */
function client(email: string | undefined | Error, repeated = false) {
  const asked: string[] = [];
  // The generated type of `enqueue_job` says string; the function answers null for a key it already holds (invariant 1).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the null a repeated key gets, which the generated type leaves out
  const answer = (): string => (repeated ? (null as unknown as string) : "job-1");
  const base = fakeDb({ rpc: { enqueue_job: answer } });
  const db = Object.assign(base, {
    auth: {
      admin: {
        getUserById: (id: string) => {
          asked.push(id);
          return Promise.resolve(
            email instanceof Error
              ? { data: { user: null }, error: email }
              : { data: { user: { email } }, error: null },
          );
        },
      },
    },
  });
  return { db, asked };
}

describe("sendTemplateTest", () => {
  it("queues one send_email job for the template, addressed to the person who asked", async () => {
    const { db, asked } = client("chief@matterofplace.com");
    const answer = await sendTemplateTest(actor(["chief_editor"]), db, { key: "declined" });
    expect(answer).toEqual({ queued: true, to: "chief@matterofplace.com" });
    expect(asked).toEqual([USER]);
    const calls = db.calls.filter((call) => call.kind === "rpc");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toMatchObject({
      p_type: "send_email",
      p_payload: {
        params: { template: "declined" },
        data: { test: true, actor_email: "chief@matterofplace.com" },
      },
    });
  });

  it("answers queued false when this minute already holds the test", async () => {
    const { db } = client("chief@matterofplace.com", true);
    await expect(sendTemplateTest(actor(["admin"]), db, { key: "received" })).resolves.toEqual({
      queued: false,
      to: "chief@matterofplace.com",
    });
  });

  it("refuses a role the matrix leaves out, before it reads an address or queues anything", async () => {
    const { db, asked } = client("someone@matterofplace.com");
    await expect(
      sendTemplateTest(actor(["managing_editor"]), db, { key: "received" }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(asked).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("refuses a key outside B5's set", async () => {
    const { db } = client("chief@matterofplace.com");
    await expect(sendTemplateTest(actor(["admin"]), db, { key: "nope" })).rejects.toMatchObject({
      code: "validation",
    });
    expect(db.calls).toEqual([]);
  });

  it("stops with a plain message when the account has no address", async () => {
    const { db } = client(undefined);
    await expect(sendTemplateTest(actor(["admin"]), db, { key: "received" })).rejects.toMatchObject(
      { code: "validation", message: "This account has no address to send a test to." },
    );
    expect(db.calls).toEqual([]);
  });

  it("answers unavailable when Auth cannot be read", async () => {
    const { db } = client(new Error("down"));
    await expect(sendTemplateTest(actor(["admin"]), db, { key: "received" })).rejects.toMatchObject(
      { code: "unavailable", status: 503 },
    );
    expect(db.calls).toEqual([]);
  });
});

describe("previewEmailTemplate", () => {
  const stored: Tables<"email_templates"> = {
    id: "3f2a9c1d-0000-4000-8000-0000000000c1",
    key: "received",
    class: "transactional",
    enabled: true,
    variables: [],
    version: 1,
    created_at: "2026-10-05T09:00:00+00:00",
    updated_at: "2026-10-05T09:00:00+00:00",
    subject: "Subject for {{submitter_name}}",
    preheader: "About {{property_address}}",
    body: [
      { type: "heading", text: "Edited for {{submitter_name}}" },
      { type: "paragraph", text: "We hold {{property_address}}, {{city}}." },
      { type: "signature" },
    ],
  };
  const site: SiteContext = {
    siteUrl: siteConfig.url,
    entity: null,
    address: null,
    contact: { email: null },
  };
  // The identity lines come from the shared public state, memoised per isolate: each case starts without the last one's.
  const db = () => {
    resetPublicStateMemo();
    return fakeDb({
      rpc: { public_state: () => stateJson(7) },
      tables: { email_templates: [stored], settings: [] },
    });
  };

  it("returns what renderTemplate returns for the same row and the same variables", async () => {
    const given = { submitter_name: "Avery Quinn" };
    const previewed = await previewEmailTemplate(actor(["media_ops"]), db(), {
      key: "received",
      variables: given,
    });
    expect(previewed).toEqual(
      await renderTemplate(
        stored,
        { ...sampleVariables("received", siteConfig.url), ...given },
        site,
      ),
    );
    expect(previewed.subject).toBe("Subject for Avery Quinn");
    expect(previewed.html).toContain("Edited for Avery Quinn");
  });

  it("draws the sample variables when it is given none", async () => {
    const previewed = await previewEmailTemplate(actor(["chief_editor"]), db(), {
      key: "received",
    });
    expect(previewed).toEqual(
      await renderTemplate(stored, sampleVariables("received", siteConfig.url), site),
    );
  });

  it("refuses a role the matrix leaves out, before it reads the row", async () => {
    const refused = db();
    await expect(
      previewEmailTemplate(actor(["commercial"]), refused, { key: "received" }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(refused.calls).toEqual([]);
  });
});
