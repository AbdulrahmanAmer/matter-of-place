import { useState } from "react";
import { z } from "zod";
import type { AdminAsset, AssetCaptionInput } from "../../domain/admin-assets";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

const channels = [
  { name: "instagram", label: "Instagram" },
  { name: "x", label: "X" },
  { name: "linkedin", label: "LinkedIn" },
] as const;

type Channel = (typeof channels)[number]["name"];
type Draft = Record<Channel | "alt_text", string>;

const savedCaptions = z.object({
  instagram: z.string().optional(),
  x: z.string().optional(),
  linkedin: z.string().optional(),
});

/** What each field starts with: the saved variant, the asset's one caption where a variant is missing, and the alt text. */
function draftOf(asset: AdminAsset): Draft {
  const saved = savedCaptions.safeParse(asset.meta["captions"]);
  const variants = saved.success ? saved.data : {};
  return {
    instagram: variants.instagram ?? asset.caption ?? "",
    x: variants.x ?? asset.caption ?? "",
    linkedin: variants.linkedin ?? asset.caption ?? "",
    alt_text: asset.alt_text ?? "",
  };
}

function CaptionForm({
  asset,
  pending,
  error,
  onSave,
  onCancel,
}: {
  asset: AdminAsset;
  pending: boolean;
  error: string | null;
  onSave: (edit: Omit<AssetCaptionInput, "id">) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(asset));
  const [empty, setEmpty] = useState(false);

  const save = () => {
    const captions: Partial<Record<Channel, string>> = {};
    for (const { name } of channels) {
      const text = draft[name].trim();
      if (text !== "") captions[name] = text;
    }
    const altText = draft.alt_text.trim();
    if (Object.keys(captions).length === 0 && altText === "") {
      setEmpty(true);
      return;
    }
    onSave({
      ...(Object.keys(captions).length === 0 ? {} : { captions }),
      ...(altText === "" ? {} : { alt_text: altText }),
    });
  };

  return (
    <form
      className="admin-dialog__panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="admin-dialog__head">
        <h2>Edit caption</h2>
      </div>
      <div className="admin-dialog__body admin-caption">
        {channels.map(({ name, label }) => (
          <Field key={name} label={label}>
            {(control) => (
              <textarea
                {...control}
                rows={4}
                value={draft[name]}
                onChange={(event) => {
                  setDraft({ ...draft, [name]: event.target.value });
                  setEmpty(false);
                }}
              />
            )}
          </Field>
        ))}
        <Field
          label="Alt text"
          {...(empty
            ? { error: "Write a caption or an alt text." }
            : error === null
              ? {}
              : { error })}
        >
          {(control) => (
            <textarea
              {...control}
              rows={2}
              value={draft.alt_text}
              onChange={(event) => {
                setDraft({ ...draft, alt_text: event.target.value });
                setEmpty(false);
              }}
            />
          )}
        </Field>
      </div>
      <div className="admin-actions">
        <button type="submit" className="admin-button" disabled={pending}>
          Save caption
        </button>
        <button type="button" className="admin-button admin-button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The three caption variants and the alt text of one asset. The server checks each variant against the house voice. */
export function CaptionEditor({
  asset,
  pending,
  error,
  onSave,
  onCancel,
}: {
  asset: AdminAsset;
  pending: boolean;
  /** The server's refusal of the last save, shown under the alt text. */
  error: string | null;
  onSave: (edit: Omit<AssetCaptionInput, "id">) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onClose={onCancel} label="Edit caption">
      <CaptionForm
        asset={asset}
        pending={pending}
        error={error}
        onSave={onSave}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
