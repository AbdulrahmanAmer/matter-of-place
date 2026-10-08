/** Another session saved this property first (FE-01). Reload keeps every unsaved field on top of the fresh row. */
export function StaleBanner({ onReload, reloading }: { onReload: () => void; reloading: boolean }) {
  return (
    <div className="admin-banner" role="alert">
      <p>Reload, someone saved. Your unsaved edits stay in the fields.</p>
      <button type="button" className="admin-button" disabled={reloading} onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
