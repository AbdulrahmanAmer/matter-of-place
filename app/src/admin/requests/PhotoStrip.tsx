import type { SubmissionPhoto } from "../../domain/admin-submissions";
import { formatNumber } from "../../lib/format";

/**
 * The photographs of a request (invariant 21 (c), PERF-08): the 480 px thumbnails the submit wizard uploads, or a
 * placeholder where none exists (a HEIC file in Chrome). An original is fetched only when the editor asks for it.
 */
export function PhotoStrip({
  photos,
  opening,
  onOpen,
}: {
  photos: readonly SubmissionPhoto[];
  /** The photograph whose address is being fetched, if any. */
  opening: string | null;
  onOpen: (mediaId: string) => void;
}) {
  if (photos.length === 0) {
    return (
      <section className="admin-photos" aria-label="Photographs">
        <h2>Photographs</h2>
        <p className="admin-photos__none">No photographs were sent with this request.</p>
      </section>
    );
  }
  return (
    <section className="admin-photos" aria-label="Photographs">
      <h2>Photographs ({formatNumber(photos.length)})</h2>
      <ul>
        {photos.map((photo, index) => (
          <li key={photo.id}>
            {photo.thumb_url === null ? (
              <div className="admin-photos__placeholder" role="img" aria-label="No preview">
                No preview
              </div>
            ) : (
              <img
                src={photo.thumb_url}
                alt={`Photograph ${String(index + 1)} of ${String(photos.length)}`}
                width={480}
                loading="lazy"
              />
            )}
            <p className="admin-photos__meta">
              <span>{photo.uploaded_at === null ? "Not uploaded" : photo.name}</span>
              {photo.uploaded_at === null ? null : (
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  disabled={opening === photo.id}
                  onClick={() => {
                    onOpen(photo.id);
                  }}
                >
                  Open original
                </button>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
