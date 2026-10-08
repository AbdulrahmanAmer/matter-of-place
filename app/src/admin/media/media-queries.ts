import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UploadType } from "../../domain/admin-media";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  attachMedia,
  deleteMedia,
  fetchMedia,
  fetchVariantsStatus,
  reorderMedia,
  replaceMedia,
  retryJob,
  setMediaAlt,
  stageFile,
} from "./media-api";

// Screen 9 and the Sequence tab: the photographs of one property and every write on them.

/** While a render is on its way the states are read again every 10 seconds. */
const STATUS_POLL_MS = 10_000;

export interface PickedFile {
  file: File;
  mime: UploadType;
}

export function useMedia(propertyId: string) {
  return useQuery({
    queryKey: adminKeys.media.list(propertyId),
    queryFn: () => fetchMedia(propertyId),
  });
}

export function useVariantsStatus(propertyId: string) {
  return useQuery({
    queryKey: adminKeys.media.detail(propertyId),
    queryFn: () => fetchVariantsStatus(propertyId),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.state === "processing") === true
        ? STATUS_POLL_MS
        : false,
  });
}

/** A write on a property's photographs: the media, the dashboard and the property's dossier are read again. */
function useMediaWrite<Input, Answer>(
  propertyId: string,
  write: (input: Input) => Promise<Answer>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.media.all(),
        adminKeys.properties.detail(propertyId),
      ),
  });
}

/** Stages each file and attaches it, one after the other, so the order picked is the order kept. */
export function useUploadPhotos(propertyId: string) {
  return useMediaWrite(propertyId, async (files: readonly PickedFile[]) => {
    for (const { file, mime } of files) {
      const staged = await stageFile({ scope: "property", target: propertyId }, file, mime);
      await attachMedia({
        property_id: propertyId,
        media_id: staged.media_id ?? "",
        staging_path: staged.path,
      });
    }
  });
}

export function useReplacePhoto(propertyId: string) {
  return useMediaWrite(propertyId, async ({ id, file, mime }: PickedFile & { id: string }) => {
    const staged = await stageFile(
      { scope: "property", target: propertyId, mediaId: id },
      file,
      mime,
    );
    return replaceMedia(id, staged.path);
  });
}

export function useReorderMedia(propertyId: string) {
  return useMediaWrite(propertyId, (order: string[]) =>
    reorderMedia({ property_id: propertyId, order }),
  );
}

export function useSetAlt(propertyId: string) {
  return useMediaWrite(propertyId, ({ id, alt }: { id: string; alt: string }) =>
    setMediaAlt(id, alt),
  );
}

export function useDeleteMedia(propertyId: string) {
  return useMediaWrite(propertyId, (id: string) => deleteMedia(id));
}

export function useRetryRender(propertyId: string) {
  return useMediaWrite(propertyId, (jobId: string) => retryJob(jobId));
}
