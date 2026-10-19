import { Link } from "@tanstack/react-router";
import type { AccountCreditEntry } from "../../domain/account";
import { plainDay } from "./account-format";

const credits = (count: number): string => `${String(count)} ${count === 1 ? "credit" : "credits"}`;

/** A line of the ledger in words: a pack bought, or a credit used for one of the client's requests. */
function entryLine(entry: AccountCreditEntry): string {
  if (entry.kind === "purchased") return `Five Features paid, ${credits(entry.quantity)} added`;
  const place = entry.address === null ? "a property" : `${entry.address}, ${entry.city ?? ""}`;
  return `Used for ${place}`;
}

/**
 * Credits (W6 item 8): the Five Features balance and the lines behind it. "Submit my next property" opens the form with
 * Five Features chosen while a credit remains; the credit is used when we accept the property, not before.
 */
export function AccountCredits({
  balance,
  purchased,
  entries,
}: {
  balance: number;
  purchased: number;
  entries: readonly AccountCreditEntry[];
}) {
  if (purchased === 0) {
    return (
      <>
        <h2>Credits</h2>
        <p>
          You hold no Five Features credits. Five Features pays for five properties in advance; it
          is described on the <Link to="/exposure">exposure page</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h2>Credits</h2>
      <p className="account-balance">
        {balance === 0 ? "No credits left." : `${credits(balance)} left.`}
      </p>
      <p>
        A credit is used when we accept a property you submit with it. A property we decline uses
        none.
      </p>
      {balance > 0 ? (
        <p>
          <Link to="/submit" search={{ package: "five-features" }} className="button">
            Submit my next property
          </Link>
        </p>
      ) : null}
      <ul className="account-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <p>
              {entryLine(entry)}. {plainDay(entry.created_at)}.
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
