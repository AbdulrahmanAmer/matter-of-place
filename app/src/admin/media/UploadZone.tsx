import { useState } from "react";
import { uploadLimits } from "../../domain/contracts";
import type { UploadType } from "../../domain/admin-media";
import type { PickedFile } from "./media-queries";

const ACCEPT = uploadLimits.types.join(",");
const MAX_MB = Math.floor(uploadLimits.maxBytes / 1024 / 1024);

const allowedType = (type: string): type is UploadType =>
  uploadLimits.types.some((allowed) => allowed === type);

/**
 * Drop or pick photographs. Only the types and sizes of `uploadLimits` go on; the rest are named and left out. The
 * caller stages what is picked (a property's photographs here; a story, market or region image in later steps).
 * `compact` is the one button of a row (Replace), with no drop area and no hint.
 */
export function UploadZone({
  label,
  multiple = true,
  compact = false,
  busy = false,
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  compact?: boolean;
  busy?: boolean;
  onFiles: (files: PickedFile[]) => void;
}) {
  const [refused, setRefused] = useState<string[]>([]);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    const picked = files.flatMap((file) =>
      allowedType(file.type) && file.size <= uploadLimits.maxBytes
        ? [{ file, mime: file.type }]
        : [],
    );
    setRefused(
      files.filter((file) => !picked.some((entry) => entry.file === file)).map((file) => file.name),
    );
    if (picked.length > 0) onFiles(picked);
  };
  return (
    <div
      className={compact ? "admin-upload admin-upload--compact" : "admin-upload"}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!busy) take(event.dataTransfer.files);
      }}
    >
      <label className="admin-button">
        {busy ? "Uploading" : label}
        <input
          className="admin-upload__input"
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          disabled={busy}
          onChange={(event) => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {compact ? null : (
        <p className="admin-upload__hint">
          Or drop them here. JPEG, PNG, WebP or HEIC, up to {MAX_MB} MB each.
        </p>
      )}
      {refused.length > 0 ? (
        <p className="admin-field__error" role="alert">
          Not added: {refused.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
