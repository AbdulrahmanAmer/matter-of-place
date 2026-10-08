import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { siteConfig } from "../../../src/config/site";
import type { Json, Tables } from "../../../src/db";
import { sampleVariables, type EmailBlock } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { previewTemplate, sendTestEmail } from "../../../src/server/email/preview";
import { renderTemplate } from "../../../src/server/email/render";
import { entityData, resolveVariables } from "../../../src/server/email/variables";
import { sendEmail } from "../../../src/server/jobs/steps/send-email";
import { emailEnv, emailWorld, fakeFetch, NOW, stepCtx } from "../../fixtures/email-send";
import type { Db } from "../../../src/server/lib/db";
import { fakeDb, type FakeDbOptions } from "../../fixtures/fake-db";
import { stateJson } from "../../fixtures/snapshot";

const SUBMISSION = "11111111-1111-4111-8111-111111111111";

/** A row with the columns a test names; the code under test selects only those. */
function row<T>(values: { [K in keyof T]?: unknown }): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a fixture row names only the columns the code under test selects
  return values as T;
}

const body: EmailBlock[] = [
  { type: "heading", text: "Edited for {{submitter_name}}" },
  { type: "paragraph", text: "We hold {{property_address}}, {{city}}." },
  { type: "signature" },
];

const template = row<Tables<"email_templates">>({
  key: "received",
  subject: "Subject for {{submitter_name}}",
  preheader: "",
  body,
});

const submission = row<Tables<"submissions">>({
  id: SUBMISSION,
  submitter_name: "Priya Nair",
  address: "9 Harbor Lane",
  city: "Santa Cruz",
  state: "California",
  package: "The Feature",
});

const dbWith = (tables: NonNullable<FakeDbOptions["tables"]>) =>
  fakeDb({
    tables: { email_templates: [template], settings: [], ...tables },
    rpc: { public_state: () => stateJson(7) },
  });

const site: SiteContext = {
  siteUrl: siteConfig.url,
  entity: null,
  address: null,
  contact: { email: null },
};

describe("previewTemplate", () => {
  it("with an entity returns what renderTemplate returns for the same row and resolveVariables", async () => {
    const db = dbWith({ submissions: [submission] });
    const previewed = await previewTemplate(db, {
      key: "received",
      entity: { kind: "submission", id: SUBMISSION },
    });
    const variables = await resolveVariables(
      db,
      "received",
      entityData("submission", SUBMISSION),
      undefined,
      site,
    );
    const sent = await renderTemplate(template, variables, site);
    expect(previewed).toEqual(sent);
    expect(previewed.html).toContain("Edited for Priya Nair");
  });

  it("without an entity uses the sample variables, and what it is given wins over them", async () => {
    const db = dbWith({});
    const sampled = await previewTemplate(db, { key: "received" });
    expect(sampled).toEqual(
      await renderTemplate(template, sampleVariables("received", siteConfig.url), site),
    );
    expect(sampled.subject).toBe("Subject for Jordan Lee");
    const given = await previewTemplate(db, {
      key: "received",
      variables: { submitter_name: "Alex Chen" },
    });
    expect(given.subject).toBe("Subject for Alex Chen");
    expect(given.html).toContain("412 Alder Court");
  });

  it("is not_found for a key with no row", async () => {
    const db = fakeDb({ tables: { email_templates: [], settings: [] } });
    await expect(previewTemplate(db, { key: "declined" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is unavailable, not not_found, when the read of the row fails", async () => {
    const failed = Promise.resolve({ data: null, error: { code: "57014" } });
    const query = { eq: () => query, limit: () => failed };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a client whose one read fails; the code under test touches nothing else
    const db = { from: () => ({ select: () => query }) } as unknown as Db;
    await expect(previewTemplate(db, { key: "received" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("imports nothing that sends: no file of the Worker's routes, the subscribers or preview.ts names resend-client", () => {
    const root = new URL("../../../src/", import.meta.url);
    const files = [
      "server/email/preview.ts",
      ...["routes", "server/subscribers"].flatMap((dir) =>
        readdirSync(new URL(`${dir}/`, root), { recursive: true, encoding: "utf8" })
          .filter((name) => /\.tsx?$/.test(name))
          .map((name) => `${dir}/${name.replaceAll("\\", "/")}`),
      ),
    ];
    expect(files).toContain("server/email/preview.ts");
    const naming = files.filter((file) =>
      readFileSync(new URL(file, root), "utf8").includes("resend-client"),
    );
    expect(naming).toEqual([]);
  });
});

describe("sendTestEmail", () => {
  const ACTOR = {
    id: "77777777-7777-4777-8777-777777777777",
    email: "admin+test@matterofplace.com",
  };
  const MINUTE = Math.floor(NOW.getTime() / 60_000);

  // One job per idempotency key, as `enqueue_job` keeps them.
  function jobStore() {
    const jobs = new Map<string, { type: string; payload: Json }>();
    const db = fakeDb({
      rpc: {
        enqueue_job: (args) => {
          if (!jobs.has(args.p_idempotency_key)) {
            jobs.set(args.p_idempotency_key, { type: args.p_type, payload: args.p_payload });
          }
          return `job-${String(jobs.size)}`;
        },
      },
    });
    return { db, jobs };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("inserts one send_email job keyed by actor, key and minute", async () => {
    const { db, jobs } = jobStore();
    expect(await sendTestEmail(db, ACTOR, "received")).toBe("job-1");
    expect([...jobs]).toEqual([
      [
        `send_email:${ACTOR.id}:test:received:${String(MINUTE)}`,
        {
          type: "send_email",
          payload: {
            params: { template: "received" },
            data: { test: true, actor_email: ACTOR.email },
          },
        },
      ],
    ]);
  });

  it("inserts none for a second call in the same minute", async () => {
    const { db, jobs } = jobStore();
    await sendTestEmail(db, ACTOR, "received");
    vi.setSystemTime(new Date(NOW.getTime() + 20_000));
    await sendTestEmail(db, ACTOR, "received");
    expect(jobs.size).toBe(1);
  });

  it("is sent only to actor_email, with the [Test] prefix and kind test", async () => {
    const { db: queue, jobs } = jobStore();
    await sendTestEmail(queue, ACTOR, "received");
    const job = [...jobs.values()][0];
    const payload = z
      .object({
        params: z.object({ template: z.string() }),
        data: z.object({ test: z.literal(true), actor_email: z.string() }),
      })
      .parse(job?.payload);
    emailEnv();
    const fetch = fakeFetch();
    const { db, messages } = emailWorld();
    await sendEmail.run(stepCtx(db), payload.params, payload.data);
    expect(fetch.requests.map(({ body }) => [body.to, body.subject])).toEqual([
      [[ACTOR.email], "[Test] We have your submission"],
    ]);
    expect(messages.map((row) => [row.to_email, row.kind])).toEqual([[ACTOR.email, "test"]]);
  });
});
