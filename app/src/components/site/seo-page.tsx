import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SeoBlock, SeoCtaKey, SeoPageContent } from "../../content/seo/types";
import { servedRelated, splitInline } from "../../lib/seo-page";
import { Breadcrumb } from "./breadcrumb";
import { PageIntro } from "./page-intro";
import { TextLink } from "./text-link";

const actions = {
  submit: { to: "/submit", label: "Submit a Property" },
  notes: { to: "/place-notes", label: "Place Notes" },
  contact: { to: "/contact", label: "Ask us a question" },
} as const satisfies Record<SeoCtaKey, { to: string; label: string }>;

/** A line of copy with its `[anchor](/path)` links drawn; a link to a page that does not exist yet stays plain text. */
function Inline({ text }: { text: string }): ReactNode {
  return splitInline(text).map((part, index) =>
    part.to === undefined ? (
      part.text
    ) : (
      <a key={index} href={part.to}>
        {part.text}
      </a>
    ),
  );
}

function Block({ block }: { block: SeoBlock }) {
  if (typeof block === "string") {
    return (
      <p>
        <Inline text={block} />
      </p>
    );
  }
  if ("h3" in block) return <h3>{block.h3}</h3>;
  const Tag = "list" in block ? "ul" : "ol";
  const items = "list" in block ? block.list : block.steps;
  return (
    <Tag className="seo-list">
      {items.map((item) => (
        <li key={item}>
          <Inline text={item} />
        </li>
      ))}
    </Tag>
  );
}

/** One search page from its content file: the intro band, the sections, the questions, the closing action. */
export function SeoPage({ page }: { page: SeoPageContent }) {
  const related = servedRelated(page);
  return (
    <main>
      <PageIntro eyebrow={page.eyebrow} title={page.h1} />
      <article className="copy-page seo-page">
        <Breadcrumb>
          <Link to="/">Home</Link>
          {page.kind === "guide" && <Link to="/guides">Guides</Link>}
          <span>{page.h1}</span>
        </Breadcrumb>
        <p className="seo-lede">
          <Inline text={page.lede} />
        </p>
        {page.sections.map((section) => (
          <section key={section.heading} className="section-block">
            <h2>{section.heading}</h2>
            {section.body.map((block, index) => (
              <Block key={index} block={block} />
            ))}
          </section>
        ))}
        <section className="section-block">
          <h2>Frequently asked questions</h2>
          {page.faq.map((item) => (
            <div key={item.q} className="seo-faq">
              <h3>{item.q}</h3>
              <p>
                <Inline text={item.a} />
              </p>
            </div>
          ))}
        </section>
        <section className="section-block">
          <h2>{page.cta.heading}</h2>
          <p>
            <Inline text={page.cta.text} />
          </p>
          <div className="seo-actions">
            {[page.cta.primary, page.cta.secondary].map((key) =>
              key === undefined ? null : (
                <TextLink key={key} to={actions[key].to}>
                  {actions[key].label}
                </TextLink>
              ),
            )}
          </div>
        </section>
        {related.length > 0 && (
          <aside className="seo-related" aria-label="Related pages">
            <p className="eyebrow">RELATED</p>
            <ul>
              {related.map((link) => (
                <li key={link.to}>
                  <a href={link.to}>{link.anchor}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </article>
    </main>
  );
}
