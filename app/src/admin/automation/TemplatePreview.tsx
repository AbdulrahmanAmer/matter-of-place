import type { EmailTemplateKey } from "../../domain/email";
import { useTemplatePreview } from "./automation-queries";
import { RequestFailure } from "./RequestFailure";

/**
 * The saved template drawn by the renderer that sends it (B5), with the sample values or the ones typed beside it. The
 * frame is sandboxed: the email is shown, never run. Unsaved edits do not reach it, and the note says so.
 */
export function TemplatePreview({
  templateKey,
  version,
  variables,
  unsaved,
}: {
  templateKey: EmailTemplateKey;
  version: number;
  variables: Readonly<Record<string, string>>;
  unsaved: boolean;
}) {
  const preview = useTemplatePreview(templateKey, version, variables);

  return (
    <section className="admin-preview" aria-labelledby="preview-title">
      <h3 id="preview-title">Preview</h3>
      <p className="admin-field__hint">
        Drawn from the saved template. Sample values fill the variables unless you typed others.
        {unsaved ? " Your unsaved changes are not in it." : ""}
      </p>
      {preview.isPending ? <p role="status">Drawing the preview.</p> : null}
      {preview.isError ? <RequestFailure error={preview.error} /> : null}
      {preview.isSuccess ? (
        <>
          <dl className="admin-preview__head">
            <div>
              <dt>Subject</dt>
              <dd>{preview.data.subject}</dd>
            </div>
            <div>
              <dt>Preheader</dt>
              <dd>{preview.data.preheader === "" ? "None" : preview.data.preheader}</dd>
            </div>
          </dl>
          <iframe
            className="admin-preview__frame"
            title="Email preview"
            sandbox=""
            srcDoc={preview.data.html}
          />
          <details>
            <summary>Plain text</summary>
            <pre className="admin-preview__text">{preview.data.text}</pre>
          </details>
        </>
      ) : null}
    </section>
  );
}
