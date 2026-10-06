import { z } from "zod";

// Invariant 17c: every admin list is one keyset page of at most 50 rows. Each list schema in the `admin-*.ts`
// domain files extends this one.

export const ADMIN_PAGE_MAX = 50;

export const adminPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(ADMIN_PAGE_MAX),
  /** The `next_cursor` of the page before; absent on the first page. */
  cursor: z.string().min(1).max(200).optional(),
});

/** One page of a list: the rows and the cursor of the page after it, null on the last page. */
export function adminPageAnswer<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({ items: z.array(row), next_cursor: z.string().nullable() });
}
