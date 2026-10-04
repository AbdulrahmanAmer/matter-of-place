import { readVar } from "../../lib/runtime-env.ts";
import type { StepDefinition } from "../types.ts";
import { selftestSteps } from "./selftest.ts";

// The step catalog: each slice that implements a step type appends one import and one entry here.
const catalog: readonly StepDefinition[] = [];

// Fails closed: only an explicit development or preview runner knows the self-test steps.
function selftestEnabled(): boolean {
  const env = readVar("MOP_ENV");
  return env === "development" || env === "preview";
}

export function getStep(type: string): StepDefinition | undefined {
  const steps = selftestEnabled() ? [...catalog, ...selftestSteps] : catalog;
  return steps.find((step) => step.type === type);
}
