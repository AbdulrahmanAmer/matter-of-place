import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAccountLinkFn } from "../../lib/account.functions";
import { AccountConfirm } from "./account-confirm";

// W6 item 7, ruling H114 (4): the confirm page takes the token out of the address before anything else can read it,
// spends it only on a press, and sends a person on the team to the admin sign-in. The server call is replaced.

vi.mock("../../lib/account.functions", () => ({ confirmAccountLinkFn: vi.fn() }));

const press = () => {
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

beforeEach(() => {
  vi.mocked(confirmAccountLinkFn).mockReset().mockResolvedValue({ status: "signed-in" });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("AccountConfirm", () => {
  it("takes the token from the fragment and out of the address, then spends it on a press", async () => {
    window.history.replaceState(null, "", "/account/confirm#token_hash=secret-hash");
    const onDone = vi.fn();
    render(<AccountConfirm onDone={onDone} />);
    expect(window.location.href).toBe(`${window.location.origin}/account/confirm`);
    expect(confirmAccountLinkFn).not.toHaveBeenCalled();
    press();
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith("signed-in");
    });
    expect(vi.mocked(confirmAccountLinkFn).mock.calls).toEqual([
      [{ data: { token_hash: "secret-hash" } }],
    ]);
  });

  it("reads the token of a link that carries it in the query, and takes it out too", async () => {
    window.history.replaceState(null, "", "/account/confirm?token_hash=query-hash");
    render(<AccountConfirm onDone={vi.fn()} />);
    expect(window.location.href).toBe(`${window.location.origin}/account/confirm`);
    press();
    await waitFor(() => {
      expect(vi.mocked(confirmAccountLinkFn).mock.calls).toEqual([
        [{ data: { token_hash: "query-hash" } }],
      ]);
    });
  });

  it("keeps the button off when the address holds no token", () => {
    window.history.replaceState(null, "", "/account/confirm");
    render(<AccountConfirm onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);
  });

  it("says an expired link is expired", async () => {
    vi.mocked(confirmAccountLinkFn).mockResolvedValue({ status: "expired" });
    window.history.replaceState(null, "", "/account/confirm#token_hash=old");
    const onDone = vi.fn();
    render(<AccountConfirm onDone={onDone} />);
    press();
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith("expired");
    });
  });

  it("sends a person on the team to the admin sign-in, and never into the room", async () => {
    vi.mocked(confirmAccountLinkFn).mockResolvedValue({ status: "staff" });
    window.history.replaceState(null, "", "/account/confirm#token_hash=staff-hash");
    const onDone = vi.fn();
    render(<AccountConfirm onDone={onDone} />);
    press();
    const link = await screen.findByRole("link", { name: "Go to the admin sign-in" });
    expect([link.getAttribute("href"), onDone.mock.calls]).toEqual(["/admin/sign-in", []]);
    expect(
      screen.getByText("This address signs in to the admin. Please use the admin sign-in."),
    ).toBeTruthy();
  });
});
