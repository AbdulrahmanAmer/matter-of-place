import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { TablesInsert } from "../../src/db/types";
import { submissionTransitions } from "../../src/domain/workflow";
import { FIXED_NOW, atFrom } from "../fixtures/clock";
import { fixtureDataset, formatCounts } from "../fixtures/dataset";
import { submissionRow } from "../fixtures/factories";

const base = FIXED_NOW;
const SOURCES = ["tests/fixtures/factories.ts", "tests/fixtures/dataset.ts"];

describe("submissionRow (GQ-03)", () => {
  it("gives the same row for the same n and another row for another n", () => {
    const first = submissionRow({ state: "Accepted", n: 3, base });
    const other = submissionRow({ state: "Accepted", n: 4, base });
    expect({
      same: submissionRow({ state: "Accepted", n: 3, base }),
      email: first.submitter_email,
      otherId: other.id === first.id,
      otherEmail: other.submitter_email === first.submitter_email,
    }).toEqual({
      same: first,
      email: "fixture+3@fixtures.invalid",
      otherId: false,
      otherEmail: false,
    });
  });

  it("lets an override win, and the row is a submissions insert", () => {
    const row = submissionRow({
      state: "Submitted",
      n: 1,
      base,
      submitter_kind: "owner",
      brokerage: null,
      city: "Sonoma",
    });
    expectTypeOf(row).toExtend<TablesInsert<"submissions">>();
    expect([row.submitter_kind, row.brokerage, row.city]).toEqual(["owner", null, "Sonoma"]);
  });

  it("dates review, acceptance and activation from base, as the state requires", () => {
    const seen = fixtureDataset.submissions.map(({ state }) => {
      const row = submissionRow({ state, n: 1, base });
      return [state, row.reviewed_at !== null, row.accepted_at !== null, row.activated_at !== null];
    });
    expect(seen).toEqual([
      ["Submitted", false, false, false],
      ["Under Review", false, false, false],
      ["Accepted", true, true, false],
      ["Declined", true, false, false],
      ["Awaiting Assets", true, false, false],
      ["Invoice Issued", true, true, false],
      ["Scheduled", true, true, true],
      ["Published", true, true, true],
      ["Distribution Active", true, true, true],
      ["Completed", true, true, true],
      ["Withdrawn", true, true, false],
    ]);
    expect(submissionRow({ state: "Completed", n: 1, base }).received_at).toBe(
      atFrom(base, -30).toISOString(),
    );
  });

  it("takes no time, randomness or id from outside its inputs", () => {
    const hits = SOURCES.filter((file) =>
      /Date\.now|Math\.random|randomUUID|new Date\(\)/.test(
        readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
      ),
    );
    expect(hits).toEqual([]);
  });
});

describe("fixtureDataset", () => {
  it("holds one submission per workflow state, each with its own n", () => {
    const { submissions } = fixtureDataset;
    expect({
      states: submissions.map(({ state }) => state),
      distinct: new Set(submissions.map(({ n }) => n)).size,
    }).toEqual({ states: Object.keys(submissionTransitions), distinct: submissions.length });
  });

  it("prints its counts in load order", () => {
    expect(
      formatCounts([
        { table: "submissions", count: 11 },
        { table: "invoices", count: 3 },
      ]),
    ).toBe("submissions 11, invoices 3");
  });
});
