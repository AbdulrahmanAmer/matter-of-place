import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  acceptedStates,
  exposurePackages,
  propertyTypes,
  submitterKindLabels,
  submitterKinds,
  uploadLimits,
} from "../../../domain/contracts";
import { track } from "../../../lib/analytics";
import { formatMoney, pluralize } from "../../../lib/format";
import { t } from "../../../lib/strings";
import { ChoiceGroup } from "../choice-group";
import { Field } from "../field";
import {
  isOutsideMarkets,
  maxFiles,
  otherState,
  submittedBy,
  toKindOption,
  toStateOption,
  toTypeOption,
  type SubmitDraft,
} from "./state";

type StepProps = {
  draft: SubmitDraft;
  update: <K extends keyof SubmitDraft>(key: K, value: SubmitDraft[K]) => void;
};

type TextKey = {
  [K in keyof SubmitDraft]: string extends SubmitDraft[K] ? K : never;
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
        onChange={(e) => update(name, e.target.value)}
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
            onChange={(e) => update("state", toStateOption(e.target.value))}
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
            onChange={(e) => update("propertyType", toTypeOption(e.target.value))}
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
          accept={uploadLimits.types.join(",")}
          multiple
          onChange={(e) => onChange(Array.from(e.target.files ?? []).slice(0, maxFiles))}
        />
        {files.length ? "Change selection" : "Choose files"}
      </label>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <li key={`${file.name}-${String(file.size)}`}>
              <span>{file.name}</span>
              <span>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AboutYouStep({ draft, update }: StepProps) {
  const bound = { draft, update };
  return (
    <>
      <h2>About you</h2>
      <Field label="I am">
        <select
          value={draft.submitterKind}
          onChange={(e) => update("submitterKind", toKindOption(e.target.value))}
        >
          <option value="">Select one</option>
          {submitterKinds.map((kind) => (
            <option key={kind} value={kind}>
              {submitterKindLabels[kind]}
            </option>
          ))}
        </select>
      </Field>
      {draft.submitterKind === "agent" && (
        <div className="field-grid">
          <Input label="Your name" name="submitterName" autoComplete="name" {...bound} />
          <Input label="Brokerage" name="brokerage" autoComplete="organization" {...bound} />
          <Input label="Email" name="submitterEmail" type="email" autoComplete="email" {...bound} />
          <Input label="Phone" name="submitterPhone" type="tel" autoComplete="tel" {...bound} />
          <Input
            label="MLS or source link"
            name="sourceUrl"
            type="url"
            placeholder="https://"
            {...bound}
          />
        </div>
      )}
      {draft.submitterKind === "owner" && (
        <>
          <div className="field-grid">
            <Input label="Your name" name="submitterName" autoComplete="name" {...bound} />
            <Input
              label="Email"
              name="submitterEmail"
              type="email"
              autoComplete="email"
              {...bound}
            />
            <Input label="Phone" name="submitterPhone" type="tel" autoComplete="tel" {...bound} />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.listedWithAgent}
              onChange={(e) => update("listedWithAgent", e.target.checked)}
            />
            This home is currently listed with an agent
          </label>
          {draft.listedWithAgent && (
            <div className="field-grid">
              <Input label="Listing agent name" name="listingAgentName" {...bound} />
              <Input label="Listing agent brokerage" name="listingAgentBrokerage" {...bound} />
            </div>
          )}
        </>
      )}
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
        I confirm I have the rights to share this property's photography and media, under the{" "}
        <Link to="/terms" hash="rights-to-photographs" className="text-link">
          {t.nav.terms}
        </Link>
        .
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
        ? `${String(draft.files.length)} ${pluralize(draft.files.length, "file")} selected`
        : draft.photographyUrl,
    ],
    ["Submitted by", submittedBy(draft)],
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
function ReviewTimeline() {
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
