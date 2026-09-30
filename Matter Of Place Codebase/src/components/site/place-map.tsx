/** Approximate-location panel used while exact placement is withheld. */
export function PlaceMap({ label, note }: { label: string; note: string }) {
  return (
    <div className="place-map" role="img" aria-label={label}>
      <span className="place-map-pin" />
      <span className="place-map-note">{note}</span>
    </div>
  );
}
