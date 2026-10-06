export type Tone = "neutral" | "ok" | "warning" | "danger" | "info";

/** A state as a word first and a muted tone second, so colour never carries the meaning alone. */
export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span className="admin-pill" data-tone={tone}>
      {label}
    </span>
  );
}
