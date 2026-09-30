import { useState, type FormEvent } from "react";
import { contactTopics, inquirySchema, type ContactTopic } from "../../domain/contracts";
import { useAsyncAction } from "../../hooks/use-async-action";
import { track } from "../../lib/analytics";
import { t } from "../../lib/strings";
import { services } from "../../services";
import { ChoiceGroup } from "./choice-group";
import { Field } from "./field";
import { DeliveryNotice, FormError, SentNotice } from "./form-notice";
import { sentText } from "../../lib/form-copy";

export function ContactForm() {
  const [topic, setTopic] = useState<ContactTopic>(contactTopics[0]);
  const { state, run, reset, pending } = useAsyncAction((form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (key: string) => data.get(key)?.toString() ?? "";
    return services.inquiries.send(
      inquirySchema.parse({
        intent: "general",
        topic,
        name: text("name"),
        email: text("email"),
        phone: text("phone"),
        location: text("location"),
        message: text("message"),
        sourcePath: window.location.pathname,
      }),
    );
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const receipt = await run(event.currentTarget);
    if (receipt) track("contact_inquiry", { topic });
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
    <form className="contact-form" onSubmit={onSubmit} aria-busy={pending}>
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
        <Field label="Your name">
          <input required type="text" name="name" autoComplete="name" />
        </Field>
        <Field label="Email">
          <input required type="email" name="email" autoComplete="email" />
        </Field>
        <Field label="Phone (optional)">
          <input type="tel" name="phone" autoComplete="tel" />
        </Field>
        <Field label="Where are you based?">
          <input type="text" name="location" placeholder="City, country" />
        </Field>
      </div>
      <Field label="Message">
        <textarea required rows={5} name="message" />
      </Field>
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
