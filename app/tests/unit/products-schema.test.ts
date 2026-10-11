import { describe, expect, it } from "vitest";
import { exposurePackages } from "../../src/domain/contracts";
import {
  boundPlanIds,
  formatPrice,
  plansFromOfferings,
  productPlanSchema,
  productsSettingSchema,
  waysIn,
} from "../../src/domain/exposure";
import { seedOfferings } from "../../src/data/exposure";

const MIGRATION = "adding or removing a plan needs a migration";
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const DASH = "Use a comma or a full stop, not a dash.";

type Plan = ReturnType<typeof plansFromOfferings>[number];

const seed = (): { plans: Plan[] } => ({ plans: plansFromOfferings(seedOfferings) });

function withPlan(index: number, change: Record<string, unknown>) {
  const body = seed();
  return { plans: body.plans.map((plan, at) => (at === index ? { ...plan, ...change } : plan)) };
}

function planAt(index: number): Plan {
  const found = seed().plans[index];
  if (found === undefined) throw new Error(`the seed has no plan ${String(index)}`);
  return found;
}

function messages(body: unknown): string[] {
  const parsed = productsSettingSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("productsSettingSchema: the four bound plans", () => {
  it("takes the seed and keeps its four plans in order", () => {
    const parsed = productsSettingSchema.parse(seed());
    expect(parsed.plans.map((plan) => plan.id)).toEqual([
      "feature",
      "reach",
      "campaign",
      "five-features",
    ]);
    expect(parsed).toEqual(seed());
  });

  it("takes the four plans in another order", () => {
    const body = seed();
    const reordered = { plans: [...body.plans].reverse() };
    expect(productsSettingSchema.parse(reordered).plans.map((plan) => plan.id)).toEqual([
      "five-features",
      "campaign",
      "reach",
      "feature",
    ]);
  });

  it.each([0, 3, 5, 7])("refuses a body with %i plans with the migration message", (count) => {
    const plans = Array.from({ length: count }, (_, at) => ({
      ...planAt(at % 4),
      name: `Plan number ${String(at)}`,
    }));
    expect(messages({ plans })).toEqual([MIGRATION]);
  });

  it("refuses a missing id, a repeated id and an unknown id with the migration message", () => {
    const missing = withPlan(3, { id: "feature" });
    const repeated = withPlan(1, { id: "feature" });
    const unknown = withPlan(2, { id: "retainer" });
    expect([missing, repeated, unknown].map(messages)).toEqual([
      [MIGRATION],
      [MIGRATION],
      [MIGRATION],
    ]);
  });
});

describe("productsSettingSchema: one plan", () => {
  it.each([0, 1.5, "295", 1_000_001, -295, null])("refuses the price %j", (price) => {
    expect(messages(withPlan(0, { price }))).not.toEqual([]);
  });

  it("takes the lowest and the highest price", () => {
    expect(messages(withPlan(0, { price: 1 }))).toEqual([]);
    expect(messages(withPlan(0, { price: 1_000_000 }))).toEqual([]);
  });

  it("refuses two recommended plans and takes one or none", () => {
    expect(messages(withPlan(0, { recommended: true }))).toEqual([
      "Only one plan can be recommended.",
    ]);
    const none = seed();
    const cleared = { plans: none.plans.map((plan) => ({ ...plan, recommended: false })) };
    expect(messages(cleared)).toEqual([]);
  });

  it("refuses a name another plan already has, whatever its case", () => {
    expect(messages(withPlan(0, { name: "THE REACH" }))).toEqual(["Each plan needs its own name."]);
  });

  it.each(["name", "line", "note", "cta"])("refuses an em dash and an en dash in %s", (field) => {
    expect(messages(withPlan(0, { [field]: `Quiet ${EM} and calm` }))).toEqual([DASH]);
    expect(messages(withPlan(0, { [field]: `Quiet ${EN} and calm` }))).toEqual([DASH]);
  });

  it("refuses a dash in a line of items", () => {
    expect(messages(withPlan(0, { items: ["Fine", `Not ${EM} fine`] }))).toEqual([DASH]);
  });

  it("takes one plan on its own, a missing recommended flag reading as false", () => {
    const withoutFlag = Object.fromEntries(
      Object.entries(planAt(0)).filter(([key]) => key !== "recommended"),
    );
    expect(productPlanSchema.parse(withoutFlag)).toEqual(planAt(0));
  });

  it("refuses an unknown key on a plan and on the setting", () => {
    expect(messages(withPlan(0, { sku: "x" }))).not.toEqual([]);
    expect(messages({ ...seed(), extra: true })).not.toEqual([]);
  });

  it("turns a blank or missing note into null and trims a note", () => {
    const blank = productsSettingSchema.parse(withPlan(2, { note: "   " }));
    expect(blank.plans[2]?.note).toBeNull();
    const withoutNote = Object.fromEntries(
      Object.entries(planAt(2)).filter(([key]) => key !== "note"),
    );
    const missing = productsSettingSchema.parse({
      plans: seed().plans.map((plan, at) => (at === 2 ? withoutNote : plan)),
    });
    expect(missing.plans[2]?.note).toBeNull();
    const padded = productsSettingSchema.parse(withPlan(2, { note: "  $250 per property  " }));
    expect(padded.plans[2]?.note).toBe("$250 per property");
  });

  it("trims the items and drops the blank lines", () => {
    const parsed = productsSettingSchema.parse(
      withPlan(0, { items: ["  One  ", "", "   ", "Two"] }),
    );
    expect(parsed.plans[0]?.items).toEqual(["One", "Two"]);
  });

  it("refuses more than 12 items and a text over its length", () => {
    const many = Array.from({ length: 13 }, (_, at) => `Item ${String(at)}`);
    expect(messages(withPlan(0, { items: many }))).not.toEqual([]);
    expect(messages(withPlan(0, { name: "x".repeat(61) }))).not.toEqual([]);
    expect(messages(withPlan(0, { line: "x".repeat(161) }))).not.toEqual([]);
  });
});

describe("formatPrice and waysIn", () => {
  it("prints whole dollars with comma separators", () => {
    expect([295, 695, 1250, 1495, 1_000_000].map(formatPrice)).toEqual([
      "$295",
      "$695",
      "$1,250",
      "$1,495",
      "$1,000,000",
    ]);
  });

  it("reads the count of plans as a title", () => {
    expect([1, 3, 4, 12].map(waysIn)).toEqual([
      "One way in.",
      "Three ways in.",
      "Four ways in.",
      "12 ways in.",
    ]);
  });
});

describe("boundPlanIds", () => {
  it("has the labels of exposurePackages without Not sure yet, and the ids of the offerings", () => {
    expect(Object.keys(boundPlanIds)).toEqual(
      exposurePackages.filter((label) => label !== "Not sure yet"),
    );
    expect(Object.values(boundPlanIds)).toEqual(seedOfferings.map((offering) => offering.id));
  });
});
