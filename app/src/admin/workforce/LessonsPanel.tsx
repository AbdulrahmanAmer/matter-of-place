import type { TeamLesson } from "../../domain/admin-team-memory";
import { cappedNote, momentOf } from "./memory-format";
import { useLessons } from "./workforce-queries";

// W7 item 4: the lessons each colleague was taught, and the ones taught to the whole team. Read only; text only.

const sourceLabel: Record<TeamLesson["source"], string> = {
  decline: "A declined proposal",
  edit: "An edited proposal",
  outcome: "An outcome",
  matter: "Matter",
  build: "His own build",
};

const statusLabel: Record<TeamLesson["status"], string> = {
  active: "Active",
  retired: "Retired",
  promoted: "Promoted to instructions",
};

export function LessonsPanel() {
  const lessons = useLessons();
  const items = lessons.data?.items ?? [];
  const note = cappedNote(items.length, lessons.data?.total ?? 0, "lessons");

  return (
    <section className="wf-mem" aria-labelledby="wf-lessons-title">
      <h2 id="wf-lessons-title">Lessons</h2>
      <p className="wf-mem__lead">
        What the team was taught: when it applies, what to do, and how often it has been used.
      </p>
      {lessons.isError ? (
        <p className="wf-empty">The lessons could not be read. Try again in a moment.</p>
      ) : lessons.isLoading ? (
        <p className="wf-empty">Opening the lessons.</p>
      ) : items.length === 0 ? (
        <p className="wf-empty">
          No lesson yet. A declined or edited proposal teaches the colleague who wrote it.
        </p>
      ) : (
        <div className="wf-mem__scroll">
          {note === null ? null : <p className="wf-mem__lead">{note}</p>}
          <table>
            <thead>
              <tr>
                <th scope="col">Whose</th>
                <th scope="col">When</th>
                <th scope="col">Then</th>
                <th scope="col">Source</th>
                <th scope="col">Status</th>
                <th scope="col">Uses</th>
                <th scope="col">Last used</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.agent_name ?? "The whole team"}</td>
                  <td className="wf-mem__wide">{item.trigger}</td>
                  <td className="wf-mem__wide">{item.action}</td>
                  <td>{sourceLabel[item.source]}</td>
                  <td>{statusLabel[item.status]}</td>
                  <td>{item.uses}</td>
                  <td>{momentOf(item.last_used_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
