import type { VariantState } from "../../domain/admin-media";
import { useAdminMe } from "../ui/admin-me";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill, type Tone } from "../ui/StatusPill";

const SHOWN: Readonly<Record<VariantState | "uploading", { label: string; tone: Tone }>> = {
  uploading: { label: "Uploading", tone: "info" },
  staged: { label: "Staged", tone: "neutral" },
  processing: { label: "Processing", tone: "info" },
  ready: { label: "Ready", tone: "ok" },
  failed: { label: "Render failed", tone: "danger" },
};

/**
 * Where a photograph's variants stand. A failed render offers Retry to the roles that may retry a job (B8's
 * `jobs.retry`, media ops and admin); anyone else is sent to Jobs, filtered to the property.
 */
export function VariantStatus({
  state,
  propertyId,
  retrying = false,
  onRetry,
}: {
  state: VariantState | "uploading";
  propertyId: string;
  retrying?: boolean;
  onRetry: () => void;
}) {
  const { actions } = useAdminMe();
  const shown = SHOWN[state];
  return (
    <div className="admin-variant">
      <StatusPill label={shown.label} tone={shown.tone} />
      {state === "failed" ? (
        <>
          <RoleGate action="jobs.retry">
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={retrying}
              onClick={onRetry}
            >
              Retry
            </button>
          </RoleGate>
          {actions.includes("jobs.retry") ? null : (
            <p className="admin-variant__note">
              Render failed, media ops can retry it in{" "}
              <a href={`/admin/jobs?entity=${propertyId}`}>Jobs</a>.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
