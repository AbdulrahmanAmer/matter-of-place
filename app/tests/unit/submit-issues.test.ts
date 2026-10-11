// Panel finding 3: a refused field of the submit wizard goes to its step and its control (issues.ts).
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { submissionSchema } from "../../src/domain/contracts";
import {
  fieldHome,
  fieldIssues,
  fieldOf,
  firstIssueStep,
  issueLine,
  problemsOf,
} from "../../src/components/forms/submit/issues";
import {
  initialDraft,
  toSubmission,
  type SubmitDraft,
} from "../../src/components/forms/submit/state";
import { issuesOf } from "../../src/hooks/use-async-action";
import { t } from "../../src/lib/strings";
import { ServiceError, type ServiceIssue } from "../../src/services/types";

const issue = (path: (string | number)[], code: string, extra: Partial<ServiceIssue> = {}) => ({
  path,
  code,
  message: "Zod's own words",
  ...extra,
});

const owner: SubmitDraft = {
  ...initialDraft,
  address: "1 Test Way",
  city: "Ojai",
  state: "California",
  zip: "93023",
  propertyType: "Residence",
  story: "A story.",
  significance: "A reason.",
  submitterKind: "owner",
  submitterName: "Test Owner",
  submitterEmail: "owner@example.test",
  package: "The Feature",
  rightsConfirmed: true,
};

function refusalOf(draft: SubmitDraft): ServiceIssue[] {
  try {
    toSubmission(draft, "/submit");
  } catch (error) {
    return issuesOf(error);
  }
  return [];
}

describe("fieldHome", () => {
  it("knows every field of the contract the visitor can fix", () => {
    const shape = submissionSchema._def.schema.shape;
    const fixable = Object.keys(shape).filter((key) => key !== "currency" && key !== "sourcePath");
    expect(Object.keys(fieldHome).sort()).toEqual(fixable.sort());
  });

  it("puts each field on the step that shows its control", () => {
    const byStep = (step: number) =>
      Object.entries(fieldHome)
        .filter(([, home]) => home.step === step)
        .map(([field]) => field);
    expect(byStep(0)).toEqual([
      "address",
      "city",
      "state",
      "zip",
      "propertyType",
      "price",
      "beds",
      "baths",
      "interiorSqFt",
      "listingUrl",
    ]);
    expect(byStep(1)).toEqual([
      "architect",
      "designer",
      "yearBuilt",
      "yearRenovated",
      "story",
      "significance",
      "photographyUrl",
      "videoUrl",
      "media",
    ]);
    expect(byStep(2)).toEqual([
      "submitterKind",
      "submitterName",
      "brokerage",
      "submitterEmail",
      "submitterPhone",
      "sourceUrl",
      "listedWithAgent",
      "listingAgentName",
      "listingAgentBrokerage",
    ]);
    expect(byStep(3)).toEqual(["package", "mediaBudget", "rightsConfirmed"]);
    expect(byStep(4)).toEqual([]);
  });

  it("names the photographs of a draft by the contract's media", () => {
    expect(fieldOf("files")).toBe("media");
    expect(fieldOf("submitterEmail")).toBe("submitterEmail");
  });
});

describe("fieldIssues", () => {
  it("places the panel's bad email on step 3 with a plain sentence", () => {
    const found = fieldIssues(refusalOf({ ...owner, submitterEmail: "panel-test" }));
    expect(found).toEqual([
      {
        field: "submitterEmail",
        step: 2,
        label: "Email",
        message: "Please enter a valid email address.",
      },
    ]);
    expect(found.map(issueLine)).toEqual(["Email on step 3: Please enter a valid email address."]);
  });

  it("lists several refusals of the contract in the order of the steps", () => {
    const found = fieldIssues(
      refusalOf({
        ...owner,
        submitterEmail: "x",
        price: "0",
        beds: "2.5",
        yearBuilt: "1500",
        listingUrl: "example.test/listing",
        mediaBudget: "-5",
      }),
    );
    expect(found.map(issueLine)).toEqual([
      "Asking price (USD) on step 1: Please enter an amount above zero.",
      "Bedrooms on step 1: Please enter a whole number, zero or more.",
      "Listing URL on step 1: Please enter a full link, starting with https://.",
      "Year built on step 2: Please enter a year from 1600 to 2100.",
      "Email on step 3: Please enter a valid email address.",
      "Media budget on step 4: Please enter zero or more.",
    ]);
  });

  it("asks for what is empty and for a choice not made", () => {
    const found = fieldIssues(
      refusalOf({ ...owner, story: "", state: "", package: undefined, rightsConfirmed: false }),
    );
    expect(found.map((entry) => [entry.field, entry.message])).toEqual([
      ["state", t.forms.issue.choose],
      ["story", t.forms.fieldRequired],
      ["package", t.forms.issue.choose],
      ["rightsConfirmed", t.forms.issue.rights],
    ]);
  });

  it("takes the contract's own sentence for a rule between fields", () => {
    const found = fieldIssues(refusalOf({ ...owner, submitterKind: "agent", brokerage: "" }));
    expect(found.map(issueLine)).toEqual(["Brokerage on step 3: Name your brokerage"]);
  });

  it("reads the API's list the same way", () => {
    const found = fieldIssues([
      issue(["story"], "too_small", { type: "string" }),
      issue(["listingUrl"], "invalid_union"),
      issue(["architect"], "too_big", { type: "string" }),
      issue(["media", 0, "type"], "invalid_enum_value"),
      issue(["address"], "invalid_type", { received: "undefined" }),
      issue(["designer"], "invalid_literal"),
    ]);
    expect(found.map(issueLine)).toEqual([
      "Property address on step 1: Please fill in this field.",
      "Listing URL on step 1: Please enter a full link, starting with https://.",
      "Architect on step 2: Please shorten this entry.",
      "Designer on step 2: Please check this entry.",
      "The property story on step 2: Please fill in this field.",
      "Photography on step 2: Please check the photographs.",
    ]);
  });

  it("keeps one line per field, the first", () => {
    const found = fieldIssues([
      issue(["zip"], "too_small", { type: "string" }),
      issue(["zip"], "invalid_string"),
    ]);
    expect(found.map((entry) => entry.message)).toEqual([t.forms.fieldRequired]);
  });

  it("leaves out a path the wizard does not show", () => {
    expect(
      fieldIssues([
        issue(["sourcePath"], "too_big"),
        issue(["currency"], "invalid_enum_value"),
        issue([], "custom"),
        issue([3], "custom"),
        issue(["constructor"], "custom"),
        issue(["__proto__"], "custom"),
      ]),
    ).toEqual([]);
  });
});

describe("firstIssueStep", () => {
  it("is the earliest step with a refused field, and none without one", () => {
    expect(firstIssueStep([])).toBeUndefined();
    const found = fieldIssues([
      issue(["package"], "invalid_type"),
      issue(["zip"], "invalid_string"),
    ]);
    expect(firstIssueStep(found)).toBe(0);
    expect(firstIssueStep(found.slice(1))).toBe(3);
  });
});

describe("problemsOf", () => {
  const found = fieldIssues([issue(["submitterEmail"], "invalid_string")]);
  const problems = problemsOf(found, "wiz");

  it("marks a refused control and points it at the visible message", () => {
    expect(problems.control("submitterEmail")).toEqual({
      "aria-invalid": true,
      "aria-describedby": "wiz-submitterEmail-error",
    });
    expect(problems.field("submitterEmail")).toEqual({
      error: "Please enter a valid email address.",
      errorId: "wiz-submitterEmail-error",
    });
  });

  it("leaves every other control unmarked", () => {
    expect(problems.control("city")).toEqual({});
    expect(problems.field("city").error).toBeUndefined();
  });
});

describe("issuesOf", () => {
  it("reads a Zod error, an API refusal and nothing else", () => {
    const zod = new ZodError([{ code: "custom", path: ["story"], message: "Nope" }]);
    expect(issuesOf(zod)).toEqual([{ path: ["story"], code: "custom", message: "Nope" }]);

    const listed = [{ path: ["zip"], code: "invalid_string", message: "Invalid" }];
    expect(issuesOf(new ServiceError("validation", "Unprocessable Entity", 422, listed))).toEqual(
      listed,
    );
    expect(issuesOf(new ServiceError("validation", "Bad Request", 400))).toEqual([]);
    expect(issuesOf(new ServiceError("network", "Failed to fetch"))).toEqual([]);
    expect(issuesOf(new Error("boom"))).toEqual([]);
  });
});
