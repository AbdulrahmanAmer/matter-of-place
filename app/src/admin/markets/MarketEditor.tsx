import { useState } from "react";
import type { MarketDetail } from "../../domain/admin-markets";
import { UploadZone } from "../media/UploadZone";
import type { PickedFile } from "../media/media-queries";
import { AdminApiError } from "../ui/admin-fetch";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import { ComingSoonToggle } from "./ComingSoonToggle";
import { GuideEntriesEditor } from "./GuideEntriesEditor";
import { MarketNotesEditor } from "./MarketNotesEditor";
import { RegionsEditor } from "./RegionsEditor";
import {
  changesOf,
  isDirty,
  isValid,
  savedFrom,
  validOrder,
  valuesOf,
  type MarketValues,
} from "./market-values";
import { stageMarketImage, useSaveMarket } from "./markets-queries";

/**
 * Screen 15, one market. Save sends the market fields that changed, the regions that changed and the notes and guide
 * entries in the order shown, and leaves out whatever was not touched. Images are staged by the browser and rendered
 * by B9's job after Save (G51); until then the stored image stays.
 */
export function MarketEditor({ market }: { market: MarketDetail }) {
  const toast = useToast();
  const [saved, setSaved] = useState(() => valuesOf(market));
  const [values, setValues] = useState(saved);
  const [uploading, setUploading] = useState(false);
  const save = useSaveMarket();

  const dirty = isDirty(saved, values);
  const canSave = dirty && isValid(values) && !save.isPending && !uploading;

  const edit = (fields: Partial<MarketValues>) => {
    setValues((current) => ({ ...current, ...fields }));
  };

  const fail = (failure: unknown) => {
    toast({
      message: failure instanceof Error ? failure.message : "That did not go through.",
      tone: "danger",
    });
  };

  const stage = async ([picked]: PickedFile[]) => {
    if (picked === undefined) return;
    setUploading(true);
    try {
      const answer = await stageMarketImage(market.slug, picked.file, picked.mime);
      edit({ staged: { path: answer.path, name: picked.file.name } });
    } catch (failure) {
      fail(failure);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const waiting =
      values.staged !== null || values.regions.some((region) => region.staged !== null);
    try {
      await save.mutateAsync({ slug: market.slug, ...changesOf(saved, values) });
      const stored = savedFrom(values);
      setSaved(stored);
      setValues(stored);
      toast({
        message: waiting
          ? "Saved. The images are being prepared and show here when ready."
          : "Saved.",
      });
    } catch (failure) {
      fail(
        failure instanceof AdminApiError && failure.code === "invalid_image"
          ? new Error("One of the new images could not be used. Choose it again.")
          : failure,
      );
    }
  };

  return (
    <div className="admin-editor">
      <div className="admin-editor__main">
        <h1>{saved.name}</h1>
        <ComingSoonToggle market={market} />
        <div className="admin-editor__fields">
          <Field label="Name">
            {(control) => (
              <input
                {...control}
                value={values.name}
                maxLength={120}
                onChange={(event) => {
                  edit({ name: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Intro">
            {(control) => (
              <textarea
                {...control}
                rows={4}
                value={values.intro}
                maxLength={2000}
                onChange={(event) => {
                  edit({ intro: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Places" hint="One place per line.">
            {(control) => (
              <textarea
                {...control}
                rows={4}
                value={values.places}
                onChange={(event) => {
                  edit({ places: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Interest copy"
            hint="What the interest signup says while the market is coming soon."
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={values.interest_copy}
                maxLength={600}
                onChange={(event) => {
                  edit({ interest_copy: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Position on the site"
            {...(validOrder(values.sort_order)
              ? {}
              : { error: "Use a whole number from 0 to 1000." })}
          >
            {(control) => (
              <input
                {...control}
                inputMode="numeric"
                value={values.sort_order}
                onChange={(event) => {
                  edit({ sort_order: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
        <section aria-label="Image" className="admin-editor__fields">
          {market.image_url === null ? (
            <p>No image yet.</p>
          ) : (
            <img className="admin-media__thumb" src={market.image_url} alt={market.name} />
          )}
          {values.staged === null ? null : (
            <p>
              {values.staged.name} is ready. It replaces the image once the market is saved and the
              image is prepared.
            </p>
          )}
          <RoleGate action="markets.edit">
            <UploadZone
              label={market.image_url === null ? "Choose image" : "Replace image"}
              multiple={false}
              busy={uploading}
              onFiles={(files) => {
                void stage(files);
              }}
            />
          </RoleGate>
        </section>
        <RegionsEditor
          regions={values.regions}
          onChange={(regions) => {
            edit({ regions });
          }}
        />
        <MarketNotesEditor
          notes={values.notes}
          onChange={(notes) => {
            edit({ notes });
          }}
        />
        <GuideEntriesEditor
          entries={values.guide}
          regions={values.regions.map((region) => region.slug)}
          onChange={(guide) => {
            edit({ guide });
          }}
        />
      </div>
      <aside className="admin-publish" aria-label="Save" data-print="hide">
        <div className="admin-actions">
          <RoleGate action="markets.edit">
            <button
              type="button"
              className="admin-button"
              disabled={!canSave}
              onClick={() => {
                void submit();
              }}
            >
              Save
            </button>
          </RoleGate>
        </div>
        {dirty ? null : <p>No changes to save.</p>}
      </aside>
    </div>
  );
}
