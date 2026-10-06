import { formatInZone, marketTimezone, type TimeStyle } from "../../domain/market-time";

/** A stored UTC instant in its market's zone, with the zone named (GD-06): `PT` for California, `ET` elsewhere. */
export function LocalTime({
  value,
  marketSlug,
  style = "datetime",
}: {
  value: string;
  marketSlug?: string | null | undefined;
  style?: TimeStyle;
}) {
  return <time dateTime={value}>{formatInZone(value, marketTimezone(marketSlug), style)}</time>;
}
