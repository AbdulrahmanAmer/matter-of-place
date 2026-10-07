import { viewports } from "../../domain/admin-newsletter";

type Viewport = (typeof viewports)[number];

const LABEL: Readonly<Record<Viewport, string>> = { desktop: "Desktop", phone: "Phone" };

/**
 * The saved issue as a subscriber gets it, in a frame as wide as the chosen device. The frame is sandboxed with no
 * permission at all: the mail has no script, and a link inside it opens nothing from here.
 */
export function PreviewFrame({
  html,
  width,
  viewport,
  onViewport,
  loading = false,
  error = null,
}: {
  html: string | undefined;
  width: number;
  viewport: Viewport;
  onViewport: (next: Viewport) => void;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <section className="admin-preview" aria-label="Preview" aria-busy={loading}>
      <div className="admin-preview__head">
        <h2>Preview</h2>
        <div className="admin-views" role="group" aria-label="Preview width">
          {viewports.map((name) => (
            <button
              key={name}
              type="button"
              className="admin-view"
              aria-pressed={name === viewport}
              onClick={() => {
                onViewport(name);
              }}
            >
              {LABEL[name]}
            </button>
          ))}
        </div>
      </div>
      <p className="admin-field__hint">The preview shows the saved issue.</p>
      {error === null ? null : <p role="alert">{error}</p>}
      {html === undefined ? (
        <div className="admin-skeleton" />
      ) : (
        <iframe
          className="admin-preview__frame"
          title="Issue preview"
          sandbox=""
          srcDoc={html}
          width={width}
          data-viewport={viewport}
        />
      )}
    </section>
  );
}
