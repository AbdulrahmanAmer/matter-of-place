// Invariant 22 (S55): who submits, in the form's Zod contract. The same two rules are the database checks
// `submissions_brokerage_for_agent` and `submissions_listing_for_owner` (tests/db/integrity.db.test.ts, -t submitter).
import { describe, expect, it } from "vitest";
import { submissionSchema, submitterRules } from "../../src/domain/contracts";

const agent = {
  address: "1 Test Way",
  city: "Berkeley",
  state: "California",
  zip: "94702",
  currency: "USD",
  propertyType: "Residence",
  submitterKind: "agent",
  submitterName: "Test Agent",
  submitterEmail: "agent@example.test",
  brokerage: "Test Realty",
  story: "A story.",
  significance: "A reason.",
  package: "The Feature",
  rightsConfirmed: true,
  sourcePath: "/submit",
};
const { brokerage: _brokerage, ...agentWithoutBrokerage } = agent;
const owner = { ...agentWithoutBrokerage, submitterKind: "owner", submitterName: "Test Owner" };

/** The field paths the schema refuses `payload` on; empty when it parses. */
function refusedOn(payload: object): string[] {
  const result = submissionSchema.safeParse(payload);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("submitter rules", () => {
  it("an agent names a brokerage", () => {
    expect({
      without: refusedOn(agentWithoutBrokerage),
      blank: refusedOn({ ...agent, brokerage: "  " }),
      with: refusedOn(agent),
    }).toEqual({ without: ["brokerage"], blank: ["brokerage"], with: [] });
  });

  it("an owner needs no brokerage and names none", () => {
    expect({
      without: refusedOn(owner),
      with: refusedOn({ ...owner, brokerage: "Test Realty" }),
    }).toEqual({ without: [], with: ["brokerage"] });
  });

  it("an owner names a listing agent only when the home is listed with one", () => {
    const listing = { listingAgentName: "Listing Agent", listingAgentBrokerage: "Other Realty" };
    expect({
      listed: refusedOn({ ...owner, listedWithAgent: true, ...listing }),
      notListed: refusedOn({ ...owner, listedWithAgent: false, ...listing }),
      unsaid: refusedOn({ ...owner, listingAgentName: "Listing Agent" }),
      onlyBrokerage: refusedOn({ ...owner, listingAgentBrokerage: "Other Realty" }),
    }).toEqual({
      listed: [],
      notListed: ["listingAgentName", "listingAgentBrokerage"],
      unsaid: ["listingAgentName"],
      onlyBrokerage: ["listingAgentBrokerage"],
    });
  });

  it("an agent does not say whether the home is listed or name a listing agent", () => {
    expect({
      listedWithAgent: refusedOn({ ...agent, listedWithAgent: true }),
      listingAgent: refusedOn({ ...agent, listedWithAgent: undefined, listingAgentName: "Other" }),
    }).toEqual({ listedWithAgent: ["listedWithAgent"], listingAgent: ["listingAgentName"] });
  });

  it("submitterRules reads the submitter fields alone", () => {
    const paths: (string | number)[] = [];
    submitterRules(
      { submitterKind: "agent", listedWithAgent: true },
      { path: [], addIssue: (issue) => paths.push(...(issue.path ?? [])) },
    );
    expect(paths).toEqual(["brokerage", "listedWithAgent"]);
  });

  it("a payload without submitterKind is refused", () => {
    const { submitterKind: _kind, ...withoutKind } = agent;
    expect(refusedOn(withoutKind)).toEqual(["submitterKind"]);
  });

  it("a payload that still uses agentName is refused on submitterName", () => {
    const { submitterName: _name, ...rest } = agent;
    expect(refusedOn({ ...rest, agentName: "Test Agent" })).toEqual(["submitterName"]);
  });
});
