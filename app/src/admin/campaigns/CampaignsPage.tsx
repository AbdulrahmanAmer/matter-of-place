import { campaignListLimit } from "../../domain/admin-campaigns";
import { AdminApiError } from "../ui/admin-fetch";
import { CampaignsTable } from "./CampaignsTable";
import { useCampaigns } from "./campaigns-queries";

/**
 * Screen 33 (W7 item 3). Every campaign with its property, package, money, dates and channel statuses, and a link to
 * its weekly reports when it has any. Read only: a campaign is created by activating a paid submission.
 */
export function CampaignsPage() {
  const campaigns = useCampaigns();
  const failure = campaigns.error;
  const total = campaigns.data?.total ?? 0;
  return (
    <>
      <h1>Campaigns</h1>
      <p className="admin-lead">
        What each paid property is running: the package, the money, the dates and every channel.
      </p>
      <CampaignsTable
        now={new Date()}
        rows={campaigns.data?.items ?? []}
        loading={campaigns.isPending}
        error={
          failure === null
            ? null
            : {
                message: failure.message,
                ...(failure instanceof AdminApiError && failure.requestId !== undefined
                  ? { requestId: failure.requestId }
                  : {}),
              }
        }
      />
      {total > campaignListLimit ? (
        <p className="admin-lead">{`Showing the newest ${String(campaignListLimit)} of ${String(total)} campaigns.`}</p>
      ) : null}
    </>
  );
}
