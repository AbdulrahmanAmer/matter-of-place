import { NewsletterForm } from "../forms/newsletter-form";
import { t } from "../../lib/strings";

export function Newsletter({
  eyebrow = t.newsletter.eyebrow,
  title = t.newsletter.title,
  text = t.newsletter.text,
  source,
}: {
  eyebrow?: string;
  title?: string;
  text?: string;
  /** Where the visitor subscribed, for attribution. */
  source: string;
}) {
  return (
    <section className="newsletter" id="place-notes">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <NewsletterForm source={source} />
    </section>
  );
}
