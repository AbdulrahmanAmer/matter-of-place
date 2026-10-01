import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { acceptedStates, exposurePackages, propertyTypes } from "../../../domain/contracts";
import { track } from "../../../lib/analytics";
import { formatMoney, pluralize } from "../../../lib/format";
import { ChoiceGroup } from "../choice-group";
import { Field } from "../field";
import { isOutsideMarkets, maxFiles, otherState, type SubmitDraft } from "./state";

type StepProps = {
  draft: SubmitDraft;
  update: <K extends keyof SubmitDraft>(key: K, value: SubmitDraft[K]) => void;
};

type TextKey = {
  [K in keyof SubmitDraft]: SubmitDraft[K] extends string ? K : never;
}[keyof SubmitDraft];

/** A text-like input bound to one draft field. */
function Input({
  label,
  name,
  draft,
  update,
  type = "text",
  ...rest
}: StepProps & {
  label: string;
  name: TextKey;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "decimal";
  min?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={draft[name]}
        onChange={(e) => update(name, e.target.value as never)}
        {...rest}
      />
    </Field>
  );
}

export function PropertyStep({ draft, update }: StepProps) {
  const price = Number(draft.price);
  const bound = { draft, update };
  return (
    <>
      <h2>The property</h2>
      <div className="field-grid">
        <Input label="Property address" name="address" autoComplete="street-address" {...bound} />
        <Input label="City" name="city" {...bound} />
        <Field label="State">
          <select
            value={draft.state}
            onChange={(e) => update("state", e.target.value as SubmitDraft["state"])}
          >
            <option value="">Select state</option>
            {acceptedStates.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
            <option value={otherState}>{otherState}</option>
          </select>
        </Field>
        <Input label="ZIP" name="zip" inputMode="numeric" autoComplete="postal-code" {...bound} />
      </div>

      {isOutsideMarkets(draft) && (
        <p className="form-notice" role="status">
          Matter of Place is currently accepting submissions from California, New York and Florida.
        </p>
      )}

      <div className="field-grid">
        <Field label="Property type">
          <select
            value={draft.propertyType}
            onChange={(e) => update("propertyType", e.target.value as SubmitDraft["propertyType"])}
          >
            <option value="">Select type</option>
            {propertyTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Input label="Asking price (USD)" name="price" type="number" min={0} {...bound} />
        <Input label="Bedrooms" name="beds" type="number" min={0} {...bound} />
        <Input label="Bathrooms" name="baths" type="number" min={0} step={0.5} {...bound} />
        <Input
          label="Approximate square feet"
          name="interiorSqFt"
          type="number"
          min={0}
          {...bound}
        />
        <Input label="Listing URL" name="listingUrl" type="url" placeholder="https://" {...bound} />
      </div>
      {price > 0 && <p className="price-preview">Shown as: {formatMoney(price, "USD")}</p>}
    </>
  );
}

export function StoryStep({ draft, update }: StepProps) {
  const bound = { draft, update };
  return (
    <>
      <h2>The story</h2>
      <div className="field-grid">
        <Input label="Architect, if known" name="architect" {...bound} />
        <Input label="Designer, if known" name="designer" {...bound} />
        <Input label="Year built" name="yearBuilt" type="number" min={1600} {...bound} />
        <Input label="Year renovated" name="yearRenovated" type="number" min={1600} {...bound} />
      </div>
      <Field label="The property story">
        <textarea rows={5} value={draft.story} onChange={(e) => update("story", e.target.value)} />
      </Field>
      <Field label="What makes this property significant?">
        <textarea
          rows={4}
          value={draft.significance}
          onChange={(e) => update("significance", e.target.value)}
        />
      </Field>
      <div className="field-grid">
        <Input
          label="Photography link"
          name="photographyUrl"
          type="url"
          placeholder="https://"
          {...bound}
        />
        <Input label="Video link" name="videoUrl" type="url" placeholder="https://" {...bound} />
      </div>
      <PhotographyPicker files={draft.files} onChange={(files) => update("files", files)} />
    </>
  );
}

function PhotographyPicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div className="upload">
      <span className="upload-title">Photography</span>
      <p className="upload-hint">Or upload up to {maxFiles} high-resolution images.</p>
      <label className="upload-button">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => onChange(Array.from(e.target.files ?? []).slice(0, maxFiles))}
        />
        {files.length ? "Change selection" : "Choose files"}
      </label>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              <span>{file.name}</span>
              <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RepresentationStep({ draft, update }: StepProps) {
  const bound = { draft, update };
  return (
    <>
      <h2>Representation</h2>
      <div className="field-grid">
        <Input label="Listing agent" name="agentName" autoComplete="name" {...bound} />
        <Input label="Brokerage" name="brokerage" autoComplete="organization" {...bound} />
        <Input label="Agent email" name="agentEmail" type="email" autoComplete="email" {...bound} />
        <Input label="Agent phone" name="agentPhone" type="tel" autoComplete="tel" {...bound} />
        <Input
          label="MLS or source link"
          name="sourceUrl"
          type="url"
          placeholder="https://"
          {...bound}
        />
      </div>
    </>
  );
}

export function ExposureStep({ draft, update }: StepProps) {
  return (
    <>
      <h2>Preferred exposure</h2>
      <p className="form-lede">Confirmed only after editorial review. Nothing is charged now.</p>
      <ChoiceGroup
        label="Preferred exposure"
        options={exposurePackages}
        value={draft.package}
        onChange={(value) => update("package", value)}
      />
      <Input
        label="Optional media budget (USD)"
        name="mediaBudget"
        type="number"
        min={0}
        draft={draft}
        update={update}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={draft.rightsConfirmed}
          onChange={(e) => update("rightsConfirmed", e.target.checked)}
        />
        I confirm I have the rights to share this property's photography and media.
      </label>
      <Link
        to="/exposure"
        className="text-link"
        onClick={() => track("package_interest", { package: "submit_compare" })}
      >
        Compare Property Exposure
      </Link>
    </>
  );
}

export function ReviewStep({ draft }: { draft: SubmitDraft }) {
  const price = Number(draft.price);
  const budget = Number(draft.mediaBudget);
  const rows: [label: string, value: ReactNode][] = [
    ["Address", [draft.address, draft.city, draft.state, draft.zip].filter(Boolean).join(", ")],
    ["Type", draft.propertyType],
    ["Price", price > 0 ? formatMoney(price, "USD") : ""],
    ["Architect", draft.architect],
    [
      "Photography",
      draft.files.length
        ? `${draft.files.length} ${pluralize(draft.files.length, "file")} selected`
        : draft.photographyUrl,
    ],
    ["Representation", [draft.agentName, draft.brokerage].filter(Boolean).join(", ")],
    ["Exposure", draft.package ?? ""],
    ["Media budget", budget > 0 ? formatMoney(budget, "USD") : ""],
  ];
  return (
    <>
      <h2>Review</h2>
      <dl className="review-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "Not stated"}</dd>
          </div>
        ))}
      </dl>
      <ReviewTimeline />
    </>
  );
}

const reviewSteps = [
  "Submit",
  "Editorial review",
  "Acceptance",
  "Exposure",
  "Publish",
  "Distribute",
];

/** The path every submission follows. Payment comes only after acceptance. */
export function ReviewTimeline() {
  return (
    <div className="review-timeline">
      <ol>
        {reviewSteps.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ol>
      <p>
        Every property is reviewed against our editorial standard. Payment does not override
        selection. If a property is not accepted, nothing is charged.
      </p>
    </div>
  );
}
