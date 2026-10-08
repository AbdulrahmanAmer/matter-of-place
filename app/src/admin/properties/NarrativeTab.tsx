import { Field } from "../ui/Field";
import { textOrNull, type EditFields, type EditorValues } from "./editor-values";

const PARAGRAPH_BREAK = /\n\s*\n/;

/** Screen 8, Narrative: the title, the story as paragraphs (a blank line starts the next one) and the place. */
export function NarrativeTab({
  values,
  onEdit,
}: {
  values: Pick<EditorValues, "title" | "story" | "place">;
  onEdit: EditFields;
}) {
  return (
    <div className="admin-editor__fields">
      <Field label="Title">
        {(control) => (
          <input
            {...control}
            value={values.title}
            maxLength={200}
            onChange={(event) => {
              onEdit({ title: event.target.value });
            }}
          />
        )}
      </Field>
      <Field label="Story" hint="A blank line starts a new paragraph. Two paragraphs at least.">
        {(control) => (
          <textarea
            {...control}
            rows={12}
            value={values.story.join("\n\n")}
            onChange={(event) => {
              onEdit({ story: event.target.value.split(PARAGRAPH_BREAK) });
            }}
          />
        )}
      </Field>
      <Field label="Place" hint="The street, the light, what is near.">
        {(control) => (
          <textarea
            {...control}
            rows={5}
            value={values.place ?? ""}
            onChange={(event) => {
              onEdit({ place: textOrNull(event.target.value) });
            }}
          />
        )}
      </Field>
    </div>
  );
}
