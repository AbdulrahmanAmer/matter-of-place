import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// W8 item 10 (H116): proposed posts, under the `channels` scope that Matter's key already holds. A person who runs
// posting proposes and revises; deciding is the chief editor's and the administrator's, as for a colleague's other
// proposals (`workforce.decide`), so Matter's key (role `admin`) may reject and ask for a re-render in the operator's
// place and a colleague's key, holding neither role, may not. Approval is a person's only: the service and
// `approve_proposed_post` refuse every agent key with `manual_approval`, so the 60 days of human approval hold.
const operators = ["media_ops", "chief_editor", "admin"] as const;
const deciders = ["chief_editor", "admin"] as const;

export const proposedPosts = [
  { action: "channels.proposed_list", group: "channels", roles: appRoles },
  { action: "channels.proposed_get", group: "channels", roles: appRoles },
  { action: "channels.proposed_create", group: "channels", roles: operators },
  { action: "channels.proposed_revise", group: "channels", roles: operators },
  { action: "channels.proposed_approve", group: "channels", roles: deciders },
  { action: "channels.proposed_reject", group: "channels", roles: deciders },
  { action: "channels.proposed_rerender", group: "channels", roles: deciders },
] as const satisfies readonly PermissionEntry[];
