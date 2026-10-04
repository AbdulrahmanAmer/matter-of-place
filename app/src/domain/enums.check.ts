// Drift guard (G-004): each pair states that a domain list and the generated database enum hold the same values. A
// migration that adds, drops or renames an enum value, or a domain list edited alone, makes `tsc` fail on the line of
// the pair that no longer matches. Compile time only; nothing imports this file.
import type { Enums } from "../db/index.ts";
import type {
  acceptedStates,
  appRoles,
  editorialStates,
  exposurePackages,
  InquiryIntent,
  propertyTypes,
  SubmissionState,
  submitterKinds,
} from "./contracts.ts";
import type { assetKinds, assetStatuses } from "./assets.ts";
import type { GalleryImage, Property } from "./property.ts";
import type { Story } from "./story.ts";
import type { propertyEditorialTransitions, WorkflowState } from "./workflow.ts";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type EnumPairs = [
  Expect<Equal<SubmissionState, Enums<"submission_state">>>,
  Expect<Equal<WorkflowState, Enums<"submission_state">>>,
  Expect<Equal<(typeof appRoles)[number], Enums<"app_role">>>,
  Expect<Equal<(typeof editorialStates)[number], Enums<"editorial_state">>>,
  Expect<Equal<keyof typeof propertyEditorialTransitions, Enums<"editorial_state">>>,
  Expect<Equal<(typeof submitterKinds)[number], Enums<"submitter_kind">>>,
  Expect<Equal<(typeof acceptedStates)[number], Enums<"accepted_state">>>,
  Expect<Equal<(typeof propertyTypes)[number], Enums<"property_type">>>,
  Expect<Equal<Property["type"], Enums<"property_type">>>,
  Expect<Equal<(typeof exposurePackages)[number], Enums<"exposure_package">>>,
  Expect<Equal<InquiryIntent, Enums<"inquiry_intent">>>,
  Expect<Equal<Property["status"], Enums<"listing_status">>>,
  Expect<Equal<NonNullable<Property["campaignTier"]>, Enums<"campaign_tier">>>,
  Expect<Equal<NonNullable<Property["source"]>, Enums<"submission_source">>>,
  Expect<Equal<Story["category"], Enums<"story_category">>>,
  Expect<Equal<GalleryImage["orientation"], Enums<"media_orientation">>>,
  Expect<Equal<(typeof assetKinds)[number] | "variants", Enums<"asset_kind">>>,
  Expect<Equal<(typeof assetStatuses)[number], Enums<"asset_status">>>,
];
