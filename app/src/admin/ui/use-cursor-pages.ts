import { useState } from "react";

/**
 * The keyset pages of a list that lives inside a screen, such as a section or a tab, whose address belongs to the
 * screen (`use-url-filters.ts` is for a list that owns the address). Previous walks back through the cursors this
 * list was reached through.
 */
export function useCursorPages() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [trail, setTrail] = useState<(string | null)[]>([]);
  return {
    /** The cursor of the page shown, null on the first page. */
    cursor,
    /** The pager `DataTable` draws, given the `next_cursor` of the page shown. */
    pager: (nextCursor: string | null) => ({
      hasPrevious: trail.length > 0,
      hasNext: nextCursor !== null,
      onPrevious: () => {
        setCursor(trail.at(-1) ?? null);
        setTrail(trail.slice(0, -1));
      },
      onNext: () => {
        if (nextCursor === null) return;
        setTrail([...trail, cursor]);
        setCursor(nextCursor);
      },
    }),
  };
}
