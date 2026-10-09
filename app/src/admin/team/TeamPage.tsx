import { useState } from "react";
import type { AgentKeyRow, KeyCreated } from "../../domain/admin-team";
import { AdminPending } from "../ui/AdminPending";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/use-toast";
import { AgentKeysTable } from "./AgentKeysTable";
import { DailyLimitsForm } from "./DailyLimitsForm";
import { InviteForm } from "./InviteForm";
import { NewKeyForm } from "./NewKeyForm";
import { RevokeAllDialog } from "./RevokeAllDialog";
import {
  useAgentKeys,
  useCreateAgent,
  useCreateAgentKey,
  useDailyLimits,
  useGrantRole,
  useInvite,
  useRevokeAgentKey,
  useRevokeAll,
  useRevokeRole,
  useSaveDailyLimits,
  useSetDisabled,
  useTeamUsers,
} from "./team-queries";
import { UsersTable } from "./UsersTable";

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "This change could not be made.";

/** Keyset pages: the cursors of the pages before the current one, and the current one last. */
function usePages() {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  return {
    cursor,
    pager: (next: string | null | undefined) => ({
      hasPrevious: cursors.length > 1,
      hasNext: next !== null && next !== undefined,
      onPrevious: () => {
        setCursors(cursors.slice(0, -1));
      },
      onNext: () => {
        if (next) setCursors([...cursors, next]);
      },
    }),
  };
}

/** Screen 23: the team, its roles, the agent accounts and keys, and the daily caps agents work under. */
export function TeamPage() {
  const toast = useToast();
  const userPages = usePages();
  const keyPages = usePages();
  const users = useTeamUsers(userPages.cursor);
  const keys = useAgentKeys(keyPages.cursor);
  const limits = useDailyLimits();
  const invite = useInvite();
  const grant = useGrantRole();
  const revoke = useRevokeRole();
  const disable = useSetDisabled();
  const createAgent = useCreateAgent();
  const createKey = useCreateAgentKey();
  const revokeKey = useRevokeAgentKey();
  const revokeAll = useRevokeAll();
  const saveLimits = useSaveDailyLimits();
  const [issued, setIssued] = useState<KeyCreated | null>(null);
  const [revoking, setRevoking] = useState<AgentKeyRow | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);

  const fail = (error: unknown) => {
    toast({ message: failure(error), tone: "danger" });
  };
  const userRows = users.data?.items ?? [];
  const agents = userRows
    .filter((row) => row.actor_kind === "agent")
    .map((row) => ({ id: row.user_id, name: row.display_name ?? row.email }));
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? "Agent";
  const userPending = grant.isPending || revoke.isPending || disable.isPending;
  const keyPending = createAgent.isPending || createKey.isPending || revokeKey.isPending;

  return (
    <>
      <h1>Team</h1>
      <section aria-labelledby="team-users">
        <h2 id="team-users">People and agents</h2>
        <UsersTable
          rows={userRows}
          loading={users.isPending}
          error={users.error === null ? null : { message: failure(users.error) }}
          pager={userPages.pager(users.data?.next_cursor)}
          actions={{
            pending: userPending,
            onGrant: (id, role) => {
              grant.mutate({ id, role }, { onError: fail });
            },
            onRevoke: (id, role) => {
              revoke.mutate({ id, role }, { onError: fail });
            },
            onDisable: (id, disabled) => {
              disable.mutate({ id, disabled }, { onError: fail });
            },
          }}
        />
      </section>
      <section aria-labelledby="team-invite">
        <h2 id="team-invite">Invite a person</h2>
        <InviteForm
          pending={invite.isPending}
          onInvite={(input) =>
            invite.mutateAsync(input).then(
              () => {
                toast({ message: "Invitation sent." });
              },
              (error: unknown) => {
                fail(error);
                throw error;
              },
            )
          }
        />
      </section>
      <section aria-labelledby="team-keys">
        <h2 id="team-keys">Agent keys</h2>
        {issued === null ? null : (
          <div className="admin-banner" role="status">
            <p>Copy this key now. It is shown once and cannot be read again.</p>
            <code>{issued.key}</code>
            <button
              type="button"
              className="admin-button admin-button--quiet"
              onClick={() => {
                setIssued(null);
              }}
            >
              Done
            </button>
          </div>
        )}
        <NewKeyForm
          agents={agents}
          pending={keyPending}
          onCreateAgent={(input) => {
            createAgent.mutate(input, { onSuccess: setIssued, onError: fail });
          }}
          onCreateKey={(id, input) => {
            createKey.mutate({ id, ...input }, { onSuccess: setIssued, onError: fail });
          }}
        />
        <AgentKeysTable
          rows={keys.data?.items ?? []}
          loading={keys.isPending}
          error={keys.error === null ? null : { message: failure(keys.error) }}
          pager={keyPages.pager(keys.data?.next_cursor)}
          agentName={agentName}
          pending={keyPending}
          onRevoke={setRevoking}
        />
        <button
          type="button"
          className="admin-button admin-button--danger"
          onClick={() => {
            setRevokeAllOpen(true);
          }}
        >
          Revoke all keys
        </button>
      </section>
      <section aria-labelledby="team-limits">
        <h2 id="team-limits">Agent daily limits</h2>
        {limits.data === undefined ? (
          <AdminPending />
        ) : (
          <DailyLimitsForm
            limits={limits.data}
            pending={saveLimits.isPending}
            onSave={(next) => {
              saveLimits.mutate(next, {
                onSuccess: () => {
                  toast({ message: "Limits saved." });
                },
                onError: fail,
              });
            }}
          />
        )}
      </section>
      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this key"
        confirmLabel="Revoke key"
        danger
        pending={revokeKey.isPending}
        onConfirm={() => {
          if (revoking === null) return;
          revokeKey.mutate(
            { id: revoking.user_id, keyId: revoking.id },
            {
              onSettled: () => {
                setRevoking(null);
              },
              onError: fail,
            },
          );
        }}
        onCancel={() => {
          setRevoking(null);
        }}
      >
        <p>{revoking?.label} stops working on its next request.</p>
      </ConfirmDialog>
      <RevokeAllDialog
        open={revokeAllOpen}
        pending={revokeAll.isPending}
        onConfirm={() => {
          revokeAll.mutate(undefined, {
            onSuccess: ({ revoked }) => {
              toast({ message: `${String(revoked)} keys revoked.` });
            },
            onError: fail,
            onSettled: () => {
              setRevokeAllOpen(false);
            },
          });
        }}
        onCancel={() => {
          setRevokeAllOpen(false);
        }}
      />
    </>
  );
}
