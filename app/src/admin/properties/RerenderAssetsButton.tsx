import { useState } from "react";
import type { AdminAsset } from "../../domain/admin-assets";
import { useAssets, useRerenderAssets } from "../assets/assets-queries";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { JobWatcher, type WatchedJob } from "../ui/JobWatcher";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";

/** The job type each kind renders with (B9 invariant 3), so the watcher names what was started. */
const jobTypes: Record<AdminAsset["kind"], string> = {
  cover: "render_cover",
  carousel: "render_carousel",
  story: "render_story",
  reel: "render_reel",
  newsletter_block: "build_newsletter_block",
  standalone_email: "build_newsletter_block",
};

/** The highest revision of each kind that was not rejected: the creative the property has now. */
function currentAssets(items: readonly AdminAsset[]): AdminAsset[] {
  const latest = new Map<AdminAsset["kind"], AdminAsset>();
  for (const asset of items) {
    if (asset.status === "rejected") continue;
    const held = latest.get(asset.kind);
    if (held === undefined || asset.revision > held.revision) latest.set(asset.kind, asset);
  }
  return [...latest.values()];
}

/** Screen 8's "request re-render of assets": one re-render for each current asset of the property, then the jobs it started. */
export function RerenderAssetsButton({ propertyId }: { propertyId: string }) {
  const toast = useToast();
  const assets = useAssets({ property_id: propertyId });
  const rerender = useRerenderAssets();
  const [jobs, setJobs] = useState<WatchedJob[]>([]);
  const [asking, setAsking] = useState(false);
  const current = currentAssets(assets.data?.items ?? []);

  const request = () => {
    rerender.mutate(
      current.map((asset) => asset.id),
      {
        onSuccess: (answers) => {
          setJobs(
            answers.flatMap(({ job_id }, index) => {
              const asset = current[index];
              return job_id === null || asset === undefined
                ? []
                : [{ id: job_id, type: jobTypes[asset.kind], status: "queued" }];
            }),
          );
          toast({ message: "Re-render requested." });
        },
        onError: (error) => {
          toast({ message: error.message, tone: "danger" });
        },
        onSettled: () => {
          setAsking(false);
        },
      },
    );
  };

  return (
    <RoleGate action="assets.re_render">
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={current.length === 0 || rerender.isPending}
        onClick={() => {
          setAsking(true);
        }}
      >
        Request re-render of assets
      </button>
      <ConfirmDialog
        open={asking}
        title="Request re-render of assets"
        confirmLabel="Re-render"
        pending={rerender.isPending}
        onConfirm={request}
        onCancel={() => {
          setAsking(false);
        }}
      >
        <p>
          Each of the {current.length} current assets gets a new revision, and the revision it
          replaces is marked rejected as superseded, an approved one included. Captions and alt text
          carry over.
        </p>
      </ConfirmDialog>
      {assets.data !== undefined && current.length === 0 ? (
        <span className="admin-asset__note">No assets yet.</span>
      ) : null}
      <JobWatcher jobs={jobs} />
    </RoleGate>
  );
}
