import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// The browser-safe path to the newer static cards: the Start compiler swaps the handler for a call to the Worker in
// the client build. The server modules load inside the handler, as `archive.functions.ts` does.

const cardSchema = z.object({ media_key: z.string() });

/** `{ <key>: <absolute https URL> }` for the cards in `settings.og_static`; an entry that does not resolve to one is left out. */
export const getOgStaticFn = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getDb }, { getPublicState }, { mediaUrl }] = await Promise.all([
    import("../server/lib/db"),
    import("../server/public/state"),
    import("../server/lib/media-store"),
  ]);
  const { ogStatic } = await getPublicState(getDb());
  const cards: Record<string, string> = {};
  for (const [key, row] of Object.entries(ogStatic)) {
    const card = cardSchema.safeParse(row);
    if (!card.success) continue;
    const url = mediaUrl(card.data.media_key, { absolute: true });
    if (url.startsWith("https://")) cards[key] = url;
  }
  return cards;
});
