import { useState } from "react";
import type { PropertyRecord } from "../../domain/admin-properties";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { numberOrNull } from "./editor-values";

const listOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/**
 * Screen 8, Placement: the hero and featured ranks (a rank another property holds moves to it, so each stays unique),
 * the related properties in order, and the tier, which only an activated request sets.
 */
export function PlacementTab({
  property,
  related,
  onSaveRanks,
  onSaveRelated,
}: {
  property: Pick<PropertyRecord, "hero_rank" | "featured_rank" | "campaign_tier">;
  related: readonly string[];
  onSaveRanks: (ranks: { hero_rank: number | null; featured_rank: number | null }) => void;
  onSaveRelated: (related: string[]) => void;
}) {
  const [hero, setHero] = useState(property.hero_rank === null ? "" : String(property.hero_rank));
  const [featured, setFeatured] = useState(
    property.featured_rank === null ? "" : String(property.featured_rank),
  );
  const [relatedText, setRelatedText] = useState(related.join("\n"));
  const rank = (label: string, value: string, set: (next: string) => void) => (
    <Field label={label} hint="1 is first; empty takes the property out.">
      {(control) => (
        <input
          {...control}
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            set(event.target.value);
          }}
        />
      )}
    </Field>
  );
  return (
    <div className="admin-editor__fields">
      <p>Tier: {property.campaign_tier}</p>
      <RoleGate action="properties.rank">
        {rank("Hero rank", hero, setHero)}
        {rank("Featured rank", featured, setFeatured)}
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => {
            onSaveRanks({ hero_rank: numberOrNull(hero), featured_rank: numberOrNull(featured) });
          }}
        >
          Save ranks
        </button>
      </RoleGate>
      <Field label="Related properties" hint="Slugs, one a line, in order.">
        {(control) => (
          <textarea
            {...control}
            rows={4}
            value={relatedText}
            onChange={(event) => {
              setRelatedText(event.target.value);
            }}
          />
        )}
      </Field>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        onClick={() => {
          onSaveRelated(listOf(relatedText));
        }}
      >
        Save related
      </button>
    </div>
  );
}
