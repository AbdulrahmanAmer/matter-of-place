import { useState } from "react";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useSaveTemplate, useSendTest, type TemplateRow } from "./automation-queries";
import { BlocksEditor } from "./BlocksEditor";
import { TemplatePreview } from "./TemplatePreview";
import {
  checkDraft,
  draftOf,
  missingVariables,
  namedVariables,
  sameDraft,
  type Draft,
} from "./template-draft";
import { VariablesList } from "./VariablesList";

/**
 * One email template: subject, preheader, switch and blocks on the left; the variables it may use, the preview and the
 * test send on the right. The draft is local until Save; a saved template is what the next send uses. The parent keys
 * this component by the template's version, so a refetch after a save starts a fresh draft from what the server holds.
 */
export function EmailTemplateEditor({ template }: { template: TemplateRow }) {
  const toast = useToast();
  const save = useSaveTemplate();
  const sendTest = useSendTest();
  const { actions } = useAdminMe();
  const [draft, setDraft] = useState<Draft>(() => draftOf(template));
  const [checked, setChecked] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});

  const dirty = !sameDraft(draft, draftOf(template));
  const problems = checkDraft(draft);
  const shown = checked ? problems.errors : undefined;
  const missing = missingVariables(template.key, draft);
  const canEdit = actions.includes("automation.templates_put");

  const submit = () => {
    setChecked(true);
    if (!problems.ok || missing.length > 0) return;
    save.mutate(
      { key: template.key, patch: draft },
      {
        onSuccess: () => {
          toast({ message: "Template saved. The next send uses it." });
        },
      },
    );
  };

  return (
    <article className="admin-template" aria-label={template.key}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="admin-template__fields" disabled={!canEdit || save.isPending}>
          <legend className="admin-template__key">
            Template <code>{template.key}</code>
          </legend>
          <Field
            label="Subject"
            {...(shown?.subject === undefined ? {} : { error: shown.subject })}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={draft.subject}
                onChange={(event) => {
                  setDraft({ ...draft, subject: event.target.value });
                }}
              />
            )}
          </Field>
          <Field
            label="Preheader"
            hint="The line a mailbox shows beside the subject."
            {...(shown?.preheader === undefined ? {} : { error: shown.preheader })}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={draft.preheader}
                onChange={(event) => {
                  setDraft({ ...draft, preheader: event.target.value });
                }}
              />
            )}
          </Field>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                setDraft({ ...draft, enabled: event.target.checked });
              }}
            />
            Template on
          </label>
          {draft.enabled ? null : (
            <p className="admin-field__hint">
              A template that is off is skipped when its event happens.
            </p>
          )}
          <h3>Blocks</h3>
          <BlocksEditor
            blocks={draft.body}
            errors={shown?.blocks ?? {}}
            onChange={(body) => {
              setDraft({ ...draft, body });
            }}
          />
          {shown?.body === undefined ? null : (
            <p className="admin-field__error" role="alert">
              {shown.body}
            </p>
          )}
        </fieldset>
        <RoleGate action="automation.templates_put">
          <div className="admin-actions admin-template__save">
            {dirty ? <span className="admin-field__hint">Unsaved changes</span> : null}
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(draftOf(template));
                setChecked(false);
              }}
            >
              Discard changes
            </button>
            <button type="submit" className="admin-button" disabled={!dirty || save.isPending}>
              Save template
            </button>
          </div>
        </RoleGate>
        {save.isError ? (
          <p role="alert" className="admin-field__error">
            {save.error.message}
          </p>
        ) : null}
      </form>
      <div className="admin-template__side">
        <VariablesList
          templateKey={template.key}
          used={namedVariables(draft)}
          missing={missing}
          onApply={setPreviewValues}
        />
        <TemplatePreview
          templateKey={template.key}
          version={template.version}
          variables={previewValues}
          unsaved={dirty}
        />
        <RoleGate action="automation.templates_send_test">
          <div className="admin-template__test">
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={dirty || sendTest.isPending}
              onClick={() => {
                sendTest.mutate(template.key, {
                  onSuccess: (result) => {
                    toast({
                      message: result.queued
                        ? `A test is on its way to ${result.to}.`
                        : "A test of this template was already queued this minute.",
                    });
                  },
                });
              }}
            >
              Send test to me
            </button>
            <p className="admin-field__hint">
              {dirty
                ? "Save first. The test sends the saved template."
                : "Sends the saved template to your own address."}
            </p>
            {sendTest.isError ? (
              <p role="alert" className="admin-field__error">
                {sendTest.error.message}
              </p>
            ) : null}
          </div>
        </RoleGate>
      </div>
    </article>
  );
}
