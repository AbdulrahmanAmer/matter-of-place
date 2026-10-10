import { Field } from "../ui/Field";
import { newKey, type NoteValues } from "./market-values";
import { RowsEditor } from "./RowsEditor";

const blankNote = (): NoteValues => ({ key: newKey(), label: "", text: "" });

/** The notes of "How we read this market": a label and a paragraph each, in the order they are shown. */
export function MarketNotesEditor({
  notes,
  onChange,
}: {
  notes: readonly NoteValues[];
  onChange: (notes: NoteValues[]) => void;
}) {
  return (
    <RowsEditor heading="Notes" noun="Note" rows={notes} blank={blankNote} onChange={onChange}>
      {(note, n, update) => (
        <>
          <Field label={`Note ${String(n)} label`}>
            {(control) => (
              <input
                {...control}
                value={note.label}
                maxLength={120}
                onChange={(event) => {
                  update({ label: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={`Note ${String(n)} text`}>
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={note.text}
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
