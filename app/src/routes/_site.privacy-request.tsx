import { createFileRoute } from "@tanstack/react-router";
import { PrivacyRequestForm } from "../components/forms/privacy-request-form";
import { PageIntro } from "../components/site/page-intro";
import { subjectRequestKinds, type SubjectRequest } from "../domain/contracts";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/privacy-request")({
  validateSearch: (search: Record<string, unknown>): { kind?: SubjectRequest["kind"] } => {
    const found = subjectRequestKinds.find((kind) => kind === search["kind"]);
    return found === undefined ? {} : { kind: found };
  },
  head: () =>
    pageHead({
      title: t.privacyRequest.title,
      description: pageDescription("privacy-request"),
      path: "/privacy-request",
      noindex: true,
    }),
  component: PrivacyRequestPage,
});

function PrivacyRequestPage() {
  const { kind } = Route.useSearch();
  return (
    <main>
      <PageIntro
        eyebrow={t.privacyRequest.eyebrow}
        title={t.privacyRequest.heading}
        text={t.privacyRequest.intro}
      />
      <div className="copy-page">
        <PrivacyRequestForm {...(kind === undefined ? {} : { kind })} />
      </div>
    </main>
  );
}
