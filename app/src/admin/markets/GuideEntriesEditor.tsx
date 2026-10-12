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

const sectionLabel = (section: string) =>
  Object.entries(guideSectionLabels).find(([key]) => key === section)?.[1] ?? section;

/**
 * The market guide: neighborhoods (each in a region), what clients ask and how we work, in the order they are shown.
 * `regions` are the regions the market has, by slug and by the name a person reads.
 */
export function GuideEntriesEditor({
  entries,
  regions,
  onChange,
}: {
  entries: readonly GuideValues[];
  regions: readonly { slug: string; name: string }[];
  onChange: (entries: GuideValues[]) => void;
}) {
  const regionName = (slug: string) =>
    slug === ""
      ? "the whole market"
      : (regions.find((region) => region.slug === slug)?.name ?? slug);
  return (
    <RowsEditor
      id="market-guide"
      heading="Guide"
      lead="Neighborhoods, what clients ask and how we work, in the order the market page shows them."
      noun="Guide entry"
      rows={entries}
      blank={blankEntry}
      title={(entry) => entry.label}
      meta={(entry) => `${sectionLabel(entry.section)} · ${regionName(entry.region_slug)}`}
      invalid={(entry) => entry.section === "neighborhood" && entry.region_slug === ""}
      onChange={onChange}
    >
      {(entry, n, update) => (
        <>
          <Field label="Section" context={`Guide entry ${String(n)}`}>
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
            label="Region"
            context={`Guide entry ${String(n)}`}
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
                  <option key={region.slug} value={region.slug}>
                    {region.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Label" context={`Guide entry ${String(n)}`}>
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
          <Field label="Text" context={`Guide entry ${String(n)}`}>
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
