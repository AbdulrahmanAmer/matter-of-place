/** Geometric wordmark with the inverted-V "A". Horizontal by default, stacked on request. */
export function Wordmark({ stacked = false }: { stacked?: boolean }) {
  if (stacked) {
    return (
      <span className="brand-stacked">
        <span>MΛTTER</span>
        <small>OF</small>
        <span>PLΛCE</span>
      </span>
    );
  }
  return (
    <span className="brand-horizontal">
      MΛTTER <small>OF</small> PLΛCE
    </span>
  );
}
