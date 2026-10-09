import { useState } from "react";
import { slugPattern, editorialStateLabels } from "../../domain/contracts";
import { storyCategories, type StoryDetail } from "../../domain/admin-stories";
import { marketSlugSchema } from "../../domain/market";
import { UploadZone } from "../media/UploadZone";
import type { PickedFile } from "../media/media-queries";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import {
  stageStoryImage,
  useCreateStory,
  usePublishStory,
  useSaveStory,
  useUnpublishStory,
} from "./stories-queries";
import { isComplete, marketNames, patchOf, valuesOf, type StoryValues } from "./story-values";

const SLUG = new RegExp(slugPattern);

/** A new image waiting for Save: the object name `createStagingUpload` made, and the file's own name. */
interface Staged {
  path: string;
  name: string;
}

/**
 * Screen 14, one story. `story` null is a new one. Save sends the changed fields at the `updated_at` the editor read
 * and takes the next one from the answer; a 409 `stale` keeps what was typed and offers Reload. The image is staged by
 * the browser and rendered by B9's job after Save (G51); Publish stays off while the story has no image (G55).
 */
export function StoryEditor({
  story,
  onCreated,
  onReload,
}: {
  story: StoryDetail | null;
  onCreated?: (id: string) => void;
  onReload?: () => Promise<StoryDetail>;
}) {
  const toast = useToast();
  const [saved, setSaved] = useState(() => valuesOf(story));
  const [values, setValues] = useState(saved);
  const [updatedAt, setUpdatedAt] = useState(story?.updated_at ?? null);
  const [state, setState] = useState(story?.editorial_state ?? "draft");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stale, setStale] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const create = useCreateStory();
  const save = useSaveStory();
  const publish = usePublishStory();
  const unpublish = useUnpublishStory();

  const patch = patchOf(saved, values);
  const dirty = Object.keys(patch).length > 0 || staged !== null;
  const slugValid = SLUG.test(values.slug);
  const pending =
    create.isPending || save.isPending || publish.isPending || unpublish.isPending || uploading;
  const slugLocked = story !== null && state !== "draft";
  const canSave =
    dirty && (story !== null || isComplete(values)) && slugValid && !pending && !stale;
  const hasImage = story?.image_url != null;

  const edit = (fields: Partial<StoryValues>) => {
    setValues((current) => ({ ...current, ...fields }));
  };

  const fail = (failure: unknown) => {
    if (failure instanceof AdminApiError && failure.code === "stale") {
      setStale(true);
      return;
    }
    toast({
      message: failure instanceof Error ? failure.message : "That did not go through.",
      tone: "danger",
    });
  };

  const stage = async ([picked]: PickedFile[]) => {
    if (picked === undefined) return;
    setUploading(true);
    try {
      const answer = await stageStoryImage(values.slug, picked.file, picked.mime);
      setStaged({ path: answer.path, name: picked.file.name });
    } catch (failure) {
      fail(failure);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const image = staged === null ? {} : { image_staging_path: staged.path };
    try {
      if (story === null) {
        const answer = await create.mutateAsync({ patch, ...image });
        toast({ message: "Story saved as a draft." });
        onCreated?.(answer.id);
        return;
      }
      if (updatedAt === null) return;
      const answer = await save.mutateAsync({
        id: story.id,
        expected_updated_at: updatedAt,
        patch,
        ...image,
      });
      setSaved(values);
      setUpdatedAt(answer.updated_at);
      setStaged(null);
      toast({
        message:
          staged === null
            ? "Saved."
            : "Saved. The image is being prepared and shows here when ready.",
      });
    } catch (failure) {
      fail(failure);
    }
  };

  const move = async (to: "published" | "archived") => {
    if (story === null || updatedAt === null) return;
    try {
      const answer =
        to === "published"
          ? await publish.mutateAsync({ id: story.id, expected_updated_at: updatedAt })
          : await unpublish.mutateAsync(story.id);
      setState(to);
      setUpdatedAt(answer.updated_at);
      setUnpublishing(false);
      toast({ message: to === "published" ? "Published." : "Unpublished." });
    } catch (failure) {
      setUnpublishing(false);
      fail(failure);
    }
  };

  const reload = async () => {
    const fresh = await onReload?.();
    if (fresh === undefined) return;
    setSaved(valuesOf(fresh));
    setUpdatedAt(fresh.updated_at);
    setState(fresh.editorial_state);
    setStale(false);
  };

  return (
    <div className="admin-editor">
      <div className="admin-editor__main">
        <h1>{story === null ? "New story" : saved.title}</h1>
        {stale ? (
          <div className="admin-banner" role="alert">
            <p>Reload, someone saved. Your unsaved edits stay in the fields.</p>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                void reload();
              }}
            >
              Reload
            </button>
          </div>
        ) : null}
        <div className="admin-editor__fields">
          <Field label="Title">
            {(control) => (
              <input
                {...control}
                value={values.title}
                maxLength={200}
                onChange={(event) => {
                  edit({ title: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Address"
            hint={
              slugLocked
                ? "A story that has been public keeps its address."
                : "Lower case words joined by hyphens. It cannot change once the story is public."
            }
            {...(values.slug === "" || slugValid
              ? {}
              : { error: "Use lower case words joined by hyphens." })}
          >
            {(control) => (
              <input
                {...control}
                value={values.slug}
                maxLength={120}
                disabled={slugLocked}
                onChange={(event) => {
                  edit({ slug: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Deck" hint="One sentence under the title and on cards.">
            {(control) => (
              <textarea
                {...control}
                rows={2}
                value={values.deck}
                maxLength={400}
                onChange={(event) => {
                  edit({ deck: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Category">
            {(control) => (
              <select
                {...control}
                value={values.category}
                onChange={(event) => {
                  edit({ category: event.target.value });
                }}
              >
                <option value="">Choose a category</option>
                {storyCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Market">
            {(control) => (
              <select
                {...control}
                value={values.market_slug}
                onChange={(event) => {
                  edit({ market_slug: event.target.value });
                }}
              >
                <option value="">Choose a market</option>
                {marketSlugSchema.options.map((market) => (
                  <option key={market} value={market}>
                    {marketNames[market]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Body" hint="A blank line starts a new paragraph.">
            {(control) => (
              <textarea
                {...control}
                rows={14}
                value={values.body}
                onChange={(event) => {
                  edit({ body: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Linked properties"
            hint="Property addresses, separated by spaces or commas."
          >
            {(control) => (
              <textarea
                {...control}
                rows={2}
                value={values.properties}
                onChange={(event) => {
                  edit({ properties: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
        <section aria-label="Image" className="admin-editor__fields">
          {story?.image_url == null ? (
            <p>No image yet. A story is published once it has one.</p>
          ) : (
            <img className="admin-media__thumb" src={story.image_url} alt={saved.title} />
          )}
          {staged === null ? null : (
            <p>
              {staged.name} is ready. It replaces the image once the story is saved and the image is
              prepared.
            </p>
          )}
          <RoleGate action="stories.write">
            {slugValid ? (
              <UploadZone
                label={hasImage ? "Replace image" : "Choose image"}
                multiple={false}
                busy={uploading}
                onFiles={(files) => {
                  void stage(files);
                }}
              />
            ) : (
              <p>Give the story an address before choosing an image.</p>
            )}
          </RoleGate>
        </section>
      </div>
      <aside className="admin-publish" aria-label="Publication" data-print="hide">
        <p>
          <StatusPill
            label={editorialStateLabels[state]}
            tone={state === "published" ? "ok" : "neutral"}
          />
        </p>
        <div className="admin-actions">
          <RoleGate action="stories.write">
            <button
              type="button"
              className="admin-button"
              disabled={!canSave}
              onClick={() => {
                void submit();
              }}
            >
              {story === null ? "Create draft" : "Save"}
            </button>
          </RoleGate>
          {story !== null && state !== "published" ? (
            <RoleGate action="stories.publish">
              <button
                type="button"
                className="admin-button"
                disabled={pending || dirty || stale || !hasImage}
                onClick={() => {
                  void move("published");
                }}
              >
                Publish
              </button>
            </RoleGate>
          ) : null}
          {state === "published" ? (
            <RoleGate action="stories.unpublish">
              <button
                type="button"
                className="admin-button admin-button--danger"
                disabled={pending || stale}
                onClick={() => {
                  setUnpublishing(true);
                }}
              >
                Unpublish
              </button>
            </RoleGate>
          ) : null}
        </div>
        {story !== null && state !== "published" && dirty ? (
          <p>Save your edits to publish.</p>
        ) : null}
        {story !== null && state !== "published" && !hasImage ? (
          <p>Publish is available once the image has been prepared.</p>
        ) : null}
      </aside>
      <ConfirmDialog
        open={unpublishing}
        title="Unpublish this story"
        confirmLabel="Unpublish"
        danger
        pending={pending}
        onConfirm={() => {
          void move("archived");
        }}
        onCancel={() => {
          setUnpublishing(false);
        }}
      >
        <p>The story stops showing on the site. You can publish it again later.</p>
      </ConfirmDialog>
    </div>
  );
}
