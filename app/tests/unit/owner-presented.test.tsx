// Invariant 22 (S55): a home its owner presents names no representative, and its contact path speaks to the owner.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InquiryDialog } from "../../src/components/forms/inquiry-dialog";
import { Representation } from "../../src/components/property/representation";
import { properties } from "../../src/data/properties";

const first = properties[0];
if (first === undefined) throw new Error("no bundled property");
const representative = { name: "Test Agent", brokerage: "Test Realty" };
const represented = { ...first, presentedByOwner: false, representation: representative };
const byOwner = { ...represented, presentedByOwner: true };
const noop = () => undefined;

describe("Representation", () => {
  it("shows the representative of a home an agent presents", () => {
    render(<Representation property={represented} onContact={noop} onShowing={noop} />);
    expect(screen.getByRole("heading", { name: "Represented by" })).toBeTruthy();
    expect(screen.getByText(representative.name)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Contact listing representative/ })).toBeTruthy();
  });

  it("shows only 'Presented by the owner' for a home its owner presents", () => {
    render(<Representation property={byOwner} onContact={noop} onShowing={noop} />);
    expect(screen.getByRole("heading", { name: "Presented by the owner" })).toBeTruthy();
    expect(screen.queryByText(representative.name)).toBeNull();
    expect(screen.queryByText(representative.brokerage)).toBeNull();
    expect(screen.getByRole("button", { name: /Contact the owner/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Contact listing representative/ })).toBeNull();
  });
});

describe("InquiryDialog, agent intent", () => {
  it("writes to the listing representative by default", () => {
    render(<InquiryDialog intent="agent" onClose={noop} />);
    expect(screen.getByText("CONTACT LISTING REPRESENTATIVE")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reach the representative." })).toBeTruthy();
  });

  it("writes to the owner when the owner presents the home", () => {
    render(<InquiryDialog intent="agent" presentedByOwner onClose={noop} />);
    expect(screen.getByText("CONTACT THE OWNER")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reach the owner." })).toBeTruthy();
    expect(
      screen.getByText(
        "Your message goes to the owner of this home. Matter of Place is not a brokerage.",
      ),
    ).toBeTruthy();
  });

  it("leaves the other intents as they are for an owner's home", () => {
    render(<InquiryDialog intent="ask" presentedByOwner onClose={noop} />);
    expect(screen.getByRole("heading", { name: "Ask us anything." })).toBeTruthy();
  });
});
