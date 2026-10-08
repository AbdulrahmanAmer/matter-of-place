import { useState } from "react";
import type { PropertyPatch } from "../../domain/admin-properties";
import { propertyTypes } from "../../domain/contracts";
import { propertySchema } from "../../domain/property";
import { Field } from "../ui/Field";
import { numberOrNull, textOrNull, type EditFields, type EditorValues } from "./editor-values";

type TextKey =
  "region_slug" | "neighborhood" | "country" | "style" | "architect" | "designer" | "listing_url";
type NumberKey = "price" | "beds" | "baths" | "interior_sq_ft" | "lot_acres" | "year_built";

const requiredFields: readonly { key: "address" | "city"; label: string }[] = [
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
];

const textFields: readonly { key: TextKey; label: string; hint?: string }[] = [
  { key: "region_slug", label: "Region", hint: "The region's slug, for example bay-area." },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "country", label: "Country" },
  { key: "style", label: "Style" },
  { key: "architect", label: "Architect" },
  { key: "designer", label: "Designer" },
  { key: "listing_url", label: "Listing address" },
];

const numberFields: readonly { key: NumberKey; label: string }[] = [
  { key: "price", label: "Price (USD)" },
  { key: "beds", label: "Beds" },
  { key: "baths", label: "Baths" },
  { key: "interior_sq_ft", label: "Interior (sq ft)" },
  { key: "lot_acres", label: "Lot (acres)" },
  { key: "year_built", label: "Year built" },
];

const statuses = propertySchema.shape.status.options;

/** A number box keeps what is typed ("3." on the way to "3.5") and reads it as a number or null. */
function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  // A reload over the field shows the row's value; what the editor is typing is left alone.
  if (numberOrNull(text) !== value) setText(value === null ? "" : String(value));
  return (
    <Field label={label}>
      {(control) => (
        <input
          {...control}
          inputMode="decimal"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(numberOrNull(event.target.value));
          }}
        />
      )}
    </Field>
  );
}

/** The ordered features, one a line, saved as a whole list through `PUT properties/:id/features`. */
function FeaturesField({
  features,
  onSave,
}: {
  features: readonly string[];
  onSave: (features: string[]) => void;
}) {
  const [text, setText] = useState(features.join("\n"));
  const listed = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    <div className="admin-editor__list">
      <Field label="Features" hint="One a line, in the order the page lists them.">
        {(control) => (
          <textarea
            {...control}
            rows={6}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        )}
      </Field>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={listed.join("\n") === features.join("\n")}
        onClick={() => {
          onSave(listed);
        }}
      >
        Save features
      </button>
    </div>
  );
}

/** Screen 8, Facts: the numbers and names of the dossier. The slug is fixed once the property was first published. */
export function FactsTab({
  values,
  slugLocked,
  features,
  onEdit,
  onSaveFeatures,
}: {
  values: EditorValues;
  slugLocked: boolean;
  features: readonly string[];
  onEdit: EditFields;
  onSaveFeatures: (features: string[]) => void;
}) {
  return (
    <div className="admin-editor__fields">
      <Field
        label="Slug"
        hint={slugLocked ? "Fixed since the first publication." : "The page address."}
      >
        {(control) => (
          <input
            {...control}
            value={values.slug}
            readOnly={slugLocked}
            maxLength={120}
            onChange={(event) => {
              onEdit({ slug: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label="Type">
        {(control) => (
          <select
            {...control}
            value={values.type}
            onChange={(event) => {
              const type = propertyTypes.find((option) => option === event.target.value);
              if (type !== undefined) onEdit({ type });
            }}
          >
            {propertyTypes.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Status">
        {(control) => (
          <select
            {...control}
            value={values.status}
            onChange={(event) => {
              const status = statuses.find((option) => option === event.target.value);
              if (status !== undefined) onEdit({ status });
            }}
          >
            {statuses.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        )}
      </Field>
      {requiredFields.map(({ key, label }) => (
        <Field key={key} label={label}>
          {(control) => (
            <input
              {...control}
              required
              value={values[key]}
              onChange={(event) => {
                const patch: Partial<PropertyPatch> = {};
                patch[key] = event.target.value;
                onEdit(patch);
              }}
            />
          )}
        </Field>
      ))}
      {textFields.map(({ key, label, hint }) => (
        <Field key={key} label={label} {...(hint === undefined ? {} : { hint })}>
          {(control) => (
            <input
              {...control}
              value={values[key] ?? ""}
              onChange={(event) => {
                const patch: Partial<PropertyPatch> = {};
                patch[key] = textOrNull(event.target.value);
                onEdit(patch);
              }}
            />
          )}
        </Field>
      ))}
      {numberFields.map(({ key, label }) => (
        <NumberInput
          key={key}
          label={label}
          value={values[key]}
          onChange={(value) => {
            const patch: Partial<PropertyPatch> = {};
            patch[key] = value;
            onEdit(patch);
          }}
        />
      ))}
      <FeaturesField features={features} onSave={onSaveFeatures} />
    </div>
  );
}
