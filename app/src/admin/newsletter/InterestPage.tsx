import { formatInZone, marketTimezone } from "../../domain/market-time";
import { marketName, sourceName } from "./interest-names";
import { useInterest } from "./newsletter-queries";

// The Interest screen (operator, 2026-10-15: "my partner put something in and added his email and got a confirmation
// email for his interest ... but that is not traceable from the admin dashboard"). Who asked to hear about which
// market, from which page, and whether they confirmed. One audited read, the same right as the subscriber CSV.

const STATUS = {
  confirmed: "Confirmed",
  pending: "Waiting for confirmation",
  unsubscribed: "Unsubscribed",
};

export function InterestPage() {
  const interest = useInterest();
  const view = interest.data;
  return (
    <>
      <h1>Interest</h1>
      <p className="admin-lead">
        People who asked to hear when a home is listed: their markets, the page they signed up on,
        and whether they confirmed by email.
      </p>
      {interest.error !== null ? (
        <p role="alert">{interest.error.message}</p>
      ) : view === undefined ? (
        <div className="admin-skeleton" />
      ) : view.signups.length === 0 ? (
        <p className="admin-lead">No one has signed up yet.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption>By market</caption>
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col" className="admin-cell--end">
                    Confirmed
                  </th>
                  <th scope="col" className="admin-cell--end">
                    Waiting for confirmation
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.markets.map((row) => (
                  <tr key={row.market}>
                    <th scope="row">{marketName(row.market)}</th>
                    <td className="admin-cell--end">{row.confirmed}</td>
                    <td className="admin-cell--end">{row.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption>
                Every signup, newest first ({view.signups.length}).{" "}
                <a href="/api/admin/newsletter/subscribers/export">Download as a spreadsheet</a>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Confirmed</th>
                  <th scope="col">Email</th>
                  <th scope="col">Markets</th>
                  <th scope="col">Signed up on</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {view.signups.map((row) => (
                  <tr key={row.email}>
                    <td>
                      {row.confirmed_at === null ? (
                        "Not yet"
                      ) : (
                        <time dateTime={row.confirmed_at}>
                          {formatInZone(
                            row.confirmed_at,
                            marketTimezone(row.markets[0]),
                            "dayTime",
                          )}
                        </time>
                      )}
                    </td>
                    <td>{row.email}</td>
                    <td>
                      {row.markets.length === 0
                        ? "Place Notes only"
                        : row.markets.map(marketName).join(", ")}
                    </td>
                    <td>{sourceName(row.source)}</td>
                    <td>{STATUS[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
