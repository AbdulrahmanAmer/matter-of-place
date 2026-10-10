import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  archiveRedirect,
  fetchRedirects,
  fetchSettings,
  putComingSoon,
  putInvoice,
  putNotifications,
  putRedirect,
  putSite,
} from "./settings-api";

export function useSettings() {
  return useQuery({ queryKey: adminKeys.settings.all(), queryFn: fetchSettings });
}

/** A write of screen 24: the settings and the dashboard are read again once it settles. */
function useSettingsWrite<Input, Answer>(write: (input: Input) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.settings.all()),
  });
}

export const useSaveSite = () => useSettingsWrite(putSite);
export const useSaveInvoice = () => useSettingsWrite(putInvoice);
export const useSaveComingSoon = () => useSettingsWrite(putComingSoon);
export const useSaveNotifications = () => useSettingsWrite(putNotifications);

/** One page of the redirects of screen 24, under the settings key so every settings write reads it again. */
export function useRedirects(cursor: string | null) {
  return useQuery({
    queryKey: adminKeys.settings.list({ redirects: cursor }),
    queryFn: () => fetchRedirects(cursor),
  });
}

export const useSaveRedirect = () => useSettingsWrite(putRedirect);
export const useArchiveRedirect = () => useSettingsWrite(archiveRedirect);
