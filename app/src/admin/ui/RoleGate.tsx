import type { ReactNode } from "react";
import { useAdminMe } from "./admin-me";

/**
 * Hides a control the actor may not use. It is courtesy only: the server refuses the action again, which is
 * the check (tech-stack section 5, admin action path).
 */
export function RoleGate({ action, children }: { action: string; children: ReactNode }) {
  const { actions } = useAdminMe();
  return actions.includes(action) ? children : null;
}
