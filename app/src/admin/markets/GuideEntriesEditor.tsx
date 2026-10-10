import { marketGuideSections } from "../../domain/admin-markets";
import { Field } from "../ui/Field";
import { guideSectionLabels, newKey, type GuideValues } from "./market-values";
import { RowsEditor } from "./RowsEditor";

const blankEntry = (): GuideValues => ({
  key: newKey(),
  section: "need",
  region_slug: "",
  label: "",
  text: "",
});

/**
 * The market guide: neighborhoods (each in a region), what clients ask and how we work, in the order they are shown.
 * `regions` are the slugs of the regions the market has.
 */
export function GuideEntriesEditor({
  entries,
  regions,
  onChange,
}: {
  entries: readonly GuideValues[];
  regions: readonly string[];
  onChange: (entries: GuideValues[]) => void;
}) {
  return (
    <RowsEditor
      heading="Guide entries"
      noun="Guide entry"
      rows={entries}
      blank={blankEntry}
      onChange={onChange}
    >
      {(entry, n, update) => (
        <>
          <Field label={`Guide entry ${String(n)} section`}>
            {(control) => (
              <select
                {...control}
                value={entry.section}
                onChange={(event) => {
                  update({ section: event.target.value });
                }}
              >
                {marketGuideSections.map((section) => (
                  <option key={section} value={section}>
                    {guideSectionLabels[section]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={`Guide entry ${String(n)} region`}
            {...(entry.section === "neighborhood" && entry.region_slug === ""
              ? { error: "A neighborhood belongs to a region." }
              : {})}
          >
            {(control) => (
              <select
                {...control}
                value={entry.region_slug}
                onChange={(event) => {
                  update({ region_slug: event.target.value });
                }}
              >
                <option value="">The whole market</option>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={`Guide entry ${String(n)} label`}>
            {(control) => (
              <input
                {...control}
                value={entry.label}
                maxLength={120}
                onChange={(event) => {
                  update({ label: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={`Guide entry ${String(n)} text`}>
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={entry.text}
                maxLength={2000}
                onChange={(event) => {
                  update({ text: event.target.value });
                }}
              />
            )}
          </Field>
        </>
      )}
    </RowsEditor>
  );
}
