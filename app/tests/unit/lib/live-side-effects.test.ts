import { afterEach, describe, expect, it, vi } from "vitest";
import { liveSideEffects, readVar } from "../../../src/server/lib/runtime-env";
import { sendOne } from "../../../src/server/jobs/steps/send-email";
import { BUILD_SHARE, emailEnv, emailWorld, fakeFetch, stepCtx } from "../../fixtures/email-send";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setEnv(values: Record<string, string>) {
  for (const name of ["MOP_ENV", "EMAIL_LIVE", "EMAIL_DRY_RUN", "SOCIAL_LIVE", "SOCIAL_DRY_RUN"]) {
    vi.stubEnv(name, undefined);
  }
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

describe("readVar", () => {
  it("reads at call time and answers undefined for an unset name", () => {
    vi.stubEnv("MOP_TEST_VAR", "first");
    expect(readVar("MOP_TEST_VAR")).toBe("first");
    vi.stubEnv("MOP_TEST_VAR", "second");
    expect(readVar("MOP_TEST_VAR")).toBe("second");
    expect(readVar("MOP_TEST_UNSET")).toBeUndefined();
  });
});

describe("liveSideEffects", () => {
  it("is false for both channels with no flags and MOP_ENV development", () => {
    setEnv({ MOP_ENV: "development" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([false, false]);
  });

  it("is false for both channels when MOP_ENV is unset", () => {
    setEnv({});
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([false, false]);
  });

  it("is true for both channels in production", () => {
    setEnv({ MOP_ENV: "production" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([true, true]);
  });

  it("lets EMAIL_LIVE make only email true", () => {
    setEnv({ MOP_ENV: "development", EMAIL_LIVE: "1" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([true, false]);
  });

  it("lets a dry-run flag win over production", () => {
    setEnv({ MOP_ENV: "production", EMAIL_DRY_RUN: "1" });
    expect([liveSideEffects("email"), liveSideEffects("social")]).toEqual([false, true]);
  });
});

// Invariant 16 through the real send path: `resend-client.ts` asks `liveSideEffects("email")` on every call, and
// `sendOne` holds a non-production runner to `settings.email.dev_recipients`.
describe("an email send fails closed", () => {
  const rendered = { subject: "Subject", preheader: "", html: "<p>Body</p>", text: "Body" };

  async function sendTo(addresses: string[]) {
    const fetch = fakeFetch();
    const { db, messages } = emailWorld({ share: BUILD_SHARE });
    const outcomes = [];
    for (const to of addresses) {
      outcomes.push(
        await sendOne(stepCtx(db), {
          to,
          templateKey: "received",
          kind: "transactional",
          rendered,
        }),
      );
    }
    return { outcomes, to: fetch.requests.map((request) => request.body.to), rows: messages };
  }

  it("makes no Resend call with MOP_ENV development and no flags", async () => {
    emailEnv({ MOP_ENV: "development" });
    const { outcomes, to, rows } = await sendTo(["admin@matterofplace.com"]);
    expect({ outcomes, to, status: rows.map((row) => row.status) }).toEqual({
      outcomes: [{ status: "skipped", reason: "dry_run" }],
      to: [],
      status: ["skipped"],
    });
  });

  it("makes no Resend call with MOP_ENV unset", async () => {
    emailEnv({ MOP_ENV: undefined });
    expect((await sendTo(["admin@matterofplace.com"])).to).toEqual([]);
  });

  it("with EMAIL_LIVE=1 sends only to an allow-listed address", async () => {
    emailEnv({ MOP_ENV: "preview", EMAIL_LIVE: "1" });
    const { outcomes, to } = await sendTo(["admin+e2e@matterofplace.com", "reader@gmail.com"]);
    expect({ outcomes, to }).toEqual({
      outcomes: [
        { status: "sent", resendId: "re_1" },
        { status: "skipped", reason: "not_allow_listed" },
      ],
      to: [["admin+e2e@matterofplace.com"]],
    });
  });

  it("sends nothing with MOP_ENV production and EMAIL_DRY_RUN=1", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const { outcomes, to } = await sendTo(["reader@gmail.com"]);
    expect({ outcomes, to }).toEqual({
      outcomes: [{ status: "skipped", reason: "dry_run" }],
      to: [],
    });
  });
});
