import { featureFlags, flagLabels, type FeatureFlag } from "../../domain/flags";
import { RequestFailure } from "../automation/RequestFailure";
import { useFlags, useSaveFlag } from "../automation/automation-queries";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";

const flagNames: Record<FeatureFlag, string> = {
  new_channels: "New channels",
  archive_pages: "Archive pages",
  csp_enforce: "Enforce the content security policy",
  maintenance: "Maintenance notice",
};

/**
 * The feature flags of screen 24. Every role reads them; only an admin acting as a person changes one, and the server
 * refuses anyone else again. A switch moves when the server's answer arrives, not before.
 */
export function FlagsSection() {
  const flags = useFlags();
  const save = useSaveFlag();
  const toast = useToast();
  const { actions } = useAdminMe();
  const canEdit = actions.includes("automation.flags_put");

  if (flags.isPending) return <p role="status">Loading flags.</p>;
  if (flags.isError) return <RequestFailure error={flags.error} />;
  return (
    <section aria-labelledby="flags-heading">
      <h2 id="flags-heading">Feature flags</h2>
      <ul className="admin-flags">
        {featureFlags.map((flag) => (
          <li key={flag}>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={flags.data[flag]}
                disabled={!canEdit || save.isPending}
                onChange={(event) => {
                  save.mutate(
                    { flag, value: event.target.checked },
                    {
                      onSuccess: () => {
                        toast({ message: `${flagNames[flag]} saved.` });
                      },
                    },
                  );
                }}
              />
              {flagNames[flag]}
            </label>
            <p className="admin-field__hint">{flagLabels[flag]}</p>
          </li>
        ))}
      </ul>
      {save.isError ? <RequestFailure error={save.error} className="admin-field__error" /> : null}
    </section>
  );
}
