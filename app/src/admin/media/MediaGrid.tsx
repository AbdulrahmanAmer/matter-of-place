import { useState } from "react";
import type { MediaItem } from "../../domain/admin-media";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import { AltEditor } from "./AltEditor";
import {
  useDeleteMedia,
  useMedia,
  useReorderMedia,
  useReplacePhoto,
  useRetryRender,
  useSetAlt,
  useUploadPhotos,
  useVariantsStatus,
} from "./media-queries";
import { UploadZone } from "./UploadZone";
import { VariantStatus } from "./VariantStatus";

/** The order with the photograph at `from` moved to `to`. */
function moved(items: readonly MediaItem[], from: number, to: number): string[] {
  const order = items.map((item) => item.id);
  const [id] = order.splice(from, 1);
  if (id !== undefined) order.splice(to, 0, id);
  return order;
}

const failureLine = (error: Error) =>
  error instanceof AdminApiError && error.requestId !== undefined
    ? `${error.message} Request ${error.requestId}.`
    : error.message;

/**
 * The photographs of one property in sequence, the first being the hero (G66): upload, order, alt text, replace and
 * delete, each shown only to the roles that may, and where each render stands. Orientation is read only: the render
 * sets it, and it is blank until then (G63).
 */
export function MediaGrid({ propertyId }: { propertyId: string }) {
  const toast = useToast();
  const media = useMedia(propertyId);
  const status = useVariantsStatus(propertyId);
  const upload = useUploadPhotos(propertyId);
  const replace = useReplacePhoto(propertyId);
  const reorder = useReorderMedia(propertyId);
  const alt = useSetAlt(propertyId);
  const remove = useDeleteMedia(propertyId);
  const retry = useRetryRender(propertyId);
  const [deleting, setDeleting] = useState<string | null>(null);
  const failed = (error: Error) => {
    toast({ message: failureLine(error), tone: "danger" });
  };

  if (media.isPending) return <p>Loading photographs.</p>;
  if (media.error !== null) return <p role="alert">{failureLine(media.error)}</p>;
  const items = media.data.items;
  const stateOf = (id: string) =>
    status.data?.items.find((item) => item.media_id === id) ?? {
      state: "staged" as const,
      job_id: null,
    };

  return (
    <div className="admin-media">
      <RoleGate action="media.attach">
        <UploadZone
          label="Add photographs"
          busy={upload.isPending}
          onFiles={(files) => {
            upload.mutate(files, { onError: failed });
          }}
        />
      </RoleGate>
      {items.length === 0 ? (
        <EmptyState title="No photographs yet">
          Photographs of an accepted request arrive here once they are copied.
        </EmptyState>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption>Photographs in sequence</caption>
            <thead>
              <tr>
                <th scope="col">Position</th>
                <th scope="col">Photograph</th>
                <th scope="col">State</th>
                <th scope="col">Alt text</th>
                <th scope="col">Orientation</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const shown = stateOf(item.id);
                const position = index === 0 ? "1, hero" : String(index + 1);
                return (
                  <tr key={item.id}>
                    <td>{position}</td>
                    <td>
                      {item.url === null ? (
                        <span className="admin-media__thumb admin-media__thumb--none">
                          Not copied yet
                        </span>
                      ) : (
                        <img className="admin-media__thumb" src={item.url} alt={item.alt ?? ""} />
                      )}
                    </td>
                    <td>
                      <VariantStatus
                        state={
                          replace.isPending && replace.variables.id === item.id
                            ? "uploading"
                            : shown.state
                        }
                        propertyId={propertyId}
                        retrying={retry.isPending}
                        onRetry={() => {
                          if (shown.job_id !== null)
                            retry.mutate(shown.job_id, { onError: failed });
                        }}
                      />
                    </td>
                    <td>
                      <RoleGate action="media.alt">
                        <AltEditor
                          key={item.alt ?? ""}
                          label={`Alt text, photograph ${String(index + 1)}`}
                          value={item.alt}
                          saving={alt.isPending}
                          onSave={(text) => {
                            alt.mutate({ id: item.id, alt: text }, { onError: failed });
                          }}
                        />
                      </RoleGate>
                    </td>
                    <td>{item.orientation ?? ""}</td>
                    <td>
                      <div className="admin-actions">
                        <RoleGate action="media.reorder">
                          <button
                            type="button"
                            className="admin-button admin-button--quiet"
                            disabled={index === 0 || reorder.isPending}
                            aria-label={`Move photograph ${String(index + 1)} up`}
                            onClick={() => {
                              reorder.mutate(moved(items, index, index - 1), { onError: failed });
                            }}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button--quiet"
                            disabled={index === items.length - 1 || reorder.isPending}
                            aria-label={`Move photograph ${String(index + 1)} down`}
                            onClick={() => {
                              reorder.mutate(moved(items, index, index + 1), { onError: failed });
                            }}
                          >
                            Down
                          </button>
                        </RoleGate>
                        <RoleGate action="media.replace">
                          <UploadZone
                            label="Replace"
                            compact
                            multiple={false}
                            busy={replace.isPending}
                            onFiles={([picked]) => {
                              if (picked !== undefined) {
                                replace.mutate({ id: item.id, ...picked }, { onError: failed });
                              }
                            }}
                          />
                        </RoleGate>
                        <RoleGate action="media.delete">
                          <button
                            type="button"
                            className="admin-button admin-button--quiet"
                            onClick={() => {
                              setDeleting(item.id);
                            }}
                          >
                            Delete
                          </button>
                        </RoleGate>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this photograph"
        confirmLabel="Delete"
        danger
        pending={remove.isPending}
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting === null) return;
          remove.mutate(deleting, {
            onError: failed,
            onSettled: () => {
              setDeleting(null);
            },
          });
        }}
      >
        A photograph of a published property cannot be deleted, nor one a creative asset still uses.
      </ConfirmDialog>
    </div>
  );
}
