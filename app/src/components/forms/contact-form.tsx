import { useState, type SyntheticEvent } from "react";
import {
  contactTopics,
  honeypotFieldName,
  inquirySchema,
  type ContactTopic,
} from "../../domain/contracts";
import { useAsyncAction } from "../../hooks/use-async-action";
import { useFieldErrors } from "../../hooks/use-field-errors";
import { track } from "../../lib/analytics";
import { readAttribution } from "../../lib/attribution";
import { formText, withHoneypot } from "../../lib/form-data";
import { t } from "../../lib/strings";
import { services } from "../../services";
import { ChoiceGroup } from "./choice-group";
import { Field } from "./field";
import { DeliveryNotice, FormError, SentNotice } from "./form-notice";
import { Honeypot } from "./honeypot";
import { sentText } from "../../lib/form-copy";

export function ContactForm() {
  const [topic, setTopic] = useState<ContactTopic>(contactTopics[0]);
  const { state, run, reset, pending } = useAsyncAction((form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (key: string) => formText(data, key);
    return services.inquiries.send(
      withHoneypot(
        inquirySchema.parse({
          intent: "general",
          topic,
          name: text("name"),
          email: text("email"),
          phone: text("phone"),
          location: text("location"),
          message: text("message"),
          sourcePath: window.location.pathname,
          attribution: readAttribution(),
        }),
        text(honeypotFieldName),
      ),
    );
  });

  const { validate, clear, field, control } = useFieldErrors();

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate(event.currentTarget)) return;
    void run(event.currentTarget).then((receipt) => {
      if (receipt) track("contact_inquiry", { topic });
    });
  };

  if (state.status === "success") {
    return (
      <SentNotice text={sentText()}>
        <button type="button" className="button" onClick={reset}>
          Write another
        </button>
      </SentNotice>
    );
  }

  return (
    <form
      className="contact-form"
      onSubmit={onSubmit}
      onInput={clear}
      aria-busy={pending}
      noValidate
    >
      <div>
        <p className="eyebrow">WHAT IS THIS ABOUT?</p>
        <ChoiceGroup
          label="Inquiry type"
          options={contactTopics}
          value={topic}
          onChange={setTopic}
        />
      </div>
      <div className="field-grid">
        <Field label="Your name" {...field("name")}>
          <input required type="text" name="name" autoComplete="name" {...control("name")} />
        </Field>
        <Field label="Email" {...field("email")}>
          <input required type="email" name="email" autoComplete="email" {...control("email")} />
        </Field>
        <Field label="Phone (optional)">
          <input type="tel" name="phone" autoComplete="tel" />
        </Field>
        <Field label="Where are you based?">
          <input type="text" name="location" placeholder="City, country" />
        </Field>
      </div>
      <Field label="Message" {...field("message")}>
        <textarea required rows={5} name="message" {...control("message")} />
      </Field>
      <Honeypot />
      <p className="form-note">{t.forms.sharedWithOmnikom}</p>
      <div className="form-actions">
        <button type="submit" className="button" disabled={pending}>
          {pending ? t.common.sending : t.common.send}
        </button>
      </div>
      <FormError message={state.status === "error" ? state.message : null} />
      <DeliveryNotice />
    </form>
  );
}
