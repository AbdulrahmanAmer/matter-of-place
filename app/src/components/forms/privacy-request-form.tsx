import { useState, type SyntheticEvent } from "react";
import {
  honeypotFieldName,
  subjectRequestKinds,
  subjectRequestSchema,
  type SubjectRequest,
} from "../../domain/contracts";
import { useAsyncAction } from "../../hooks/use-async-action";
import { useFieldErrors } from "../../hooks/use-field-errors";
import { track } from "../../lib/analytics";
import { formText, withHoneypot } from "../../lib/form-data";
import { t } from "../../lib/strings";
import { services } from "../../services";
import { Field } from "./field";
import { DeliveryNotice, FormError, SentNotice } from "./form-notice";
import { Honeypot } from "./honeypot";

export function PrivacyRequestForm({ kind: linked }: { kind?: SubjectRequest["kind"] }) {
  const [chosen, setChosen] = useState<SubjectRequest["kind"]>();
  const kind = chosen ?? linked ?? subjectRequestKinds[0];
  const { state, run, pending } = useAsyncAction((form: HTMLFormElement) => {
    const data = new FormData(form);
    const note = formText(data, "note");
    return services.subjects.request(
      withHoneypot(
        subjectRequestSchema.parse({
          email: formText(data, "email"),
          kind,
          ...(note === "" ? {} : { note }),
        }),
        formText(data, honeypotFieldName),
      ),
    );
  });

  const { validate, clear, field, control } = useFieldErrors();

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate(event.currentTarget)) return;
    void run(event.currentTarget).then((answer) => {
      if (answer) track("subject_request_submitted");
    });
  };

  if (state.status === "success") return <SentNotice text={t.privacyRequest.confirmation} />;

  return (
    <form onSubmit={onSubmit} onInput={clear} aria-busy={pending} noValidate>
      <fieldset className="privacy-kinds">
        <legend>{t.privacyRequest.kindLegend}</legend>
        {subjectRequestKinds.map((option) => (
          <label className="check" key={option}>
            <input
              type="radio"
              name="kind"
              value={option}
              checked={kind === option}
              onChange={() => {
                setChosen(option);
              }}
            />
            {t.privacyRequest.kinds[option]}
          </label>
        ))}
      </fieldset>
      <Field label={t.privacyRequest.emailLabel} {...field("email")}>
        <input required type="email" name="email" autoComplete="email" {...control("email")} />
      </Field>
      <Field label={t.privacyRequest.noteLabel}>
        <textarea rows={4} name="note" maxLength={500} />
      </Field>
      <FormError message={state.status === "error" ? state.message : null} />
      <Honeypot />
      <div className="form-actions">
        <button type="submit" className="button" disabled={pending}>
          {pending ? t.common.sending : t.common.send}
        </button>
      </div>
      <DeliveryNotice />
    </form>
  );
}
