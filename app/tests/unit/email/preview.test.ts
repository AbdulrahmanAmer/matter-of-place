import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { siteConfig } from "../../../src/config/site";
import type { Tables } from "../../../src/db";
import { sampleVariables, type EmailBlock } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { previewTemplate } from "../../../src/server/email/preview";
import { renderTemplate } from "../../../src/server/email/render";
import { entityData, resolveVariables } from "../../../src/server/email/variables";
import { fakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

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
  fakeDb({ tables: { email_templates: [template], settings: [], ...tables } });

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
