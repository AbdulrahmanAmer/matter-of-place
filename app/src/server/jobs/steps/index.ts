import { readVar } from "../../lib/runtime-env.ts";
import type { StepDefinition } from "../types.ts";
import { renderCarousel } from "./render-carousel.ts";
import { renderCover } from "./render-cover.ts";
import { renderOgStatic } from "./render-og-static.ts";
import { renderStory } from "./render-story.ts";
import { renderVariants } from "./render-variants.ts";
import { selftestSteps } from "./selftest.ts";

// The step catalog: each slice that implements a step type appends one import and one entry here.
const catalog: readonly StepDefinition[] = [
  renderVariants,
  renderCover,
  renderCarousel,
  renderStory,
  renderOgStatic,
];

// Fails closed: only an explicit development or preview runner knows the self-test steps.
function selftestEnabled(): boolean {
  const env = readVar("MOP_ENV");
  return env === "development" || env === "preview";
}

export function getStep(type: string): StepDefinition | undefined {
  const steps = selftestEnabled() ? [...catalog, ...selftestSteps] : catalog;
  return steps.find((step) => step.type === type);
}
