import type { ConciergeQuestion } from "../../domain/contracts";
import { answerFor } from "../../lib/concierge-rules";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { answeredAt } from "../public/post-read";
import { readCatalog } from "../public/state";

/** `POST /concierge`: one of the four questions about a property, answered from the memoised catalog (no query). */
export async function answer(db: Db, input: ConciergeQuestion): Promise<Response> {
  const { catalog, state } = await readCatalog(db);
  const property = catalog.properties.find((item) => item.slug === input.propertySlug);
  if (property === undefined) {
    throw new AppError("not_found", undefined, "There is nothing at this address.");
  }
  return answeredAt(answerFor(property, input.question, catalog.cards), state.catalogVersion);
}
