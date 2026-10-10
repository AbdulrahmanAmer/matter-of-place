import {
  comingSoonAnswerSchema,
  marketDetailSchema,
  marketListSchema,
  marketSavedSchema,
  type MarketUpdateInput,
} from "../../domain/admin-markets";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 15. Components reach these through `markets-queries.ts`.

const marketPath = (slug: string) => `/api/admin/markets/${slug}`;

const send = (method: "POST" | "PATCH", body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchMarkets() {
  return adminFetch("/api/admin/markets", marketListSchema);
}

export function fetchMarket(slug: string) {
  return adminFetch(marketPath(slug), marketDetailSchema);
}

export function patchMarket(slug: string, body: Omit<MarketUpdateInput, "slug">) {
  return adminFetch(marketPath(slug), marketSavedSchema, send("PATCH", body));
}

export function postComingSoon(slug: string, comingSoon: boolean) {
  return adminFetch(
    `${marketPath(slug)}/coming-soon`,
    comingSoonAnswerSchema,
    send("POST", { coming_soon: comingSoon }),
  );
}
