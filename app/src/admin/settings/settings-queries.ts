import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  archiveRedirect,
  fetchRedirects,
  fetchSettings,
  previewProducts,
  putComingSoon,
  putInvoice,
  putNotifications,
  putProducts,
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
export const useSaveProducts = () => useSettingsWrite(putProducts);

/** The dry run of the plans writes nothing, so nothing is read again after it. */
export const usePreviewProducts = () => useMutation({ mutationFn: previewProducts });

/**
 * The redirects of screen 24: a page of the rows, a page of old property addresses and the answer for the link typed,
 * under the settings key so every settings write reads them again. The last answer stays on screen while the next loads.
 */
export function useRedirects(request: {
  cursor: string | null;
  oldCursor: string | null;
  path: string | null;
}) {
  return useQuery({
    queryKey: adminKeys.settings.list({ redirects: request }),
    queryFn: () => fetchRedirects(request),
    placeholderData: keepPreviousData,
  });
}

export const useSaveRedirect = () => useSettingsWrite(putRedirect);
export const useArchiveRedirect = () => useSettingsWrite(archiveRedirect);
