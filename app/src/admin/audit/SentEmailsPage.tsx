import { useUrlFilters } from "../ui/use-url-filters";
import { InboundMailPart } from "./InboundMailPart";
import { RepliesPart } from "./RepliesPart";
import { SentEmailsPart } from "./SentEmailsPart";

// W9 item 2 and W7 item 1 (operator, 2026-10-15: "we need to be able to see from the admin dashboard if an email is
// wrong or bounced"): every email we sent, to whom and what became of it, and the addresses nothing more goes to.
// W7 item 2: the replies people wrote back, beside the emails they answer.

const filterNames = ["status", "search", "reply"] as const;

export function SentEmailsPage() {
  const filters = useUrlFilters(filterNames);
  // The reply filter belongs to the Replies part: it is not part of what the emails are asked for.
  const { status, search: address } = filters.values;
  return (
    <>
      <h1>Sent emails</h1>
      <p className="admin-lead">
        Replies people wrote back come first; every email we sent follows, newest first, with what
        became of it. An address that bounced or complained is on the do-not-send list below.
      </p>
      <RepliesPart
        state={filters.values.reply}
        onState={(next) => {
          filters.setFilters({ ...filters.values, reply: next });
        }}
        cursor={filters.cursor}
        pager={{
          hasPrevious: filters.hasPrevious,
          onPrevious: filters.goPrevious,
          onNext: filters.goNext,
        }}
      />
      <InboundMailPart />
      <SentEmailsPart
        key={`${status ?? ""}~${address ?? ""}`}
        status={status}
        address={address}
        onFilters={(next) => {
          filters.setFilters({ ...filters.values, ...next });
        }}
      />
    </>
  );
}
