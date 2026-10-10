import type { TeamUser } from "../../domain/admin-team";
import { roleLabels } from "../../domain/contracts";
import type { AppRole } from "../../domain/rows";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/** A change to one account that waits for the person to confirm it. */
export type UserChange =
  { kind: "revoke"; row: TeamUser; role: AppRole } | { kind: "disable"; row: TeamUser };

function copy(change: UserChange) {
  const name = change.row.display_name ?? change.row.email;
  if (change.kind === "revoke") {
    const role = roleLabels[change.role];
    return {
      title: "Remove a role",
      confirmLabel: "Remove role",
      body: `${name} loses ${role} on the next request.`,
    };
  }
  return change.row.disabled
    ? {
        title: "Enable this account",
        confirmLabel: "Enable account",
        body: `${name} can work again from the next request.`,
      }
    : {
        title: "Disable this account",
        confirmLabel: "Disable account",
        body: `${name} loses access on the next request. An admin can enable the account again.`,
      };
}

/** Screen 23's confirmation for removing a role or disabling an account: neither is sent on one click. */
export function UserChangeDialog({
  change,
  pending,
  onConfirm,
  onCancel,
}: {
  change: UserChange | null;
  pending: boolean;
  onConfirm: (change: UserChange) => void;
  onCancel: () => void;
}) {
  const text = change === null ? null : copy(change);
  return (
    <ConfirmDialog
      open={change !== null}
      title={text?.title ?? ""}
      confirmLabel={text?.confirmLabel ?? ""}
      danger={change?.kind === "revoke" || change?.row.disabled === false}
      pending={pending}
      onConfirm={() => {
        if (change !== null) onConfirm(change);
      }}
      onCancel={onCancel}
    >
      <p>{text?.body}</p>
    </ConfirmDialog>
  );
}
