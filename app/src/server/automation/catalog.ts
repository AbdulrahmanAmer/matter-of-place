import type { Channel } from "../../domain/automation.ts";
import { getStep } from "../jobs/steps/index.ts";
import { stepSpecs, stepTypes, type StepSpec, type StepType } from "./step-specs.ts";

/** What the planner asks to know whether a step type has a module: B8's `getStep`, or a stub in a test. */
export type StepRegistry = (type: string) => unknown;

export function listStepSpecs(): StepSpec[] {
  return stepTypes.map((type) => stepSpecs[type]);
}

export function getSpec(type: string): StepSpec | undefined {
  return listStepSpecs().find((spec) => spec.type === type);
}

/** A step is implemented when the registry returns a module for it; the planner skips the others. */
export function isImplemented(type: string, registry: StepRegistry = getStep): boolean {
  return registry(type) !== undefined;
}

const channelSteps: Record<Channel, StepType | null> = {
  instagram: "post_meta",
  facebook: "post_meta",
  x: "post_x",
  linkedin: "post_linkedin",
  newsletter: "queue_digest",
  // No catalog step posts to YouTube.
  youtube: null,
};

export function stepForChannel(channel: Channel): StepType | null {
  return channelSteps[channel];
}
