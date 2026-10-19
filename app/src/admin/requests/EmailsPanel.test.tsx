// W9 item 2: a bounce reads plainly where the person works, with a field to correct the address and send it again.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubmissionEmails } from "../../domain/admin-emails";
import { EmailsPanel } from "./EmailsPanel";

const bounced: SubmissionEmails = {
  address: "agent@brokerage.example",
  suppression: { email: "agent@brokerage.example", reason: "bounce", at: "2026-10-15T04:10:07Z" },
  items: [
    {
      id: "c92fcbb1-f62e-4fb8-b186-744307f18dc2",
      template_key: "received",
      to_email: "agent@brokerage.example",
      status: "bounced",
      error: null,
      bounce_type: "Permanent",
      entity: "submission",
      entity_id: "4a3c2563-c07a-481d-839b-ad0523827f69",
      created_at: "2026-10-15T04:10:03Z",
      sent_at: "2026-10-15T04:10:03Z",
      delivered_at: "2026-10-15T04:10:04Z",
      opened_at: null,
      suppressed: true,
    },
  ],
};

const panel = (over: Partial<Parameters<typeof EmailsPanel>[0]> = {}) => (
  <EmailsPanel
    emails={bounced}
    marketSlug="california"
    canResend
    pending={false}
    error={null}
    onResend={() => Promise.resolve(true)}
    {...over}
  />
);

describe("the emails of a request", () => {
  it("says the confirmation bounced and that nothing more goes to the address", () => {
    render(panel());
    expect(screen.getByText("The confirmation bounced: this mailbox does not exist.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Nothing more is sent to agent@brokerage.example: it bounced on",
    );
  });

  it("sends the email again to the corrected address", async () => {
    const onResend = vi.fn(() => Promise.resolve(true));
    render(panel({ onResend }));
    fireEvent.change(screen.getByLabelText("Correct the address and send it again"), {
      target: { value: "agent@brokerage.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => {
      expect(screen.getByText("Queued again to agent@brokerage.com.")).toBeTruthy();
    });
    expect(onResend).toHaveBeenCalledWith(
      "c92fcbb1-f62e-4fb8-b186-744307f18dc2",
      "agent@brokerage.com",
    );
  });

  it("offers no resend to a person without the right, nor for an email that was delivered", () => {
    const { unmount } = render(panel({ canResend: false }));
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
    unmount();
    const [first] = bounced.items;
    if (first === undefined) throw new Error("fixture");
    render(panel({ emails: { ...bounced, items: [{ ...first, status: "delivered" }] } }));
    expect(screen.getByText("The confirmation was delivered.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
  });
});
