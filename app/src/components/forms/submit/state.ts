import {
  acceptedStates,
  propertyTypes,
  submissionSchema,
  type exposurePackages,
  type Submission,
} from "../../../domain/contracts";

type AcceptedState = (typeof acceptedStates)[number];
type PropertyTypeOption = (typeof propertyTypes)[number];
type ExposurePackage = (typeof exposurePackages)[number];

/** Value of the state select when the property is outside the three markets. */
export const otherState = "Another state";

/** Everything the wizard collects, as the visitor types it. */
export type SubmitDraft = {
  address: string;
  city: string;
  state: AcceptedState | typeof otherState | "";
  zip: string;
  listingUrl: string;
  sourceUrl: string;
  price: string;
  propertyType: PropertyTypeOption | "";
  beds: string;
  baths: string;
  interiorSqFt: string;
  architect: string;
  designer: string;
  yearBuilt: string;
  yearRenovated: string;
  brokerage: string;
  agentName: string;
  agentEmail: string;
  agentPhone: string;
  photographyUrl: string;
  videoUrl: string;
  story: string;
  significance: string;
  package: ExposurePackage | undefined;
  mediaBudget: string;
  rightsConfirmed: boolean;
  files: File[];
};

export const steps = ["Property", "The story", "Representation", "Exposure", "Review"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4;

export const lastStep: StepIndex = 4;
const stepOrder: readonly StepIndex[] = [0, 1, 2, 3, 4];

export const previousStep = (step: StepIndex): StepIndex => stepOrder[step - 1] ?? 0;
export const nextStep = (step: StepIndex): StepIndex => stepOrder[step + 1] ?? lastStep;

export const maxFiles = 20;

export const initialDraft: SubmitDraft = {
  address: "",
  city: "",
  state: "",
  zip: "",
  listingUrl: "",
  sourceUrl: "",
  price: "",
  propertyType: "",
  beds: "",
  baths: "",
  interiorSqFt: "",
  architect: "",
  designer: "",
  yearBuilt: "",
  yearRenovated: "",
  brokerage: "",
  agentName: "",
  agentEmail: "",
  agentPhone: "",
  photographyUrl: "",
  videoUrl: "",
  story: "",
  significance: "",
  package: undefined,
  mediaBudget: "",
  rightsConfirmed: false,
  files: [],
};

const stateOptions: readonly SubmitDraft["state"][] = ["", ...acceptedStates, otherState];
const typeOptions: readonly SubmitDraft["propertyType"][] = ["", ...propertyTypes];

/** The select value as a draft state; anything unknown reads as "not chosen". */
export const toStateOption = (value: string): SubmitDraft["state"] =>
  stateOptions.find((option) => option === value) ?? "";

/** The select value as a draft property type; anything unknown reads as "not chosen". */
export const toTypeOption = (value: string): SubmitDraft["propertyType"] =>
  typeOptions.find((option) => option === value) ?? "";

const filled = (value: string) => value.trim().length > 0;

export const isOutsideMarkets = (draft: SubmitDraft) => draft.state === otherState;

/** Whether the visitor may leave the given step. */
export function canContinue(step: StepIndex, draft: SubmitDraft): boolean {
  switch (step) {
    case 0:
      return (
        filled(draft.address) &&
        filled(draft.city) &&
        draft.state !== "" &&
        !isOutsideMarkets(draft) &&
        /^\d{5}$/.test(draft.zip.trim()) &&
        draft.propertyType !== ""
      );
    case 1:
      return filled(draft.story) && filled(draft.significance);
    case 2:
      return filled(draft.brokerage) && filled(draft.agentName) && filled(draft.agentEmail);
    case 3:
      return draft.package !== undefined && draft.rightsConfirmed;
    case 4:
      return true;
  }
}

const optionalNumber = (value: string) => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Validates the draft against the shared contract; throws a ZodError when invalid. */
export function toSubmission(draft: SubmitDraft, sourcePath: string): Submission {
  return submissionSchema.parse({
    address: draft.address,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
    listingUrl: draft.listingUrl,
    sourceUrl: draft.sourceUrl,
    price: optionalNumber(draft.price),
    currency: "USD",
    propertyType: draft.propertyType,
    beds: optionalNumber(draft.beds),
    baths: optionalNumber(draft.baths),
    interiorSqFt: optionalNumber(draft.interiorSqFt),
    architect: draft.architect,
    designer: draft.designer,
    yearBuilt: optionalNumber(draft.yearBuilt),
    yearRenovated: optionalNumber(draft.yearRenovated),
    brokerage: draft.brokerage,
    agentName: draft.agentName,
    agentEmail: draft.agentEmail,
    agentPhone: draft.agentPhone,
    photographyUrl: draft.photographyUrl,
    videoUrl: draft.videoUrl,
    story: draft.story,
    significance: draft.significance,
    package: draft.package,
    mediaBudget: optionalNumber(draft.mediaBudget),
    rightsConfirmed: draft.rightsConfirmed,
    media: draft.files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
    sourcePath,
  });
}
