import { z } from "zod";
import type { Json } from "../db/index.ts";

/** Any JSON value, typed as the database's own `Json` (Meta's answers, Matter's admin call bodies). */
export const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
