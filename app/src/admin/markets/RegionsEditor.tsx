import { useState } from "react";
import type { RegionSlug } from "../../domain/market";
import { UploadZone } from "../media/UploadZone";
import type { PickedFile } from "../media/media-queries";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import type { RegionValues } from "./market-values";
import { stageRegionImage } from "./markets-queries";

const regionName = (slug: string) => slug.replaceAll("-", " ");

/**
 * The regions a market has: name, intro, places and position, and an image for each. A region is never added or
 * removed here, and one that keeps its image sends none: a new image replaces it once Save has queued its render.
 */
export function RegionsEditor({
  regions,
  onChange,
}: {
  regions: readonly RegionValues[];
  onChange: (regions: RegionValues[]) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState<RegionSlug | null>(null);
  const update = (slug: RegionSlug, fields: Partial<RegionValues>) => {
    onChange(regions.map((region) => (region.slug === slug ? { ...region, ...fields } : region)));
  };
  const stage = async (slug: RegionSlug, [picked]: PickedFile[]) => {
    if (picked === undefined) return;
    setUploading(slug);
    try {
      const answer = await stageRegionImage(slug, picked.file, picked.mime);
      update(slug, { staged: { path: answer.path, name: picked.file.name } });
    } catch (failure) {
      toast({
        message: failure instanceof Error ? failure.message : "That did not go through.",
        tone: "danger",
      });
    } finally {
      setUploading(null);
    }
  };
  return (
    <section aria-label="Regions" className="admin-editor__fields">
      <h2>Regions</h2>
      {regions.map((region) => {
        const name = regionName(region.slug);
        return (
          <fieldset key={region.slug} className="admin-editor__list">
            <legend>{name}</legend>
            <Field label={`Region ${name} name`}>
              {(control) => (
                <input
                  {...control}
                  value={region.name}
                  maxLength={120}
                  onChange={(event) => {
                    update(region.slug, { name: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={`Region ${name} intro`}>
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  value={region.intro}
                  maxLength={2000}
                  onChange={(event) => {
                    update(region.slug, { intro: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={`Region ${name} places`} hint="One place per line.">
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  value={region.places}
                  onChange={(event) => {
                    update(region.slug, { places: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label={`Region ${name} position`}>
              {(control) => (
                <input
                  {...control}
                  inputMode="numeric"
                  value={region.sort_order}
                  onChange={(event) => {
                    update(region.slug, { sort_order: event.target.value });
                  }}
                />
              )}
            </Field>
            {region.image_url === null ? (
              <p>No image yet.</p>
            ) : (
              <img className="admin-media__thumb" src={region.image_url} alt={region.name} />
            )}
            {region.staged === null ? null : (
              <p>
                {region.staged.name} is ready. It replaces the image once the market is saved and
                the image is prepared.
              </p>
            )}
            <RoleGate action="markets.edit">
              <UploadZone
                label={`${region.image_url === null ? "Choose" : "Replace"} image for ${name}`}
                multiple={false}
                busy={uploading === region.slug}
                onFiles={(files) => {
                  void stage(region.slug, files);
                }}
              />
            </RoleGate>
          </fieldset>
        );
      })}
    </section>
  );
}
