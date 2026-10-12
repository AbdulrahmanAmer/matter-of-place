import { Avatar } from "../workforce/Avatar";
import { useOffice } from "../workforce/workforce-queries";

const stateWords = { idle: "Ready", working: "Working", paused: "Paused", off: "Off" } as const;

/**
 * The AI team on the dashboard: each colleague's mark, name and what they are doing now, and the approvals waiting,
 * each opening the Office. Nothing is drawn until the office answers, and a failure leaves the rest of the day alone.
 */
export function TeamStrip() {
  const office = useOffice();
  const data = office.data;
  if (data === undefined) return null;
  const working = data.agents.filter((agent) => agent.state === "working").length;
  return (
    <section className="admin-dash-team" aria-labelledby="admin-dash-team">
      <div className="admin-dash-section__head">
        <h2 id="admin-dash-team" className="admin-eyebrow">
          The team
        </h2>
        <a className="admin-link" href="/admin/office">
          {working === 0 ? "Open the office" : `${String(working)} at work, open the office`}
        </a>
      </div>
      <ul className="admin-dash-team__list">
        {data.agents.map((agent) => (
          <li key={agent.id}>
            <a className="admin-dash-team__member" href="/admin/office">
              <Avatar name={agent.name} state={agent.state} size={40} />
              <span className="admin-dash-team__text">
                <span className="admin-dash-team__name">{agent.name}</span>
                <span className="admin-dash-team__task">
                  {agent.current_task ?? `${agent.role}. ${stateWords[agent.state]}.`}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {data.pending_approvals === 0 ? null : (
        <p className="admin-dash-team__approvals">
          <a href="/admin/approvals">
            {data.pending_approvals === 1
              ? "1 proposal waits for your yes"
              : `${String(data.pending_approvals)} proposals wait for your yes`}
          </a>
        </p>
      )}
    </section>
  );
}
