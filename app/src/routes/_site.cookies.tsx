import { createFileRoute } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { cookieInventory, type CookieCategory } from "../config/cookies";
import { breadcrumbLd } from "../lib/jsonld";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/cookies")({
  head: () =>
    pageHead({
      title: t.cookies.title,
      description: pageDescription("cookies"),
      path: "/cookies",
      jsonLd: [breadcrumbLd([{ name: t.cookies.title, path: "/cookies" }])],
    }),
  component: CookiesPage,
});

const categoryLabel: Record<CookieCategory, string> = {
  necessary: "Necessary",
  analytics: "Analytics",
};

function CookiesPage() {
  return (
    <main>
      <PageIntro eyebrow="PRIVACY" title={t.cookies.title} text={t.cookies.intro} />
      <div className="copy-page">
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
