import { useState } from "react";
import { createPropertyInputSchema } from "../../domain/admin-properties";
import { propertyTypes } from "../../domain/contracts";
import type { MarketSlug } from "../../domain/market";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

const markets: readonly { slug: MarketSlug; label: string }[] = [
  { slug: "california", label: "California" },
  { slug: "new-york", label: "New York" },
  { slug: "florida", label: "Florida" },
];

type Errors = Partial<Record<"title" | "city" | "address" | "price", string>>;

/**
 * A property entered by hand (operator, 2026-10-12: "I need to be able to manually put properties in"): the four facts
 * every property needs and, if known, the price. The draft opens on the property screen, where photographs, the story
 * and the rest are added and the usual publish checks apply.
 */
export function NewPropertyDialog({
  open,
  pending,
  refusal,
  onClose,
  onCreate,
}: {
  open: boolean;
  pending: boolean;
  refusal: string | null;
  onClose: () => void;
  onCreate: (input: ReturnType<typeof createPropertyInputSchema.parse>) => void;
}) {
  const [title, setTitle] = useState("");
  const [market, setMarket] = useState<MarketSlug>("california");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<(typeof propertyTypes)[number]>("Residence");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  return (
    <Dialog open={open} onClose={onClose} label="New property">
      <form
        className="admin-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const digits = price.replace(/[^0-9.]/g, "");
          const parsed = createPropertyInputSchema.safeParse({
            title,
            market_slug: market,
            city,
            address,
            type,
            price: digits === "" ? null : Number(digits),
          });
          if (!parsed.success) {
            const found: Errors = {};
            for (const issue of parsed.error.issues) {
              const field = issue.path[0];
              if (field === "title" || field === "city" || field === "address") {
                found[field] = issue.message;
              }
              if (field === "price") found.price = "Give the price in dollars, or leave it empty.";
            }
            setErrors(found);
            return;
          }
          setErrors({});
          onCreate(parsed.data);
        }}
      >
        <h2>New property</h2>
        <p>
          The draft opens on its own screen, where you add the photographs, the story and the rest.
          Nothing is public until you publish it.
        </p>
        <Field
          label="Title"
          hint="As it will read on the site."
          {...(errors.title === undefined ? {} : { error: errors.title })}
        >
          {(control) => (
            <input
              {...control}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Market">
          {(control) => (
            <select
              {...control}
              value={market}
              onChange={(event) => {
                const chosen = markets.find((item) => item.slug === event.target.value);
                if (chosen !== undefined) setMarket(chosen.slug);
              }}
            >
              {markets.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="City" {...(errors.city === undefined ? {} : { error: errors.city })}>
          {(control) => (
            <input
              {...control}
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Address" {...(errors.address === undefined ? {} : { error: errors.address })}>
          {(control) => (
            <input
              {...control}
              autoComplete="off"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Type">
          {(control) => (
            <select
              {...control}
              value={type}
              onChange={(event) => {
                const chosen = propertyTypes.find((item) => item === event.target.value);
                if (chosen !== undefined) setType(chosen);
              }}
            >
              {propertyTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Price"
          hint="In US dollars. Leave it empty if it is not public."
          {...(errors.price === undefined ? {} : { error: errors.price })}
        >
          {(control) => (
            <input
              {...control}
              inputMode="numeric"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
              }}
            />
          )}
        </Field>
        {refusal === null ? null : <p role="alert">{refusal}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="admin-button" disabled={pending}>
            {pending ? "Creating" : "Create the draft"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
