import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { requestStatusLines, type AccountRequest } from "../../domain/account";
import { submissionStates } from "../../domain/contracts";
import { AccountNotFound } from "./account-not-found";
import { AccountRoom } from "./account-room";

// W6 item 7: the room's filled and empty states, and the calm page of a session with no contact.

const requests: AccountRequest[] = [
  {
    id: "00000000-0000-4000-8000-0000000000c2",
    address: "2 Newer Way",
    city: "Malibu",
    state: "California",
    workflow_state: "Under Review",
    received_at: "2026-10-02T10:00:00+00:00",
  },
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    address: "1 Older Way",
    city: "Berkeley",
    state: "California",
    workflow_state: "Submitted",
    received_at: "2026-10-01T10:00:00+00:00",
  },
];

describe("AccountRoom", () => {
  it("lists the client's requests by address and state, in the order given", () => {
    render(
      <AccountRoom
        name="Test Owner"
        email="owner@example.test"
        requests={requests}
        onSignOut={vi.fn()}
        signingOut={false}
      />,
    );
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "2 Newer Way, MalibuWe are reading your request. Received Oct 2, 2026 PT.",
      "1 Older Way, BerkeleyWe have your request and will read it soon. Received Oct 1, 2026 PT.",
    ]);
    expect(screen.getByText("Signed in as Test Owner, owner@example.test.")).toBeTruthy();
  });

  it("says where each pipeline state stands in a sentence for the client, never the staff label", () => {
    const every: AccountRequest[] = submissionStates.map((workflow_state, index) => ({
      id: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
      address: `${String(index + 1)} State Way`,
      city: "Malibu",
      state: "California",
      workflow_state,
      received_at: "2026-10-02T10:00:00+00:00",
    }));
    render(
      <AccountRoom
        name="Test Owner"
        email="owner@example.test"
        requests={every}
        onSignOut={vi.fn()}
        signingOut={false}
      />,
    );
    const shown = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(shown).toHaveLength(submissionStates.length);
    submissionStates.forEach((workflow_state, index) => {
      const sentence = requestStatusLines[workflow_state];
      expect(shown[index]).toContain(`${sentence} Received Oct 2, 2026 PT.`);
      // a staff label ("Distribution Active.", "Invoice Issued.") is not what a client reads
      expect(shown[index]).not.toContain(`${workflow_state}.`);
      expect(sentence).not.toMatch(/[–—]/);
    });
  });

  it("says plainly that there is nothing yet when the client has no request", () => {
    render(
      <AccountRoom
        name="Test Owner"
        email="owner@example.test"
        requests={[]}
        onSignOut={vi.fn()}
        signingOut={false}
      />,
    );
    expect(screen.queryAllByRole("listitem")).toEqual([]);
    expect(
      screen.getByText(
        "Nothing here yet. A property you submit to us appears here, with where it stands.",
      ),
    ).toBeTruthy();
  });

  it("signs out from the room", () => {
    const onSignOut = vi.fn();
    render(
      <AccountRoom
        name="Test Owner"
        email="owner@example.test"
        requests={[]}
        onSignOut={onSignOut}
        signingOut={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("AccountNotFound", () => {
  it("says the account could not be found and shows no data", () => {
    const { container } = render(<AccountNotFound onSignOut={vi.fn()} signingOut={false} />);
    expect(screen.getByRole("heading", { name: "We could not find your account" })).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
