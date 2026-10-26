import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// W8 item 10 (H116, H135): proposed posts, under the `channels` scope that Matter's key already holds. A person who runs
// posting proposes and revises; approving, rejecting and asking for a re-render are the roles that approve a visual
// (`assets.approve`), because approving a post approves its visuals. Among keys only Matter's acts here, as in
// `assets.ts` (item 9): the one agent account granted `admin` (scripts/matter/key.ts), so the audit's `agent:matter` is
// always Matter and a colleague's key is refused whatever its roles. Approval is a person's only (`humanOnly`, and
// `approve_proposed_post` refuses an agent with `manual_approval`), so the 60 days of human approval hold.
const operators = ["media_ops", "chief_editor", "admin"] as const;
const deciders = ["media_ops", "chief_editor"] as const;
const owner = ["admin"] as const;

export const proposedPosts = [
  { action: "channels.proposed_list", group: "channels", roles: appRoles },
  { action: "channels.proposed_get", group: "channels", roles: appRoles },
  { action: "channels.proposed_create", group: "channels", roles: operators, agentRoles: owner },
  { action: "channels.proposed_revise", group: "channels", roles: operators, agentRoles: owner },
  { action: "channels.proposed_approve", group: "channels", roles: deciders, humanOnly: true },
  { action: "channels.proposed_reject", group: "channels", roles: deciders, agentRoles: owner },
  { action: "channels.proposed_rerender", group: "channels", roles: deciders, agentRoles: owner },
] as const satisfies readonly PermissionEntry[];
