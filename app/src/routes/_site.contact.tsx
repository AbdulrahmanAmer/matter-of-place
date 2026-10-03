import { createFileRoute } from "@tanstack/react-router";
import { ContactForm } from "../components/forms/contact-form";
import { PageIntro } from "../components/site/page-intro";
import { TextLink } from "../components/site/text-link";
import { siteConfig } from "../config/site";
import { pageHead } from "../lib/seo";

const description =
  "Write to Matter of Place about a property, a market, or presenting a residence.";

export const Route = createFileRoute("/_site/contact")({
  head: () => pageHead({ title: "Contact", description, path: "/contact" }),
  component: ContactPage,
});

function ContactPage() {
  const { email, phone } = siteConfig.contact;
  return (
    <main>
      <PageIntro
        eyebrow="A CONVERSATION"
        title="Contact"
        text="Every message is read by a person. Tell us what you are looking for, or what you would like to present."
      />
      <div className="contact-layout">
        <ContactForm />

        <aside className="contact-meta">
          <div>
            <p className="eyebrow">PROPERTY SEEKERS</p>
            <h3>Ask about a place.</h3>
            <p>
              Each property page has its own inquiry paths: private showings, questions, similar
              properties, and selling first. Start there if you have a specific house in mind.
            </p>
            <TextLink to="/properties" className="contact-meta-link">
              Browse properties
            </TextLink>
          </div>
          <div>
            <p className="eyebrow">OWNERS, AGENTS & DEVELOPERS</p>
            <h3>Present a property.</h3>
            <p>
              Submissions go through a short guided form. Every property is reviewed before a paid
              feature or campaign is agreed.
            </p>
            <TextLink to="/submit" className="contact-meta-link">
              Submit a property
            </TextLink>
          </div>
          <div>
            <p className="eyebrow">MARKETS</p>
            <h3>California, Florida and New York.</h3>
            <p>Three markets, read closely, each with its own guide.</p>
            {(email || phone) && (
              <p className="contact-details">
                {email && <a href={`mailto:${email}`}>{email}</a>}
                {phone && <a href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>}
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
