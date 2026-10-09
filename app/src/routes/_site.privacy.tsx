import { createFileRoute, Link } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { legalVersions, siteConfig } from "../config/site";
import { retentionPeriods } from "../domain/retention";
import { presentLines, privacyLines } from "../domain/settings";
import { pluralize } from "../lib/format";
import { breadcrumbLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { useSite } from "../lib/queries";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/privacy")({
  head: ({ matches }) =>
    pageHead({
      title: t.nav.privacy,
      description: pageDescription("privacy"),
      path: "/privacy",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [breadcrumbLd([{ name: t.nav.privacy, path: "/privacy" }])],
    }),
  component: PrivacyPage,
});

type Period = (typeof retentionPeriods)[keyof typeof retentionPeriods];
type RetentionKey = keyof typeof retentionPeriods;

function periodText(period: Period): string {
  if ("days" in period) return `${String(period.days)} ${pluralize(period.days, "day")}`;
  if ("months" in period) return `${String(period.months)} ${pluralize(period.months, "month")}`;
  return `${String(period.hours)} ${pluralize(period.hours, "hour")}`;
}

const keep = (key: RetentionKey) => periodText(retentionPeriods[key]);

const retentionRows: readonly { key: RetentionKey; label: string }[] = [
  { key: "declined_submission_media", label: "Photographs from a declined submission" },
  { key: "inquiries_anonymise", label: "Inquiries, until the sender's details are removed" },
  {
    key: "contacts_anonymise",
    label: "Details of a person who submitted a property, after their last request",
  },
  { key: "subject_requests", label: "Privacy requests" },
  { key: "analytics_events", label: "Raw analytics events" },
  { key: "analytics_daily", label: "Daily analytics totals, which hold no personal data" },
  { key: "unconfirmed_subscribers", label: "Newsletter signups that were never confirmed" },
  { key: "email_pii", label: "Email addresses in sent-message and delivery records" },
  { key: "rate_limits", label: "Hashed IP addresses in rate-limit records" },
];

const categories: readonly {
  name: string;
  what: string;
  source: string;
  purpose: string;
  kept: string;
  receives: string;
}[] = [
  {
    name: "Identifiers",
    what: "Name, email, phone, and an IP address held only as a hash for rate limits and rights records.",
    source: "You, through the forms.",
    purpose: "To reply to you, run the service and limit abuse.",
    kept: `Inquiries ${keep("inquiries_anonymise")}, privacy requests ${keep("subject_requests")}. A hashed IP address is deleted from rate-limit records after ${keep("rate_limits")}; one stored with an inquiry, a privacy request or a rights confirmation stays with that record.`,
    receives: "Supabase, Resend, Cloudflare.",
  },
  {
    name: "Commercial information",
    what: "Submission, invoice and payment records.",
    source: "You, through the submission form and our replies.",
    purpose: "To review, publish and invoice a property.",
    kept: "For as long as the record is needed to run the service and for accounting.",
    receives: "Supabase, Resend.",
  },
  {
    name: "Professional information",
    what: "Whether you are an agent or the owner, your brokerage and your role.",
    source: "You, through the submission form.",
    purpose: "To credit a property correctly and route replies.",
    kept: `Anonymised ${keep("contacts_anonymise")} after your last request.`,
    receives: "Supabase, Resend.",
  },
  {
    name: "Internet activity",
    what: "Page views and events.",
    source: "Your browser.",
    purpose: "To see which pages are read.",
    kept: `Raw events ${keep("analytics_events")}, daily totals ${keep("analytics_daily")}.`,
    receives: "Supabase. Google Analytics, only after you allow analytics.",
  },
  {
    name: "Audio, visual and similar information",
    what: "Photographs supplied by agents and owners.",
    source: "The person who submits the property.",
    purpose: "To review the property and, once accepted, publish it.",
    kept: `Declined photographs ${keep("declined_submission_media")}. Accepted photographs while the property is published.`,
    receives: "Supabase, Cloudflare, GitHub.",
  },
];

function PrivacyPage() {
  const site = useSite();
  const responsible = presentLines(site.legal.entity)[0] ?? siteConfig.parentCompany;
  const mailbox = privacyLines(site)[0];
  return (
    <main>
      <PageIntro
        eyebrow="PRIVACY"
        title={t.nav.privacy}
        text="How Matter of Place handles personal information, written for California residents."
      />
      <div className="copy-page">
        <h2>Who is responsible</h2>
        <p>
          {responsible} is responsible for the personal information described on this page. Matter
          of Place is a product of {siteConfig.parentCompany}.
        </p>
        {mailbox !== undefined && (
          <p>
            For privacy questions write to <a href={`mailto:${mailbox}`}>{mailbox}</a>.
          </p>
        )}

        <h2>What we collect</h2>
        <table className="cookie-table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">What</th>
              <th scope="col">Source</th>
              <th scope="col">Purpose</th>
              <th scope="col">Kept</th>
              <th scope="col">Who receives it</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.name}>
                <th scope="row">{category.name}</th>
                <td data-label="What">{category.what}</td>
                <td data-label="Source">{category.source}</td>
                <td data-label="Purpose">{category.purpose}</td>
                <td data-label="Kept">{category.kept}</td>
                <td data-label="Who receives it">{category.receives}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>We draw no inferences about you. We collect no sensitive personal information.</p>

        <h2>Where it comes from</h2>
        <p>
          It comes from you, through the forms on this site, and from your browser, through
          analytics once you allow them.
        </p>

        <h2>How we use it</h2>
        <p>
          We use it to answer inquiries, review and publish submitted properties, send the messages
          you ask for, invoice accepted properties, keep the site working and understand which pages
          are read.
        </p>

        <h2>Who receives it</h2>
        <p>
          Cloudflare hosts the site and serves its pages and images. Supabase holds the database and
          the files. Resend sends email. Google Analytics counts page reads, with gtag.js only and
          no Tag Manager. Sentry receives error reports. GitHub renders images and video from
          photographs that were supplied to us.
        </p>
        <p>
          Anthropic receives property facts when a caption is drafted. That runs through Claude on
          the operator's own computer, and we hold no Anthropic key.
        </p>
        <p>
          Meta, X and LinkedIn receive only what we post. {siteConfig.parentCompany} receives the
          inquiries forwarded to it. The person who submitted a property, an agent or its owner,
          receives the messages sent about that property.
        </p>

        <h2>How long we keep it</h2>
        <table className="cookie-table">
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Kept for</th>
            </tr>
          </thead>
          <tbody>
            {retentionRows.map(({ key, label }) => (
              <tr key={key} data-retention={key}>
                <th scope="row">{label}</th>
                <td data-label="Kept for">{keep(key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Audit records are kept.</p>

        <h2>Cookies and analytics</h2>
        <p>
          Google Analytics loads only after you allow analytics. Nothing loads for anyone who has
          not chosen. Our own events are anonymous. You can change your choice at any time on the{" "}
          <Link to="/privacy-choices">privacy choices</Link> page.
        </p>
        <p>
          <Link to="/cookies">{t.privacy.cookiesLink}</Link>
        </p>

        <h2>Your California privacy rights</h2>
        <p>
          You can ask to know what we hold about you, to have it deleted, to have it corrected, and
          to opt out of the sale or sharing of personal information. We do not treat you differently
          for asking.
        </p>
        <p>
          Use the <a href="/privacy-request">privacy request form</a>
          {mailbox === undefined ? "" : `, or write to ${mailbox}`}. We confirm receipt by email as
          soon as the request arrives, and we check identity by asking you to reply from the address
          you gave. An authorised agent may ask for you. We respond within 45 days.
        </p>

        <h2 id="do-not-sell">Do Not Sell or Share My Personal Information</h2>
        <p>
          We do not sell personal information and we do not share it for cross-context behavioural
          advertising. There is nothing to opt out of.
        </p>
        <p>
          You can still record the request on the{" "}
          <a href="/privacy-request?kind=opt_out">privacy request form</a>. A Global Privacy Control
          signal from your browser is treated as a refusal of analytics cookies.
        </p>

        <h2>Children</h2>
        <p>
          This site is not directed to children under 16, and we do not knowingly collect their
          information.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          Last updated <time dateTime={legalVersions.privacy}>{legalVersions.privacy}</time>. A
          change to this page is dated here.
        </p>

        <h2>Contact</h2>
        <p>
          {mailbox === undefined ? (
            <>
              Write to us through the <Link to="/contact">contact page</Link>.
            </>
          ) : (
            <>
              <a href={`mailto:${mailbox}`}>{mailbox}</a>, or the{" "}
              <Link to="/contact">contact page</Link>.
            </>
          )}
        </p>
      </div>
    </main>
  );
}
