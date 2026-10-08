import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkPreviewSignature,
  signPreview,
  verifyPreview,
} from "../../src/server/lib/preview-token";

// B7 invariant 14: draft links in B2's format, 15 minutes for the editor's frame and 7 days for an agent.

const KEY = "preview-test-key";
const PROPERTY = "00000000-0000-4000-8000-0000000000b1";
const NONCE = "00000000-0000-4000-8000-0000000000n1";
const START = new Date("2026-10-07T12:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("preview tokens", () => {
  it("an editor token is live for 15 minutes and no longer", async () => {
    vi.useFakeTimers({ now: START });
    const { token, expiresAt } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    expect(token.startsWith(`${PROPERTY}.`)).toBe(true);
    expect(expiresAt.getTime() - START.getTime()).toBe(15 * 60 * 1000);
    expect(checkPreviewSignature(KEY, token, new Date(START.getTime() + 14 * 60 * 1000))).toBe(
      PROPERTY,
    );
    expect(checkPreviewSignature(KEY, token, new Date(START.getTime() + 15 * 60 * 1000))).toBe(
      null,
    );
  });

  it("an agent token is live for 7 days and no longer", async () => {
    vi.useFakeTimers({ now: START });
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "agent");
    const day = 24 * 60 * 60 * 1000;
    expect(checkPreviewSignature(KEY, token, new Date(START.getTime() + 7 * day - 1000))).toBe(
      PROPERTY,
    );
    expect(checkPreviewSignature(KEY, token, new Date(START.getTime() + 7 * day))).toBe(null);
  });

  it("verifies with the property's nonce only, and with the key that signed", async () => {
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    expect(await verifyPreview(KEY, token, NONCE)).toBe(true);
    expect(await verifyPreview(KEY, token, "00000000-0000-4000-8000-0000000000n2")).toBe(false);
    expect(await verifyPreview("another-key", token, NONCE)).toBe(false);
    expect(await verifyPreview(undefined, token, NONCE)).toBe(false);
  });

  it("refuses a malformed token and anything when the key is unset", async () => {
    const { token } = await signPreview(KEY, PROPERTY, NONCE, "editor");
    expect(checkPreviewSignature(KEY, `${token}x`, new Date())).toBe(null);
    expect(checkPreviewSignature(KEY, "not-a-token-at-all", new Date())).toBe(null);
    expect(checkPreviewSignature(undefined, token, new Date())).toBe(null);
  });

  it("signPreview with an undefined key throws preview_secret_missing", async () => {
    await expect(signPreview(undefined, PROPERTY, NONCE, "editor")).rejects.toMatchObject({
      code: "preview_secret_missing",
      status: 503,
    });
  });
});
