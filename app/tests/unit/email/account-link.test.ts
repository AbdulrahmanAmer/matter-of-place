import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleVariables } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate } from "../../../src/server/email/render";
import { resolveRecipient, resolveVariables, SkipSend } from "../../../src/server/email/variables";
import { definition } from "../../../src/templates/email/account-link";
import { definitionRow } from "../../../src/templates/email/index";
import { inserted } from "../../fixtures/email-rows";
import { fakeDb } from "../../fixtures/fake-db";

// W6 item 7, ruling H119 (4): the client's sign-in email. The `send_email` job makes the link when it runs, for an
// address that is still a contact's, from an auth user made unconfirmed; the link carries the token in its fragment and
// goes only to the address it signs in.

const EMAIL = "owner@example.test";
const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: "Omnikom LLC",
  address: "30 N Gould St Ste R, Sheridan, WY 82801, USA",
  contact: { email: "hello@matterofplace.com" },
};

const admin = { createUser: vi.fn(), generateLink: vi.fn() };

function world(known: boolean) {
  return Object.assign(fakeDb({ rpc: { account_can_sign_in: () => known } }), { auth: { admin } });
}

const link = () => resolveVariables(world(true), "account_link", { email: EMAIL }, undefined, site);

beforeEach(() => {
  admin.createUser.mockReset().mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  admin.generateLink
    .mockReset()
    .mockResolvedValue({ data: { properties: { hashed_token: "abc/def+1" } }, error: null });
});

describe("account_link variables", () => {
  it("makes the link of a contact's address now, with the token in the fragment", async () => {
    expect(await link()).toEqual({
      sign_in_url: "https://matterofplace.com/account/confirm#token_hash=abc%2Fdef%2B1",
    });
    expect(admin.generateLink.mock.calls).toEqual([[{ type: "magiclink", email: EMAIL }]]);
  });

  it("makes the auth user unconfirmed, so only the first use of a link confirms the address", async () => {
    await link();
    expect(admin.createUser.mock.calls).toEqual([[{ email: EMAIL, email_confirm: false }]]);
  });

  it("uses the auth user that already exists", async () => {
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422 },
    });
    expect((await link())["sign_in_url"]).toContain("#token_hash=");
  });

  it("fails the job, to be tried again, when Auth refuses to make the user", async () => {
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", status: 500 },
    });
    await expect(link()).rejects.toThrow("auth_create_failed:500");
    expect(admin.generateLink).not.toHaveBeenCalled();
  });

  it("skips an address that is no longer a contact's, making no user and no link", async () => {
    const skipped = await resolveVariables(
      world(false),
      "account_link",
      { email: EMAIL },
      undefined,
      site,
    ).catch((error: unknown) => error);
    expect(skipped instanceof SkipSend ? skipped.reason : skipped).toBe("not_a_client");
    expect([admin.createUser.mock.calls, admin.generateLink.mock.calls]).toEqual([[], []]);
  });
});

describe("account_link recipient", () => {
  it("goes to the address the link signs in, whatever a recipe names", async () => {
    expect(
      await resolveRecipient(fakeDb(), "account_link", { to: "admins" }, { email: EMAIL }),
    ).toEqual({ to: [EMAIL], entity: null, entityId: null });
  });
});

describe("account_link email", () => {
  it("draws the button to the link and speaks to a client, not to the team", async () => {
    const rendered = await renderTemplate(
      definitionRow(definition),
      sampleVariables("account_link", site.siteUrl),
      site,
    );
    expect(rendered.html).toContain(
      'href="https://matterofplace.com/account/confirm#token_hash=sample-token"',
    );
    expect(`${rendered.subject} ${rendered.text}`).not.toMatch(/\badmin\b|—/i);
  });

  it("equals the row its migration seeds", () => {
    const [seed, ...more] = inserted("20261016014530_account_link_template.sql");
    expect(more).toEqual([]);
    expect(seed).toEqual({
      key: definition.key,
      class: definition.class,
      subject: definition.subject,
      preheader: definition.preheader,
      blocks: definition.blocks,
      variables: [...definition.variables],
    });
  });
});
