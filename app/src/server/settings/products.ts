import { offerings } from "../../data/exposure.ts";
import type { ProductsPreview } from "../../domain/admin-settings.ts";
import {
  boundPlanIds,
  costAnswer,
  formatPrice,
  invoiceLine,
  plansFromOfferings,
  productsReadSchema,
  productsSettingSchema,
  toOffering,
  waysIn,
  type ProductPlan,
  type ProductsSetting,
} from "../../domain/exposure.ts";
import { formatUsd } from "../email/format.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { ActorKind } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { fromZod } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";
import type { PublicState } from "../public/state.ts";

/** The four plans of `src/data/exposure.ts`: the first stored row and the fallback when the setting is absent. */
export function seedProducts(): ProductPlan[] {
  return plansFromOfferings(offerings);
}

/**
 * The plans of the public state. A missing value is the seed, silently; a stored value that does not parse is the
 * seed too, with one `products_invalid` line, so a bad row never takes the page down.
 */
export function productsOf(state: Pick<PublicState, "products">): ProductPlan[] {
  if (state.products === null) return seedProducts();
  const parsed = productsReadSchema.safeParse(state.products);
  if (parsed.success) return parsed.data.plans;
  logLine("warn", "products_invalid", {
    issues: parsed.error.issues.length,
    first: parsed.error.issues[0]?.message ?? null,
  });
  return seedProducts();
}

// The screen's side (step 2): the dry run reads the stored row straight from the table, never through the public
// state memo, so it compares with what is saved now; the write is one `settings_put_products` call, which checks the
// plan set, the prices and the flag again, audits `settings.products_put` and raises catalog_version in one
// transaction.

const EDITABLE = ["name", "price", "line", "note", "items", "cta", "recommended"] as const;

/** Who saves the plans, as the audit row records them. */
interface ProductsWriter {
  id: string;
  kind: ActorKind;
  requestId: string;
  note: string;
}

const labelOf = (id: ProductPlan["id"]): string =>
  Object.entries(boundPlanIds).find(([, bound]) => bound === id)?.[0] ?? id;

/** The stored plans; null when the row is missing or no longer parses. */
async function readProducts(db: Db): Promise<ProductPlan[] | null> {
  const { data, error } = await db.from("settings").select("value").eq("key", "products");
  if (error !== null) throw fromRpcError(error);
  return productsReadSchema.safeParse(data[0]?.value).data?.plans ?? null;
}

const productsOrThrow = (input: unknown): ProductsSetting => {
  const parsed = productsSettingSchema.safeParse(input);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
};

/**
 * The dry run: what every surface would show from `input` and what changes against the stored plans (the seed when
 * none are stored, as the pages show it). Writes nothing; an invalid body is 422 `validation` with the issues.
 */
export async function previewProducts(db: Db, input: unknown): Promise<ProductsPreview> {
  const { plans } = productsOrThrow(input);
  const stored = (await readProducts(db)) ?? seedProducts();
  const changes = plans.flatMap((plan, index) => {
    const before = stored.find((other) => other.id === plan.id);
    if (before === undefined) return [];
    const edited = EDITABLE.filter(
      (field) => JSON.stringify(plan[field]) !== JSON.stringify(before[field]),
    );
    const moved = stored.indexOf(before) !== index;
    if (!moved && edited.length === 0) return [];
    return [
      { id: plan.id, name: plan.name, moved, edited, oldPrice: before.price, newPrice: plan.price },
    ];
  });
  const cards = plans.map(toOffering);
  return {
    plans,
    surfaces: {
      exposure: cards,
      home: cards,
      homeHeading: waysIn(plans.length),
      invoice: plans.map((plan) => ({
        product: labelOf(plan.id),
        description: invoiceLine(plan),
        amount: formatUsd(plan.price),
      })),
      faq: costAnswer(plans),
    },
    changes,
    warnings: [
      ...plans
        .filter((plan) => plan.name !== labelOf(plan.id))
        .map((plan) => `Forms and request screens still say ${labelOf(plan.id)}.`),
      ...changes
        .filter((change) => change.oldPrice !== change.newPrice)
        .map(
          (change) =>
            `${change.name} goes from ${formatPrice(change.oldPrice)} to ${formatPrice(change.newPrice)}: new invoices will use it; issued invoices keep theirs.`,
        ),
    ],
  };
}

/** Replaces the stored plans with `input` once it parses: one `settings_put_products` call, nothing else. */
export async function putProducts(
  db: Db,
  input: unknown,
  writer: ProductsWriter,
): Promise<ProductsSetting> {
  const value = productsOrThrow(input);
  const { error } = await db.rpc("settings_put_products", {
    p_value: value,
    p_actor: writer.id,
    p_actor_kind: writer.kind,
    p_request_id: writer.requestId,
    p_note: writer.note,
  });
  if (error !== null) throw fromRpcError(error);
  return value;
}
