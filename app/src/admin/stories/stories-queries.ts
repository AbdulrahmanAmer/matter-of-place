import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UploadType } from "../../domain/admin-media";
import type { StoryPatch } from "../../domain/admin-stories";
import { stageFile } from "../media/media-api";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  createStory,
  fetchStories,
  fetchStory,
  patchStory,
  publishStory,
  unpublishStory,
} from "./stories-api";

/** The filter of screen 14 that lives in the address, beside the cursor. */
export const storyFilterNames = ["editorial_state"] as const;

export function useStories(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.stories.list(query),
    queryFn: () => fetchStories(query),
  });
}

export function useStory(id: string) {
  return useQuery({
    queryKey: adminKeys.stories.detail(id),
    queryFn: () => fetchStory(id),
  });
}

/** A write of stories: the feature and the dashboard are read again once it settles. */
function useStoryWrite<Input, Answer>(write: (input: Input) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.stories.all()),
  });
}

export const useCreateStory = () => useStoryWrite(createStory);

export const useSaveStory = () =>
  useStoryWrite(
    ({
      id,
      ...body
    }: {
      id: string;
      expected_updated_at: string;
      patch: StoryPatch;
      image_staging_path?: string;
    }) => patchStory(id, body),
  );

export const usePublishStory = () =>
  useStoryWrite(({ id, expected_updated_at }: { id: string; expected_updated_at: string }) =>
    publishStory(id, expected_updated_at),
  );

export const useUnpublishStory = () => useStoryWrite((id: string) => unpublishStory(id));

/** The image of a story goes to the staging folder of its slug; nothing is stored in the row until the render ran. */
export const stageStoryImage = (slug: string, file: File, mime: UploadType) =>
  stageFile({ scope: "story", target: slug }, file, mime);
