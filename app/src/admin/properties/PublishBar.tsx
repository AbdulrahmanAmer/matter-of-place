import type { ChecklistResult, PropertyRecord } from "../../domain/admin-properties";
import { editorialStateLabels } from "../../domain/contracts";
import { JobWatcher, type WatchedJob } from "../ui/JobWatcher";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { Checklist } from "./Checklist";
import { RerenderAssetsButton } from "./RerenderAssetsButton";

type EditorialState = PropertyRecord["editorial_state"];

const tone: Record<EditorialState, Tone> = {
  draft: "neutral",
  review: "warning",
  agent_review: "warning",
  published: "ok",
  archived: "neutral",
};

/**
 * The state of the dossier and its moves: to review and back to draft (autosaved fields go first), and Publish once
 * every checklist item passes (CE, ME). A published property saves each edit to the live page.
 */
export function PublishBar({
  propertyId,
  state,
  checklist,
  pending,
  jobs,
  onMove,
  onPublish,
}: {
  propertyId: string;
  state: EditorialState;
  checklist: readonly ChecklistResult[];
  pending: boolean;
  jobs: readonly WatchedJob[];
  onMove: (to: "draft" | "review") => void;
  onPublish: () => void;
}) {
  const ready = checklist.every((item) => item.passed);
  return (
    <aside className="admin-publish" aria-label="Publication" data-print="hide">
      <p>
        <StatusPill label={editorialStateLabels[state]} tone={tone[state]} />
      </p>
      {state === "published" ? <p>Live. Each edit saves to the public page.</p> : null}
      <Checklist items={checklist} />
      <div className="admin-actions">
        <RoleGate action="properties.update">
          {state === "draft" ? (
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={pending}
              onClick={() => {
                onMove("review");
              }}
            >
              Send to review
            </button>
          ) : null}
          {state === "review" || state === "agent_review" || state === "archived" ? (
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={pending}
              onClick={() => {
                onMove(state === "agent_review" ? "review" : "draft");
              }}
            >
              {state === "agent_review" ? "Agent approved, back to review" : "Back to draft"}
            </button>
          ) : null}
        </RoleGate>
        {state === "review" || state === "agent_review" ? (
          <RoleGate action="properties.publish">
            <button
              type="button"
              className="admin-button"
              disabled={pending || !ready}
              onClick={onPublish}
            >
              Publish
            </button>
          </RoleGate>
        ) : null}
        <RerenderAssetsButton propertyId={propertyId} />
      </div>
      <JobWatcher jobs={jobs} />
    </aside>
  );
}
