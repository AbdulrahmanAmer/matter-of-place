import type { PropertyCard } from "../../domain/property";
import { t } from "../../lib/strings";
import { TextLink } from "./text-link";

/** What is real on a preview: shown only while an illustrative property is on the page (B3b, S43). */
export function IllustrativeNotice({
  properties,
}: {
  properties: readonly Pick<PropertyCard, "status">[];
}) {
  if (!properties.some((property) => property.status === "Illustrative")) return null;
  return (
    <section className="section-wrap illustrative-notice">
      <p className="eyebrow">{t.comingSoon.illustrative.label}</p>
      <div>
        <h2>{t.comingSoon.illustrative.title}</h2>
        <p>{t.comingSoon.illustrative.text}</p>
        <TextLink to="/editorial-standard">{t.comingSoon.illustrative.link}</TextLink>
      </div>
    </section>
  );
}
