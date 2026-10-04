import { useState, type SyntheticEvent } from "react";
import { honeypotFieldName, subscriberSchema } from "../../domain/contracts";
import type { Market, MarketSlug } from "../../domain/market";
import { useAsyncAction } from "../../hooks/use-async-action";
import { track } from "../../lib/analytics";
import { interestSource, type ComingSoonScope } from "../../lib/coming-soon";
import { formText, withHoneypot } from "../../lib/form-data";
import { fill, t } from "../../lib/strings";
import { services } from "../../services";
import { FormError } from "./form-notice";
import { Honeypot } from "./honeypot";

const choices: { slug: MarketSlug; name: string }[] = [
  { slug: "california", name: t.nav.california },
  { slug: "new-york", name: t.nav.newYork },
  { slug: "florida", name: t.nav.florida },
];

/**
 * An interest signup (G15): the address and the markets it wants to hear about. A market (or region) page
 * preselects its market; every other scope shows the three as a chooser. It is separate consent from Place Notes.
 */
export function InterestForm({
  scope,
  market,
  region,
}: {
  scope: ComingSoonScope;
  market?: Pick<Market, "slug"> | undefined;
  region?: Pick<Market["regions"][number], "slug"> | undefined;
}) {
  const source = interestSource(scope, market, region);
  const [chosen, setChosen] = useState<MarketSlug[]>([]);
  const markets = market === undefined ? chosen : [market.slug];
  const { state, run, pending } = useAsyncAction(
    (input: { email: string; trap: string; markets: MarketSlug[] }) =>
      services.newsletter.subscribe(
        withHoneypot(
          subscriberSchema.parse({ email: input.email, source, markets: input.markets }),
          input.trap,
        ),
      ),
  );

  const toggle = (slug: MarketSlug) => {
    setChosen((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run({
      email: formText(data, "email"),
      trap: formText(data, honeypotFieldName),
      markets,
    }).then((receipt) => {
      if (receipt) track("interest_signup", { markets });
    });
  };

  if (state.status === "success") {
    const only =
      markets.length === 1 ? choices.find((choice) => choice.slug === markets[0]) : undefined;
    return (
      <p className="interest-sent" role="status">
        {only === undefined
          ? t.comingSoon.form.sentAny
          : fill(t.comingSoon.form.sentMarket, { market: only.name })}
      </p>
    );
  }

  return (
    <form className="interest-form" onSubmit={onSubmit} aria-busy={pending}>
      <input
        className="interest-email"
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder={t.common.emailAddress}
        aria-label={t.common.emailAddress}
      />
      {market === undefined && (
        <fieldset className="interest-chooser">
          <legend>{t.comingSoon.form.legend}</legend>
          {choices.map((choice) => (
            <label className="check" key={choice.slug}>
              <input
                type="checkbox"
                name="markets"
                value={choice.slug}
                checked={chosen.includes(choice.slug)}
                onChange={() => {
                  toggle(choice.slug);
                }}
              />
              {choice.name}
            </label>
          ))}
        </fieldset>
      )}
      <Honeypot />
      <button className="interest-submit" type="submit" disabled={pending || markets.length === 0}>
        {pending ? t.common.sending : t.comingSoon.form.submit}
      </button>
      <p className="form-note">{t.comingSoon.form.note}</p>
      <FormError message={state.status === "error" ? state.message : null} />
    </form>
  );
}
