import { useEffect, useId, type FormEvent } from "react";
import { X } from "lucide-react";
import { inquirySchema, type InquiryIntent, type InquirySubject } from "../../domain/contracts";
import { useAsyncAction } from "../../hooks/use-async-action";
import { useModal } from "../../hooks/use-modal";
import { track, type AnalyticsEvent } from "../../lib/analytics";
import { t } from "../../lib/strings";
import { services } from "../../services";
import { Field } from "./field";
import { DeliveryNotice, FormError, SentNotice } from "./form-notice";
import { sentText } from "../../lib/form-copy";

export type Intent = InquiryIntent;

type ExtraField = { key: string; label: string; placeholder: string };

type IntentCopy = {
  eyebrow: string;
  title: string;
  lede: string;
  event: AnalyticsEvent;
  message: string;
  extra?: ExtraField[];
};

/** Copy and tracking for each structured inquiry path. */
const intentCopy: Record<Intent, IntentCopy> = {
  showing: {
    eyebrow: "REQUEST A PRIVATE SHOWING",
    title: "Arrange a visit.",
    lede: "Tell us when you would like to see the property. The listing representative will confirm directly.",
    event: "showing_request",
    message: "I would like to arrange a private showing.",
    extra: [
      {
        key: "timing",
        label: "Preferred timing",
        placeholder: "e.g. weekday mornings, or a specific date",
      },
    ],
  },
  ask: {
    eyebrow: "ASK ABOUT THIS PROPERTY",
    title: "Ask us anything.",
    lede: "A short question is enough. We answer personally.",
    event: "property_inquiry",
    message: "",
  },
  similar: {
    eyebrow: "FIND SOMETHING SIMILAR",
    title: "Tell us what you are looking for.",
    lede: "Describe the setting, budget and character you have in mind and we will suggest places with something in common.",
    event: "similar_property_request",
    message: "I am looking for something similar to this property.",
    extra: [
      { key: "budget", label: "Budget", placeholder: "e.g. up to $8M" },
      {
        key: "location",
        label: "Places you would consider",
        placeholder: "e.g. Marin, Palm Beach, anywhere with water",
      },
    ],
  },
  sell: {
    eyebrow: "I NEED TO SELL FIRST",
    title: "Let us start with your current home.",
    lede: "Tell us a little about the property you would be selling. We will connect you with the right representation.",
    event: "seller_intent",
    message: "I am interested in this property but would need to sell first.",
    extra: [
      {
        key: "current",
        label: "Your current property",
        placeholder: "City or neighbourhood, and the kind of house",
      },
    ],
  },
  invest: {
    eyebrow: "BUYING AS AN INVESTMENT",
    title: "Tell us about your intentions.",
    lede: "Rental, long-term hold, or a residence used part of the year: the answer shapes what we suggest.",
    event: "investment_intent",
    message: "I am considering this property as an investment.",
    extra: [
      {
        key: "horizon",
        label: "Intended use and horizon",
        placeholder: "e.g. seasonal rental, ten-year hold",
      },
    ],
  },
  agent: {
    eyebrow: "CONTACT LISTING REPRESENTATIVE",
    title: "Reach the representative.",
    lede: "Your message goes to the listing representative. Matter of Place is not the listing brokerage.",
    event: "agent_contact",
    message: "",
  },
  general: {
    eyebrow: "GENERAL INQUIRY",
    title: "Write to us.",
    lede: "Questions about properties, markets, or presenting a property with Matter of Place.",
    event: "contact_inquiry",
    message: "",
  },
};

const readForm = (form: HTMLFormElement, extra: ExtraField[] = []) => {
  const data = new FormData(form);
  const text = (key: string) => data.get(key)?.toString() ?? "";
  const details = Object.fromEntries(
    extra.map((field) => [field.key, text(field.key)]).filter(([, value]) => value !== ""),
  );
  return {
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    message: text("message"),
    details,
  };
};

/**
 * Structured inquiry dialog. Opens for a given intent, validates against the
 * shared contract and sends through the inquiry service.
 */
export function InquiryDialog({
  intent,
  subject,
  onClose,
}: {
  intent: Intent | null;
  subject?: InquirySubject;
  onClose: () => void;
}) {
  const copy = intent ? intentCopy[intent] : null;
  const titleId = useId();
  const { state, run, reset, pending } = useAsyncAction((form: HTMLFormElement) =>
    services.inquiries.send(
      inquirySchema.parse({
        intent,
        subject,
        ...readForm(form, copy?.extra),
        sourcePath: window.location.pathname,
      }),
    ),
  );

  const open = intent !== null;
  useModal(open, onClose);
  useEffect(() => {
    reset();
  }, [intent, reset]);

  if (!intent || !copy) return null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const receipt = await run(event.currentTarget);
    if (receipt) track(copy.event, { intent, subject: subject?.slug });
  };

  return (
    <div className="inquiry-overlay" onClick={onClose}>
      <div
        className="inquiry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="inquiry-dialog-head">
          <span className="eyebrow">{copy.eyebrow}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t.common.close}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {subject && <p className="inquiry-subject">{subject.title}</p>}

        {state.status === "success" ? (
          <SentNotice text={sentText()}>
            <button type="button" className="button" onClick={onClose}>
              {t.common.close}
            </button>
          </SentNotice>
        ) : (
          <>
            <h2 id={titleId}>{copy.title}</h2>
            <form className="inquiry-form" onSubmit={onSubmit} aria-busy={pending}>
              <p className="inquiry-lede">{copy.lede}</p>
              <div className="field-grid">
                <Field label="Your name">
                  <input required autoFocus type="text" name="name" autoComplete="name" />
                </Field>
                <Field label="Email">
                  <input required type="email" name="email" autoComplete="email" />
                </Field>
                <Field label="Phone (optional)">
                  <input type="tel" name="phone" autoComplete="tel" />
                </Field>
                {copy.extra?.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <input type="text" name={field.key} placeholder={field.placeholder} />
                  </Field>
                ))}
              </div>
              <Field label="Message">
                <textarea name="message" rows={4} required defaultValue={copy.message} />
              </Field>
              <div className="form-actions">
                <button type="submit" className="button" disabled={pending}>
                  {pending ? t.common.sending : t.common.send}
                </button>
                <button type="button" className="button ghost" onClick={onClose}>
                  {t.common.cancel}
                </button>
              </div>
              <FormError message={state.status === "error" ? state.message : null} />
              <DeliveryNotice />
            </form>
          </>
        )}
      </div>
    </div>
  );
}
