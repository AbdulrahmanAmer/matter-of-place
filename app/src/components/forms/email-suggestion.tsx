import { suggestAddress } from "../../lib/email-check";
import { fill, t } from "../../lib/strings";

/** W9 item 1: under an email field, "Did you mean ann@gmail.com?" while the address has a common typo of its domain. */
export function EmailSuggestion({
  value,
  onUse,
}: {
  value: string;
  onUse: (address: string) => void;
}) {
  const suggestion = suggestAddress(value);
  if (suggestion === null) return null;
  return (
    <span className="email-suggestion" role="status">
      {t.forms.emailTypo}{" "}
      <button
        type="button"
        className="email-suggestion-use"
        aria-label={fill(t.forms.emailTypoUse, { address: suggestion })}
        onClick={() => {
          onUse(suggestion);
        }}
      >
        {suggestion}
      </button>
      ?
    </span>
  );
}
