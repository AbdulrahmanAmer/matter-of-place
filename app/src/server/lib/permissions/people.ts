import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// ASSUMED: the people who may note a person are those who may note a request (`submissions.note`).
const noters = ["chief_editor", "managing_editor", "visual_editor", "media_ops"] as const;

// Screens 26 and 27 (invariant 23, S55).
export const people = [
  { action: "people.list", group: "people", roles: appRoles },
  { action: "people.get", group: "people", roles: appRoles },
  { action: "people.note", group: "people", roles: noters },
] as const satisfies readonly PermissionEntry[];
