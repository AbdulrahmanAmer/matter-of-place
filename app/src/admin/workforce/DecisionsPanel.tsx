import { useState } from "react";
import { decisionStatuses, type DecisionStatus } from "../../domain/admin-team-memory";
import { cappedNote, dayOf } from "./memory-format";
import { useDecisions } from "./workforce-queries";

// W7 item 4: the daily meeting's decisions, read only. Every text here was written by a colleague and is shown as text.

const statusLabel: Record<DecisionStatus, string> = {
  open: "Open",
  done: "Done",
  missed: "Missed",
};

export function DecisionsPanel() {
  const [filter, setFilter] = useState<DecisionStatus | "all">("all");
  // The server filters and counts: each status is capped on its own and `counts` are the true totals.
  const decisions = useDecisions(filter === "all" ? undefined : filter);
  const shown = decisions.data?.items ?? [];
  const counts = decisions.data?.counts ?? { open: 0, done: 0, missed: 0 };
  const total = counts.open + counts.done + counts.missed;
  const inFilter = filter === "all" ? total : counts[filter];
  const note = cappedNote(
    shown.length,
    inFilter,
    filter === "all" ? "decisions" : `${statusLabel[filter].toLowerCase()} decisions`,
  );

  return (
    <section className="wf-mem" aria-labelledby="wf-decisions-title">
      <h2 id="wf-decisions-title">Decisions</h2>
      <p className="wf-mem__lead">
        What the daily meeting settled, who owns it and how it will be checked.
      </p>
      <div className="wf-mem__filters" role="group" aria-label="Show decisions">
        <button
          type="button"
          aria-pressed={filter === "all"}
          onClick={() => {
            setFilter("all");
          }}
        >
          {`All (${String(total)})`}
        </button>
        {decisionStatuses.map((status) => (
          <button
            type="button"
            key={status}
            aria-pressed={filter === status}
            onClick={() => {
              setFilter(status);
            }}
          >
            {`${statusLabel[status]} (${String(counts[status])})`}
          </button>
        ))}
      </div>
      {decisions.isError ? (
        <p className="wf-empty">The decisions could not be read. Try again in a moment.</p>
      ) : decisions.isLoading ? (
        <p className="wf-empty">Opening the decisions.</p>
      ) : total === 0 ? (
        <p className="wf-empty">
          No decision yet. The daily meeting writes its decisions here once it has met.
        </p>
      ) : shown.length === 0 ? (
        <p className="wf-empty">{`No ${filter === "all" ? "" : `${statusLabel[filter].toLowerCase()} `}decision.`}</p>
      ) : (
        <div className="wf-mem__scroll">
          {note === null ? null : <p className="wf-mem__lead">{note}</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">Decision</th>
                <th scope="col">Owner</th>
                <th scope="col">Due</th>
                <th scope="col">Metric</th>
                <th scope="col">Status</th>
                <th scope="col">Meeting</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => (
                <tr key={item.id}>
                  <td className="wf-mem__wide">{item.decision}</td>
                  <td>{item.owner_name}</td>
                  <td>{dayOf(item.due_on)}</td>
                  <td className="wf-mem__wide">{item.metric}</td>
                  <td>
                    <span className={`wf-mem__status wf-mem__status--${item.status}`}>
                      {statusLabel[item.status]}
                    </span>
                  </td>
                  <td>{dayOf(item.meeting_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
