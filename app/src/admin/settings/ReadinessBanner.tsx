import { siteFieldSpecs } from "../../domain/settings";

// B6's invoice names (`invoiceReadiness`); the identity names come from B16's field specs.
const invoiceLabels: Readonly<Record<string, string>> = {
  invoice: "Invoice settings",
  "payment_methods.instructions": "Payment instructions",
  terms: "Payment terms",
  late_terms: "Late payment terms",
  tax_line: "Tax line",
};

/** The label of a readiness name; an unknown name shows as it is, so nothing missing is hidden. */
function readinessLabel(name: string): string {
  return siteFieldSpecs.find((spec) => spec.key === name)?.label ?? invoiceLabels[name] ?? name;
}

/** What still stands between the site and launch: the identity and invoice settings that are unset. */
export function ReadinessBanner({ readiness }: { readiness: readonly string[] }) {
  if (readiness.length === 0) {
    return <p role="status">Every setting the site and its invoices need is in place.</p>;
  }
  return (
    <section className="admin-banner" aria-labelledby="settings-readiness">
      <h2 id="settings-readiness">Before launch</h2>
      <p>
        These settings are still unset. Invoices cannot be issued and the site cannot launch until
        they are.
      </p>
      <ul className="admin-readiness">
        {readiness.map((name) => (
          <li key={name}>{readinessLabel(name)}</li>
        ))}
      </ul>
    </section>
  );
}
