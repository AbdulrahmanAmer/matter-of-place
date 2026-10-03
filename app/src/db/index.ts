import type { Database } from "./types.ts";

export type { Database, Json } from "./types.ts";

type PublicSchema = Database["public"];

/** The row a `select` returns from a `public` table. */
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];

/** The row an `insert` takes into a `public` table. */
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

/** The values of a `public` enum. */
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
