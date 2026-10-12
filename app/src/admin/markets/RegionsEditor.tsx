import { useState } from "react";
import type { RegionSlug } from "../../domain/market";
import { UploadZone } from "../media/UploadZone";
import type { PickedFile } from "../media/media-queries";
import { Field } from "../ui/Field";
import { Fold } from "../ui/Fold";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import type { RegionValues } from "./market-values";
import { stageRegionImage } from "./markets-queries";

const placeCount = (places: string) =>
  places.split("\n").filter((line) => line.trim() !== "").length;

/**
 * The regions a market has, one line each with its places and its image, opening in place to name, intro, places,
 * position and image (admin pass, 2026-10-12). A region is never added or removed here, and one that keeps its image
 * sends none: a new image replaces it once Save has queued its render.
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
    <section id="market-regions" aria-label="Regions" className="admin-editor__fields">
      <h2>Regions</h2>
      <p className="admin-lead">Open a region to change its words, its places or its image.</p>
      <div className="admin-folds">
        {regions.map((region) => {
          const name = region.name.trim() === "" ? region.slug.replaceAll("-", " ") : region.name;
          const places = placeCount(region.places);
          return (
            <Fold
              key={region.slug}
              title={name}
              meta={`${places === 1 ? "1 place" : `${String(places)} places`} · ${
                region.staged !== null
                  ? "new image waiting for Save"
                  : region.image_url === null
                    ? "no image yet"
                    : "has an image"
              }`}
            >
              <div className="admin-fold__split">
                <div className="admin-fold__fields">
                  <Field label="Name" context={name}>
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
                  <Field label="Intro" context={name}>
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
                  <Field label="Places" context={name} hint="One place per line.">
                    {(control) => (
                      <textarea
                        {...control}
                        rows={Math.min(Math.max(places, 3), 8)}
                        value={region.places}
                        onChange={(event) => {
                          update(region.slug, { places: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label="Position"
                    context={name}
                    hint="Regions show from the lowest number up."
                  >
                    {(control) => (
                      <input
                        {...control}
                        className="admin-input--short"
                        inputMode="numeric"
                        value={region.sort_order}
                        onChange={(event) => {
                          update(region.slug, { sort_order: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                </div>
                <div className="admin-fold__image">
                  {region.image_url === null ? (
                    <p className="admin-field__hint">No image yet.</p>
                  ) : (
                    <img className="admin-media__thumb" src={region.image_url} alt={name} />
                  )}
                  {region.staged === null ? null : (
                    <p>
                      {region.staged.name} is ready. It replaces the image once the market is saved
                      and the image is prepared.
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
                </div>
              </div>
            </Fold>
          );
        })}
      </div>
    </section>
  );
}
