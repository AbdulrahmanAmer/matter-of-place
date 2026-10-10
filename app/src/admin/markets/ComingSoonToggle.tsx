import { useState } from "react";
import type { MarketDetail } from "../../domain/admin-markets";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { useSetComingSoon } from "./markets-queries";

/**
 * Whether a market is open. Opening shows its properties and, once, tells the confirmed interest signups; returning it
 * to coming soon shows the signup again. Both ask first, and the interest counts come with the market.
 */
export function ComingSoonToggle({ market }: { market: MarketDetail }) {
  const toast = useToast();
  const toggle = useSetComingSoon();
  const [asking, setAsking] = useState(false);
  const opening = market.coming_soon;
  const { confirmed, pending } = market.interest;

  const confirm = async () => {
    try {
      await toggle.mutateAsync({ slug: market.slug, comingSoon: !opening });
      toast({ message: opening ? `${market.name} is open.` : `${market.name} is coming soon.` });
    } catch (failure) {
      toast({
        message: failure instanceof AdminApiError ? failure.message : "That did not go through.",
        tone: "danger",
      });
    } finally {
      setAsking(false);
    }
  };

  return (
    <section aria-label="Coming soon" className="admin-editor__fields">
      <h2>
        <StatusPill label={opening ? "Coming soon" : "Open"} tone={opening ? "neutral" : "ok"} />
      </h2>
      <p>
        {opening
          ? "The market page takes interest signups and shows no property."
          : "The market page shows its properties."}
      </p>
      <p>{`Interest: ${String(confirmed)} confirmed, ${String(pending)} waiting to confirm.`}</p>
      <RoleGate action="markets.coming_soon">
        <div className="admin-actions">
          <button
            type="button"
            className="admin-button"
            disabled={toggle.isPending}
            onClick={() => {
              setAsking(true);
            }}
          >
            {opening ? "Open this market" : "Return to coming soon"}
          </button>
        </div>
      </RoleGate>
      <ConfirmDialog
        open={asking}
        title={opening ? `Open ${market.name}` : `Return ${market.name} to coming soon`}
        confirmLabel={opening ? "Open" : "Return"}
        pending={toggle.isPending}
        onConfirm={() => {
          void confirm();
        }}
        onCancel={() => {
          setAsking(false);
        }}
      >
        <p>
          {opening
            ? "The market page starts showing its properties. Confirmed interest signups are sent one notice that it is open."
            : "The market page shows the interest signup again and hides its properties."}
        </p>
      </ConfirmDialog>
    </section>
  );
}
