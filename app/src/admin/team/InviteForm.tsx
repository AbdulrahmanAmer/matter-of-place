import { useState } from "react";
import type { InviteInput } from "../../domain/admin-team";
import { appRoles, roleLabels } from "../../domain/contracts";
import type { AppRole } from "../../domain/rows";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";

/**
 * Invites a person by email with one or more roles. Supabase Auth sends the invitation mail, so the person confirms
 * the address and roles once before it goes (C17).
 */
export function InviteForm({
  pending,
  onInvite,
}: {
  pending: boolean;
  /** Resolves once the account and its roles exist. */
  onInvite: (input: InviteInput) => Promise<unknown>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<readonly AppRole[]>([]);
  const [confirming, setConfirming] = useState(false);
  const toggle = (role: AppRole, on: boolean) => {
    setRoles((current) => (on ? [...current, role] : current.filter((item) => item !== role)));
  };
  return (
    <form
      className="admin-toolbar"
      onSubmit={(event) => {
        event.preventDefault();
        setConfirming(true);
      }}
    >
      <Field label="Email">
        {(control) => (
          <input
            {...control}
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Name">
        {(control) => (
          <input
            {...control}
            required
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </Field>
      <fieldset>
        <legend>Roles</legend>
        {appRoles.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) => {
                toggle(role, event.target.checked);
              }}
            />
            {roleLabels[role]}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="admin-button" disabled={pending || roles.length === 0}>
        Send invitation
      </button>
      <ConfirmDialog
        open={confirming}
        title="Send an invitation"
        confirmLabel="Send invitation"
        pending={pending}
        onConfirm={() => {
          onInvite({ email, display_name: name, roles: [...roles] }).then(
            () => {
              setConfirming(false);
              setEmail("");
              setName("");
              setRoles([]);
            },
            () => {
              setConfirming(false);
            },
          );
        }}
        onCancel={() => {
          setConfirming(false);
        }}
      >
        <p>
          An invitation goes to {email} now, as {roles.map((role) => roleLabels[role]).join(", ")}.
        </p>
      </ConfirmDialog>
    </form>
  );
}
