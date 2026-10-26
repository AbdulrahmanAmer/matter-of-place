import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountProperty } from "../../domain/account";
import { AccountProperties } from "./account-properties";

// W6 item 8, My properties: each request as a timeline to the live page, in the client's words.

const base = {
  city: "Malibu",
  state: "California",
  package: "Five Features",
  received_at: "2026-10-01T10:00:00+00:00",
  reviewed_at: "2026-10-02T10:00:00+00:00",
  accepted_at: "2026-10-03T10:00:00+00:00",
  activated_at: null,
  published_at: null,
  live_path: null,
  photos: 0,
  can_add_photos: true,
} as const;

const live: AccountProperty = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000c1",
  address: "1 Live Way",
  workflow_state: "Published",
  activated_at: "2026-10-08T10:00:00+00:00",
  published_at: "2026-10-09T10:00:00+00:00",
  live_path: "/property/1-live-way",
  photos: 8,
  can_add_photos: false,
};

const waiting: AccountProperty = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000c2",
  address: "2 Waiting Way",
  workflow_state: "Under Review",
  accepted_at: null,
};

const declined: AccountProperty = {
  ...base,
  id: "00000000-0000-4000-8000-0000000000c3",
  address: "3 Declined Way",
  workflow_state: "Declined",
  accepted_at: null,
  can_add_photos: false,
};

const stepsOf = (name: string) =>
  within(screen.getByRole("list", { name })).getAllByRole("listitem");

describe("AccountProperties", () => {
  it("shows a request as a timeline: the days it passed, where it is now and what is still to come", () => {
    render(<AccountProperties properties={[live, waiting]} onPhotosSent={vi.fn()} />);
    expect(stepsOf("Where 1 Live Way stands").map((step) => step.textContent)).toEqual([
      "ReceivedOct 1, 2026 PT",
      "Under reviewOct 2, 2026 PT",
      "AcceptedOct 3, 2026 PT",
      "InvoiceDone",
      "Live on the siteNow, since Oct 9, 2026 PT",
      "CompleteNot yet",
    ]);
    expect(stepsOf("Where 2 Waiting Way stands").map((step) => step.textContent)).toEqual([
      "ReceivedOct 1, 2026 PT",
      "Under reviewNow, since Oct 2, 2026 PT",
      "AcceptedNot yet",
      "InvoiceNot yet",
      "Live on the siteNot yet",
      "CompleteNot yet",
    ]);
  });

  it("marks the step a request is at for assistive technology", () => {
    render(<AccountProperties properties={[waiting]} onPhotosSent={vi.fn()} />);
    const current = stepsOf("Where 2 Waiting Way stands").filter(
      (step) => step.getAttribute("aria-current") === "step",
    );
    expect(current.map((step) => step.textContent)).toEqual([
      "Under reviewNow, since Oct 2, 2026 PT",
    ]);
  });

  it("says where a request stands in a sentence, never the staff label", () => {
    render(<AccountProperties properties={[live]} onPhotosSent={vi.fn()} />);
    expect(screen.getByText("Your property is live on the site.")).toBeTruthy();
    expect(screen.queryByText("Published")).toBeNull();
  });

  it("links to the live page once there is one, and not before", () => {
    render(<AccountProperties properties={[live, waiting]} onPhotosSent={vi.fn()} />);
    const links = screen.getAllByText("See the live page");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/property/1-live-way"]);
  });

  it("ends a declined request with a plain closing step and no steps to come", () => {
    render(<AccountProperties properties={[declined]} onPhotosSent={vi.fn()} />);
    expect(stepsOf("Where 3 Declined Way stands").map((step) => step.textContent)).toEqual([
      "ReceivedOct 1, 2026 PT",
      "Under reviewOct 2, 2026 PT",
      "Not taken onClosed",
    ]);
    expect(screen.getByText("We are not able to take this one on.")).toBeTruthy();
  });

  it("offers to add photographs to a request that can still take them, and to no other", () => {
    render(<AccountProperties properties={[live, waiting]} onPhotosSent={vi.fn()} />);
    const fields = screen.getAllByLabelText("Add photographs");
    expect(fields).toHaveLength(1);
    expect(screen.getByText("No photographs on this request yet.")).toBeTruthy();
    expect(screen.queryByText("8 photographs on this request.")).toBeNull();
  });

  it("says so when there is no request yet", () => {
    render(<AccountProperties properties={[]} onPhotosSent={vi.fn()} />);
    expect(
      screen.getByText(
        "Nothing here yet. A property you submit to us appears here, with where it stands.",
      ),
    ).toBeTruthy();
  });
});
