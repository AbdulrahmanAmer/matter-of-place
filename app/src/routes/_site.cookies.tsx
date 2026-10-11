import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { cookieInventory, type CookieCategory } from "../config/cookies";
import { siteConfig } from "../config/site";
import { breadcrumbLd } from "../lib/jsonld";
import { legalIdentity } from "../lib/legal-identity";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { useSite } from "../lib/queries";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/cookies")({
  head: ({ matches }) =>
    pageHead({
      title: t.cookies.title,
      description: pageDescription("cookies"),
      path: "/cookies",
      image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
      jsonLd: [breadcrumbLd([{ name: t.cookies.title, path: "/cookies" }])],
    }),
  component: CookiesPage,
});

const categoryLabel: Record<CookieCategory, string> = {
  necessary: "Necessary",
  analytics: "Analytics",
};

function CookiesPage() {
  const identity = legalIdentity(useSite().legal);
  return (
    <main>
      <PageIntro eyebrow="PRIVACY" title={t.cookies.title} text={t.cookies.intro} />
      <div className="copy-page">
        <h2>Who we are</h2>
        <p>
          Matter of Place is a product of {siteConfig.parentCompany}. The party responsible for
          these cookies is {identity.entity}, {identity.address}.
        </p>

        <table className="cookie-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Purpose</th>
              <th scope="col">Provider</th>
              <th scope="col">Duration</th>
              <th scope="col">Category</th>
            </tr>
          </thead>
          <tbody>
            {cookieInventory.map((cookie) => (
              <tr key={cookie.name}>
                <th scope="row">{cookie.name}</th>
                <td data-label="Purpose">{cookie.purpose}</td>
                <td data-label="Provider">{cookie.provider}</td>
                <td data-label="Duration">{cookie.duration}</td>
                <td data-label="Category">{categoryLabel[cookie.category]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
