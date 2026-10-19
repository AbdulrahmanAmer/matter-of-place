import type { AccountReport } from "../../domain/account";
import { calendarDay, count, percent } from "./account-format";

/**
 * Reports (W6 item 8): for each property, the campaign's weekly figures, the page views and how many people wrote to
 * us. Counts only: who wrote to us never reaches this page.
 */
export function AccountReports({ properties }: { properties: readonly AccountReport[] }) {
  if (properties.length === 0) {
    return (
      <>
        <h2>Reports</h2>
        <p>Nothing here yet. Results for a property appear here once it is on the site.</p>
      </>
    );
  }
  return (
    <>
      <h2>Reports</h2>
      <p>We show how many people looked at a property and how many wrote to us, never who.</p>
      <ul className="account-list">
        {properties.map((property) => (
          <li key={property.id}>
            <h3>
              {property.title}, {property.city}
            </h3>
            {property.live_path === null ? null : (
              <p>
                <a href={property.live_path}>See the live page</a>
              </p>
            )}
            <dl className="account-figures">
              <div>
                <dt>Page views</dt>
                <dd>{count(property.page_views)}</dd>
              </div>
              <div>
                <dt>Inquiries</dt>
                <dd>{count(property.inquiries)}</dd>
              </div>
              <div>
                <dt>Inquiries, last 30 days</dt>
                <dd>{count(property.inquiries_30d)}</dd>
              </div>
            </dl>
            {property.weeks.length === 0 ? (
              <p>Weekly figures appear here once a campaign has run.</p>
            ) : (
              <>
                <table className="account-table">
                  <caption>Weekly figures for {property.title}, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Week</th>
                      <th scope="col">Impressions</th>
                      <th scope="col">Reach</th>
                      <th scope="col">Visits from social links</th>
                      <th scope="col">Video views</th>
                      <th scope="col">Click-through rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.weeks.map((week) => (
                      <tr key={week.period_start}>
                        <td>
                          {calendarDay(week.period_start)} to {calendarDay(week.period_end)}
                        </td>
                        <td>{count(week.impressions)}</td>
                        <td>{count(week.reach)}</td>
                        <td>{count(week.clicks)}</td>
                        <td>{count(week.video_views)}</td>
                        <td>{percent(week.ctr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Visits are counted on matterofplace.com from the links we posted. The platforms
                  report the other figures.
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
