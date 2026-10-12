import type { AgentState } from "../../domain/workforce";

/**
 * An employee's mark: the initials set in Cormorant inside a hairline ring. While the employee works, an arc turns
 * around the ring; paused and off fade the mark. Drawn as SVG, so it stays sharp at every size.
 */
export function Avatar({
  name,
  state,
  size = 56,
}: {
  name: string;
  state: AgentState;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word) && word !== "of")
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return (
    <svg
      className={`wf-avatar wf-avatar--${state}`}
      width={size}
      height={size}
      viewBox="0 0 56 56"
      aria-hidden="true"
    >
      <circle className="wf-avatar__ring" cx="28" cy="28" r="26.5" />
      {state === "working" ? (
        <circle className="wf-avatar__arc" cx="28" cy="28" r="26.5" pathLength="100" />
      ) : null}
      <text className="wf-avatar__initials" x="28" y="34.5" textAnchor="middle">
        {initials}
      </text>
    </svg>
  );
}
