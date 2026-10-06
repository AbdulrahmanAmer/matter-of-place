import { createContext, useContext } from "react";
import type { z } from "zod";
import type { meSchema } from "../../domain/admin-team";

/** The body of `GET /api/admin/me`: who is signed in and which actions they may perform. */
export type AdminMe = z.infer<typeof meSchema>;

export const AdminMeContext = createContext<AdminMe | null>(null);

/** The signed-in actor, for any component inside `AdminShell`. */
export function useAdminMe(): AdminMe {
  const me = useContext(AdminMeContext);
  if (me === null) throw new Error("useAdminMe was called outside AdminShell");
  return me;
}
