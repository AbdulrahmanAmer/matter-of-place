import type { ChecklistResult, PropertyRecord } from "../../domain/admin-properties";
import { editorialStateLabels } from "../../domain/contracts";
import { JobWatcher, type WatchedJob } from "../ui/JobWatcher";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { AgentPreviewButton, type AgentLink } from "./AgentPreviewButton";
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
 * every checklist item passes (CE, ME). A published property saves each edit to the live page; Unpublish asks for a
 * reason, and an archived property that was not taken down can still be.
 */
export function PublishBar({
  propertyId,
  state,
  takenDown,
  marketSlug,
  previewReady,
  checklist,
  pending,
  jobs,
  onMove,
  onPublish,
  onUnpublish,
  onSendAgent,
  onRevokePreviews,
}: {
  propertyId: string;
  state: EditorialState;
  takenDown: boolean;
  marketSlug: string;
  previewReady: boolean;
  checklist: readonly ChecklistResult[];
  pending: boolean;
  jobs: readonly WatchedJob[];
  onMove: (to: "draft" | "review") => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onSendAgent: () => Promise<AgentLink | null>;
  onRevokePreviews: () => Promise<boolean>;
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
        {state === "published" || (state === "archived" && !takenDown) ? (
          <RoleGate action="properties.unpublish">
            <button
              type="button"
              className="admin-button admin-button--danger"
              disabled={pending}
              onClick={onUnpublish}
            >
              {state === "published" ? "Unpublish" : "Take down"}
            </button>
          </RoleGate>
        ) : null}
      </div>
      <AgentPreviewButton
        canSend={
          previewReady && (state === "draft" || state === "review" || state === "agent_review")
        }
        pending={pending}
        marketSlug={marketSlug}
        onSend={onSendAgent}
        onRevoke={onRevokePreviews}
      />
      <JobWatcher jobs={jobs} />
    </aside>
  );
}
