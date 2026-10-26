import type { Crumb } from "../../lib/jsonld";
import { TrailBreadcrumb } from "./trail-breadcrumb";

export function PageIntro({
  eyebrow,
  title,
  text,
  trail,
}: {
  eyebrow: string;
  title: string;
  text?: string;
  /** The array the route gives `breadcrumbLd`; drawn as the visible Breadcrumb list. */
  trail?: Crumb[];
}) {
  return (
    <section className="page-intro">
      {trail !== undefined && <TrailBreadcrumb trail={trail} />}
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {text && <p className="intro-text">{text}</p>}
    </section>
  );
}
