import type { Conditions } from "../../domain/automation";

/** The gate on the line into a step: which tiers, markets and kinds it applies to, or nothing when it always runs. */
export function gateOf(conditions: Conditions): string | null {
  const parts = [
    ...(conditions.tiers ?? []),
    ...(conditions.markets ?? []).map((market) =>
      market === "new-york" ? "New York" : market.charAt(0).toUpperCase() + market.slice(1),
    ),
    ...(conditions.kinds ?? []),
  ];
  return parts.length === 0 ? null : `Only ${parts.join(", ")}`;
}
