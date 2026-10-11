import { z } from "zod";

/** A Property Exposure product, shown on the home page and the Exposure page. */
export type Offering = {
  id: "feature" | "reach" | "campaign" | "five-features";
  name: string;
  /** Display price, already formatted ("$295"). */
  price: string;
  /** One-line purpose. */
  line: string;
  /** Optional qualifier under the price ("$250 per property"). */
  note?: string;
  items: string[];
  cta: string;
  recommended?: boolean;
};

/** Programmatic media terms, billed separately from editorial products. */
export type ProgrammaticTerms = {
  minimum: string;
  managementFee: string;
  minimumFee: string;
  formats: string[];
};

// `settings.products` (H80): the four plans an owner edits without a deploy. The stored keys, the API JSON and these
// field names are one shape (G-004); `settings_put_products` in SQL says the same rules.

/** Each `exposure_package` label that is a plan, bound to the id of its plan. "Not sure yet" is not a plan. */
export const boundPlanIds = {
  "The Feature": "feature",
  "The Reach": "reach",
  "The Campaign": "campaign",
  "Five Features": "five-features",
} as const satisfies Record<string, Offering["id"]>;

const planIds = [
  "feature",
  "reach",
  "campaign",
  "five-features",
] as const satisfies Offering["id"][];

const PLAN_COUNT_MESSAGE = "adding or removing a plan needs a migration";
const DASH_MESSAGE = "Use a comma or a full stop, not a dash.";

const noDash = (value: string): boolean => !/[\u2013\u2014]/.test(value);
const blankToNull = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const text = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine(noDash, DASH_MESSAGE);

const planObject = z.object({
  id: z.enum(planIds, { errorMap: () => ({ message: PLAN_COUNT_MESSAGE }) }),
  name: text(2, 60),
  price: z.number().int().min(1).max(1_000_000),
  line: text(1, 160),
  note: z.preprocess(blankToNull, text(1, 120).nullable()).default(null),
  items: z
    .array(z.string())
    .transform((lines) => lines.map((line) => line.trim()).filter((line) => line !== ""))
    .pipe(z.array(text(1, 140)).max(12)),
  cta: text(2, 40),
  recommended: z.boolean().default(false),
});

const settingOf = <Plan extends z.ZodType<ProductPlan, z.ZodTypeDef, unknown>>(plan: Plan) =>
  z.object({
    plans: z.array(plan).superRefine((plans, context) => {
      const ids = new Set(plans.map((item) => item.id));
      if (plans.length !== planIds.length || ids.size !== planIds.length) {
        context.addIssue({ code: "custom", message: PLAN_COUNT_MESSAGE });
        return;
      }
      if (plans.filter((item) => item.recommended).length > 1) {
        context.addIssue({ code: "custom", message: "Only one plan can be recommended." });
      }
      const names = new Set(plans.map((item) => item.name.toLowerCase()));
      if (names.size !== plans.length) {
        context.addIssue({ code: "custom", message: "Each plan needs its own name." });
      }
    }),
  });

/** What a save accepts: an unknown key is refused. */
export const productPlanSchema = planObject.strict();
export const productsSettingSchema = settingOf(productPlanSchema).strict();
/** What a read accepts: the same rules, an unknown key is ignored, so a field added later never throws away the stored plans. */
export const productsReadSchema = settingOf(planObject);

export type ProductPlan = z.output<typeof planObject>;

/** "$" and the whole dollars with comma thousands separators. A regular expression, not `toLocaleString`, so the server and the browser print the same text. */
export function formatPrice(dollars: number): string {
  return `$${String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** The stored plans for a list of offerings: each display price ("$1,495") becomes whole dollars (1495). */
export function plansFromOfferings(offerings: readonly Offering[]): ProductPlan[] {
  return offerings.map((offering) => ({
    id: offering.id,
    name: offering.name,
    price: Number(offering.price.replace(/\D/g, "")),
    line: offering.line,
    note: offering.note ?? null,
    items: [...offering.items],
    cta: offering.cta,
    recommended: offering.recommended === true,
  }));
}

const NUMBER_WORDS = [
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];

/** The title of the home pricing block: "Four ways in." for four plans. */
export function waysIn(count: number): string {
  const word = NUMBER_WORDS[count - 1] ?? String(count);
  return `${word} ${count === 1 ? "way" : "ways"} in.`;
}
