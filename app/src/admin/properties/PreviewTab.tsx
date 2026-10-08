import { useEffect } from "react";
import { usePreviewToken } from "./properties-queries";

/**
 * Screen 8, Preview: the public page of the draft in a frame, on a link that lives 15 minutes. The page opens once the
 * facts it shows are filled; until then the checklist names what is missing.
 */
export function PreviewTab({ propertyId, ready }: { propertyId: string; ready: boolean }) {
  const token = usePreviewToken(propertyId);
  const { mutate } = token;
  useEffect(() => {
    if (ready) mutate();
  }, [ready, mutate]);
  if (!ready) {
    return <p>The preview opens once the facts and the hero are complete.</p>;
  }
  if (token.error !== null) {
    return (
      <p className="admin-field__error" role="alert">
        {token.error.message}
      </p>
    );
  }
  return (
    <div className="admin-editor__preview">
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={token.isPending}
        onClick={() => {
          mutate();
        }}
      >
        Refresh preview
      </button>
      {token.data === undefined ? null : (
        <iframe title="Preview of the public page" src={token.data.url} />
      )}
    </div>
  );
}
