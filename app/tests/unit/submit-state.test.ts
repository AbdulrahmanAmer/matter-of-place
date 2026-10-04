// The submit wizard's draft (invariant 22, S55): the "About you" step, what is sent for each kind, and the file limits.
import { describe, expect, it } from "vitest";
import { uploadLimits } from "../../src/domain/contracts";
import {
  canContinue,
  initialDraft,
  lastStep,
  maxFiles,
  nextStep,
  steps,
  submittedBy,
  toKindOption,
  toSubmission,
  type SubmitDraft,
} from "../../src/components/forms/submit/state";

const property = {
  address: "1 Test Way",
  city: "Berkeley",
  state: "California",
  zip: "94702",
  propertyType: "Residence",
  story: "A story.",
  significance: "A reason.",
  package: "The Feature",
  rightsConfirmed: true,
} satisfies Partial<SubmitDraft>;

const agent: SubmitDraft = {
  ...initialDraft,
  ...property,
  submitterKind: "agent",
  submitterName: "Test Agent",
  submitterEmail: "agent@example.test",
  brokerage: "Test Realty",
  sourceUrl: "https://example.test/mls/1",
};

const owner: SubmitDraft = {
  ...initialDraft,
  ...property,
  submitterKind: "owner",
  submitterName: "Test Owner",
  submitterEmail: "owner@example.test",
};

describe("the steps", () => {
  it("name About you third and keep five steps", () => {
    expect(steps).toEqual(["Property", "The story", "About you", "Exposure", "Review"]);
    expect(lastStep).toBe(4);
    expect(nextStep(3)).toBe(4);
    expect(nextStep(lastStep)).toBe(lastStep);
  });

  it("take the file limit from uploadLimits", () => {
    expect(maxFiles).toBe(uploadLimits.maxFiles);
    expect(maxFiles).toBe(40);
  });
});

describe("canContinue(2, draft)", () => {
  it("stays closed until a kind is chosen", () => {
    expect(canContinue(2, { ...agent, submitterKind: "" })).toBe(false);
    expect(canContinue(2, initialDraft)).toBe(false);
  });

  it("asks an agent for a brokerage", () => {
    expect(canContinue(2, agent)).toBe(true);
    expect(canContinue(2, { ...agent, brokerage: "  " })).toBe(false);
  });

  it("asks an owner for no brokerage", () => {
    expect(canContinue(2, owner)).toBe(true);
    expect(canContinue(2, { ...owner, submitterName: "" })).toBe(false);
    expect(canContinue(2, { ...owner, submitterEmail: " " })).toBe(false);
  });
});

describe("toKindOption", () => {
  it("reads the two kinds and anything else as not chosen", () => {
    expect([toKindOption("agent"), toKindOption("owner"), toKindOption("broker")]).toEqual([
      "agent",
      "owner",
      "",
    ]);
  });
});

describe("toSubmission", () => {
  it("sends an agent's brokerage and source link and nothing about a listing", () => {
    const sent = toSubmission({ ...agent, listingAgentName: "Typed Earlier" }, "/submit");
    expect(sent).toMatchObject({
      submitterKind: "agent",
      submitterName: "Test Agent",
      brokerage: "Test Realty",
      sourceUrl: "https://example.test/mls/1",
    });
    expect(Object.keys(sent)).not.toContain("listedWithAgent");
    expect(Object.keys(sent)).not.toContain("listingAgentName");
    expect(Object.keys(sent)).not.toContain("agentName");
  });

  it("sends an owner no brokerage and no source link, even from a draft that was an agent's", () => {
    const sent = toSubmission(
      { ...agent, submitterKind: "owner", submitterName: "Test Owner" },
      "/submit",
    );
    expect(sent.submitterKind).toBe("owner");
    expect(sent.brokerage).toBeUndefined();
    expect(sent.sourceUrl).toBeUndefined();
    expect(sent.listedWithAgent).toBe(false);
  });

  it("sends the listing agent only while the home is listed", () => {
    const listing = { listingAgentName: "Listing Agent", listingAgentBrokerage: "Other Realty" };
    const listed = toSubmission({ ...owner, listedWithAgent: true, ...listing }, "/submit");
    const unlisted = toSubmission({ ...owner, listedWithAgent: false, ...listing }, "/submit");
    expect(listed).toMatchObject({ listedWithAgent: true, ...listing });
    expect(unlisted.listedWithAgent).toBe(false);
    expect(unlisted.listingAgentName).toBeUndefined();
    expect(unlisted.listingAgentBrokerage).toBeUndefined();
  });

  it("refuses a draft with no kind chosen", () => {
    expect(() => toSubmission({ ...agent, submitterKind: "" }, "/submit")).toThrow();
  });
});

describe("submittedBy", () => {
  it("reads name and brokerage for an agent, name and owner for an owner", () => {
    expect(submittedBy(agent)).toBe("Test Agent, Test Realty");
    expect(submittedBy(owner)).toBe("Test Owner, owner");
  });

  it("adds the listing agent an owner names", () => {
    const listed = { ...owner, listedWithAgent: true, listingAgentName: "Listing Agent" };
    expect(submittedBy(listed)).toBe("Test Owner, owner, listed with Listing Agent");
    expect(submittedBy({ ...listed, listedWithAgent: false })).toBe("Test Owner, owner");
    expect(submittedBy({ ...listed, listingAgentName: "" })).toBe("Test Owner, owner");
  });

  it("is empty before a kind is chosen", () => {
    expect(submittedBy(initialDraft)).toBe("");
  });
});
