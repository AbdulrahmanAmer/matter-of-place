/** The threshold emblem: two planes meeting at a doorway. Inherits `currentColor`. */
export function Emblem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 68 76" fill="none" aria-hidden="true">
      <path d="M8 5 34 16 20 21v43L8 70V5Z" fill="currentColor" opacity=".9" />
      <path d="M8 5h52v65l-12-6V21L8 5Z" fill="currentColor" opacity=".4" />
    </svg>
  );
}
