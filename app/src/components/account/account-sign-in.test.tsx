import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendAccountLinkFn } from "../../lib/account.functions";
import { AccountSignIn } from "./account-sign-in";

// W6 item 7: the room's sign-in form. The server call is replaced, so no email is ever sent from a test.

vi.mock("../../lib/account.functions", () => ({ sendAccountLinkFn: vi.fn() }));
vi.mock("../../lib/turnstile", () => ({ getTurnstileToken: () => Promise.resolve("token") }));

beforeEach(() => {
  vi.mocked(sendAccountLinkFn).mockReset().mockResolvedValue({ status: "sent" });
});

describe("AccountSignIn", () => {
  it("sends the address with the bot check's token, then says to check the email", async () => {
    render(<AccountSignIn expired={false} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send me a link" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy();
    });
    expect(vi.mocked(sendAccountLinkFn).mock.calls).toEqual([
      [{ data: { email: "owner@example.test", turnstile: "token" } }],
    ]);
  });

  it("tells a person whose link expired to ask for a new one", () => {
    render(<AccountSignIn expired />);
    expect(
      screen.getByText("That link has expired or was already used. Ask for a new one below."),
    ).toBeTruthy();
  });

  it("keeps the button off until an address is typed", () => {
    render(<AccountSignIn expired={false} />);
    const button = screen.getByRole("button", { name: "Send me a link" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
