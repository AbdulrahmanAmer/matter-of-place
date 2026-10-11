import { useState } from "react";
import type { ProductsPreview, SettingsAnswer } from "../../domain/admin-settings";
import { boundPlanIds, productsSettingSchema, type ProductPlan } from "../../domain/exposure";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";
import { useToast } from "../ui/use-toast";
import { usePreviewProducts, useSaveProducts } from "./settings-queries";

type PlanId = ProductPlan["id"];

interface PlanDraft {
  id: PlanId;
  name: string;
  price: string;
  line: string;
  note: string;
  items: string;
  cta: string;
  recommended: boolean;
}

type TextKey = "name" | "line" | "note" | "cta";

const textFields: { key: TextKey; label: string; hint: string }[] = [
  { key: "name", label: "Name", hint: "Shown on the cards, the invoice and the FAQ." },
  { key: "line", label: "Line", hint: "One sentence under the name." },
  { key: "note", label: "Media note", hint: "The qualifier under the price. Blank for none." },
  { key: "cta", label: "Link label", hint: "The link under the card." },
];

const fieldNames: Record<string, string> = {
  name: "name",
  price: "price",
  line: "line",
  note: "media note",
  items: "what it includes",
  cta: "link label",
  recommended: "recommended",
};

const labelOf = (id: PlanId) =>
  Object.entries(boundPlanIds).find(([, bound]) => bound === id)?.[0] ?? id;

const draftOf = (plans: readonly ProductPlan[]): PlanDraft[] =>
  plans.map((plan) => ({
    ...plan,
    price: String(plan.price),
    note: plan.note ?? "",
    items: plan.items.join("\n"),
  }));

/** The form as the schema reads it: a blank price is null, which it refuses, and one item per line. */
const valueOf = (draft: readonly PlanDraft[]): unknown => ({
  plans: draft.map((plan) => ({
    ...plan,
    price: plan.price.trim() === "" ? null : Number(plan.price),
    items: plan.items.split("\n"),
  })),
});

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "This change could not be saved.";

/** What the dry run answered: every surface from the form and what changes against the saved plans. */
function PreviewResult({ answer }: { answer: ProductsPreview }) {
  const { surfaces, changes, warnings } = answer;
  return (
    <section className="admin-plans__preview" aria-labelledby="products-preview">
      <h3 id="products-preview">Preview</h3>
      <p>Home title: {surfaces.homeHeading}</p>
      <ul aria-label="Cards">
        {surfaces.exposure.map((card) => (
          <li key={card.id}>
            {[
              card.name,
              card.price,
              card.note,
              card.recommended === true ? "Recommended" : undefined,
            ]
              .filter((part) => part !== undefined)
              .join(", ")}
          </li>
        ))}
      </ul>
      <ul aria-label="Invoice lines">
        {surfaces.invoice.map((line) => (
          <li key={line.product}>
            {line.description} {line.amount}
          </li>
        ))}
      </ul>
      <p>FAQ: {surfaces.faq}</p>
      {changes.length === 0 ? (
        <p>Nothing changes against the saved plans.</p>
      ) : (
        <ul aria-label="Changes">
          {changes.map((change) => (
            <li key={change.id}>
              {change.name}:{" "}
              {[
                ...(change.moved ? ["moved"] : []),
                ...change.edited.map((field) => fieldNames[field] ?? field),
              ].join(", ")}
            </li>
          ))}
        </ul>
      )}
      {warnings.length === 0 ? null : (
        <ul aria-label="Warnings" className="admin-plans__warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The four Property Exposure plans (B18, H80): each edited in place and moved up or down, one flagged as recommended.
 * Save stays off until a preview of exactly this form has answered, and a price change asks first.
 */
export function ProductsSection({ products }: { products: SettingsAnswer["products"] }) {
  const toast = useToast();
  const preview = usePreviewProducts();
  const save = useSaveProducts();
  const [draft, setDraft] = useState(() => draftOf((products.current ?? products.defaults).plans));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [previewed, setPreviewed] = useState<{ value: string; answer: ProductsPreview } | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const parsed = productsSettingSchema.safeParse(valueOf(draft));
  const formValue = parsed.success ? JSON.stringify(parsed.data) : null;
  const previewMatches = previewed !== null && previewed.value === formValue;
  const priceChanged =
    previewed?.answer.changes.some((change) => change.oldPrice !== change.newPrice) ?? false;
  const errorAt = (key: string) => {
    const error = errors[key];
    return error === undefined ? {} : { error };
  };
  const listError = errors["plans"];
  const setPlan = (index: number, next: Partial<PlanDraft>) => {
    setDraft(draft.map((plan, at) => (at === index ? { ...plan, ...next } : plan)));
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...draft];
    const [plan] = next.splice(index, 1);
    if (plan === undefined) return;
    next.splice(index + by, 0, plan);
    setDraft(next);
  };
  const runPreview = () => {
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    const value = JSON.stringify(parsed.data);
    preview.mutate(parsed.data, {
      onSuccess: (answer) => {
        setPreviewed({ value, answer });
      },
      onError: (error) => {
        toast({ message: failure(error), tone: "danger" });
      },
    });
  };
  const runSave = () => {
    if (!parsed.success) return;
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: "Plans saved." });
      },
      onError: (error) => {
        toast({ message: failure(error), tone: "danger" });
      },
      onSettled: () => {
        setConfirming(false);
      },
    });
  };
  return (
    <form
      className="admin-fields admin-plans"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!previewMatches) return;
        if (priceChanged) setConfirming(true);
        else runSave();
      }}
    >
      <p className="admin-field__hint">
        Each plan is bound to a product of the request forms; adding or removing a plan needs a
        migration. Price never stands for merit, and no plan promises leads, buyers or sales.
      </p>
      {draft.map((plan, index) => {
        const at = `plans.${String(index)}`;
        return (
          <fieldset key={plan.id} className="admin-plan">
            <legend>{labelOf(plan.id)}</legend>
            <p className="admin-plan__id">Id {plan.id}, fixed.</p>
            {textFields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                hint={field.hint}
                {...errorAt(`${at}.${field.key}`)}
              >
                {(control) => (
                  <input
                    {...control}
                    value={plan[field.key]}
                    onChange={(event) => {
                      setPlan(index, { [field.key]: event.target.value });
                    }}
                  />
                )}
              </Field>
            ))}
            <Field label="Price" hint="Whole dollars, 1 to 1,000,000." {...errorAt(`${at}.price`)}>
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={1}
                  step={1}
                  value={plan.price}
                  onChange={(event) => {
                    setPlan(index, { price: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field
              label="What it includes"
              hint="One line each, at most 12."
              {...errorAt(`${at}.items`)}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={6}
                  value={plan.items}
                  onChange={(event) => {
                    setPlan(index, { items: event.target.value });
                  }}
                />
              )}
            </Field>
            <label className="admin-plan__flag">
              <input
                type="radio"
                name="products-recommended"
                checked={plan.recommended}
                onChange={() => {
                  setDraft(draft.map((other) => ({ ...other, recommended: other.id === plan.id })));
                }}
              />
              Recommended
            </label>
            <div className="admin-actions">
              <button
                type="button"
                className="admin-button admin-button--quiet"
                disabled={index === 0}
                onClick={() => {
                  move(index, -1);
                }}
              >
                Move up
              </button>
              <button
                type="button"
                className="admin-button admin-button--quiet"
                disabled={index === draft.length - 1}
                onClick={() => {
                  move(index, 1);
                }}
              >
                Move down
              </button>
            </div>
          </fieldset>
        );
      })}
      <label className="admin-plan__flag">
        <input
          type="radio"
          name="products-recommended"
          checked={draft.every((plan) => !plan.recommended)}
          onChange={() => {
            setDraft(draft.map((plan) => ({ ...plan, recommended: false })));
          }}
        />
        No plan is recommended
      </label>
      {listError === undefined ? null : (
        <p className="admin-field__error" role="alert">
          {listError}
        </p>
      )}
      <div className="admin-actions">
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => {
            setDraft(draftOf(products.defaults.plans));
            setErrors({});
          }}
        >
          Start from the original plans
        </button>
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={preview.isPending}
          onClick={runPreview}
        >
          Preview
        </button>
        <button type="submit" className="admin-button" disabled={save.isPending || !previewMatches}>
          Save plans
        </button>
      </div>
      {previewed === null ? null : <PreviewResult answer={previewed.answer} />}
      <ConfirmDialog
        open={confirming}
        title="Change a price"
        confirmLabel="Save the new prices"
        pending={save.isPending}
        onConfirm={runSave}
        onCancel={() => {
          setConfirming(false);
        }}
      >
        <p>New invoices use the new prices; invoices already issued keep theirs.</p>
      </ConfirmDialog>
    </form>
  );
}
