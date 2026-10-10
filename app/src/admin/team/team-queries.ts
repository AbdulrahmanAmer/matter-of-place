import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentCreateInput,
  AgentScope,
  DailyLimits,
  InviteInput,
} from "../../domain/admin-team";
import type { AppRole } from "../../domain/rows";
import { useAsyncAction } from "../../hooks/use-async-action";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  deleteAgentKey,
  deleteRole,
  fetchAgentKeys,
  fetchDailyLimits,
  fetchTeamUsers,
  postAgent,
  postAgentKey,
  postDisabled,
  postInvite,
  postRevokeAll,
  postRole,
  putDailyLimits,
  requestSignInLink,
} from "./team-api";

/** The sign-in form's request for a link: its pending, success and error states (components do not call `-api` modules). */
export function useSendSignInLink() {
  return useAsyncAction(requestSignInLink);
}

export function useTeamUsers(cursor: string | null) {
  return useQuery({
    queryKey: adminKeys.team.list({ users: cursor }),
    queryFn: () => fetchTeamUsers(cursor),
  });
}

export function useAgentKeys(cursor: string | null) {
  return useQuery({
    queryKey: adminKeys.team.list({ keys: cursor }),
    queryFn: () => fetchAgentKeys(cursor),
  });
}

export function useDailyLimits() {
  return useQuery({ queryKey: adminKeys.team.detail("limits"), queryFn: fetchDailyLimits });
}

/** A write of the team screen: the feature and the dashboard are read again once it settles. */
function useTeamWrite<Input, Answer>(write: (input: Input) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.team.all()),
  });
}

export const useInvite = () => useTeamWrite((input: InviteInput) => postInvite(input));

export const useGrantRole = () =>
  useTeamWrite(({ id, role }: { id: string; role: AppRole }) => postRole(id, role));

export const useRevokeRole = () =>
  useTeamWrite(({ id, role }: { id: string; role: AppRole }) => deleteRole(id, role));

export const useSetDisabled = () =>
  useTeamWrite(({ id, disabled }: { id: string; disabled: boolean }) => postDisabled(id, disabled));

export const useCreateAgent = () => useTeamWrite((input: AgentCreateInput) => postAgent(input));

export const useCreateAgentKey = () =>
  useTeamWrite(({ id, label, scopes }: { id: string; label: string; scopes: AgentScope[] }) =>
    postAgentKey(id, label, scopes),
  );

export const useRevokeAgentKey = () =>
  useTeamWrite(({ id, keyId }: { id: string; keyId: string }) => deleteAgentKey(id, keyId));

export const useRevokeAll = () => useTeamWrite(() => postRevokeAll());

export const useSaveDailyLimits = () =>
  useTeamWrite((limits: DailyLimits) => putDailyLimits(limits));
