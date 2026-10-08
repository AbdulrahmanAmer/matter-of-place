import { useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";

export interface AgentLink {
  url: string;
  expires_at: string;
}

/**
 * Agent review (invariant 14, GG-07): a 7 day link to the draft for the listing agent, which moves the property to agent
 * review, and the revocation of every preview link of this property.
 */
export function AgentPreviewButton({
  canSend,
  pending,
  marketSlug,
  onSend,
  onRevoke,
}: {
  canSend: boolean;
  pending: boolean;
  marketSlug: string;
  onSend: () => Promise<AgentLink | null>;
  onRevoke: () => Promise<boolean>;
}) {
  const [link, setLink] = useState<AgentLink | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="admin-actions">
      {canSend ? (
        <RoleGate action="properties.agent_preview">
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={pending}
            onClick={() => {
              void onSend().then(setLink);
            }}
          >
            Send preview to agent
          </button>
        </RoleGate>
      ) : null}
      {link === null ? null : (
        <div className="admin-field">
          <label>
            Link for the agent
            <input
              readOnly
              value={new URL(link.url, window.location.origin).href}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
          </label>
          <p className="admin-field__hint">
            Works until <LocalTime value={link.expires_at} marketSlug={marketSlug} />.
          </p>
        </div>
      )}
      <RoleGate action="properties.revoke_previews">
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={pending}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Revoke preview links
        </button>
      </RoleGate>
      <ConfirmDialog
        open={confirming}
        title="Revoke preview links"
        confirmLabel="Revoke"
        danger
        pending={pending}
        onConfirm={() => {
          void onRevoke().then((revoked) => {
            if (revoked) setLink(null);
            setConfirming(false);
          });
        }}
        onCancel={() => {
          setConfirming(false);
        }}
      >
        <p>
          Every preview link of this property stops working, the agent&apos;s and the editor&apos;s.
          Links of other properties are untouched.
        </p>
      </ConfirmDialog>
    </div>
  );
}
