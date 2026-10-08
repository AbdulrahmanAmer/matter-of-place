import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
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

const noSubscription = () => () => undefined;

function PrivacyRequestPage() {
  const { kind } = Route.useSearch();
  // The page is stored once under the `/privacy-request` key, so the server render and the hydration pass
  // ignore `?kind=`; the link's kind is applied by the render that follows hydration.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return (
    <main>
      <PageIntro
        eyebrow={t.privacyRequest.eyebrow}
        title={t.privacyRequest.heading}
        text={t.privacyRequest.intro}
      />
      <div className="copy-page">
        <PrivacyRequestForm {...(hydrated && kind !== undefined ? { kind } : {})} />
      </div>
    </main>
  );
}
