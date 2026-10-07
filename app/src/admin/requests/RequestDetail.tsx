import { notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";
import { useAdminMe } from "../ui/admin-me";
import { AdminPending } from "../ui/AdminPending";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";
import { Timeline } from "../ui/Timeline";
import { useToast } from "../ui/use-toast";
import { DecisionPanel } from "./DecisionPanel";
import { NotesPanel } from "./NotesPanel";
import { PhotoStrip } from "./PhotoStrip";
import { historyEntry } from "./request-history";
import {
  useAddNote,
  useOriginal,
  useStartReview,
  useSubmission,
  useSubmissionTimeline,
} from "./requests-queries";
import { marketSlugOf, stateTone } from "./state-tone";
import { SubmittedFields } from "./SubmittedFields";

const DAY_MS = 86_400_000;

const messageOf = (error: Error) => error.message;

/** Screen 4: one request as submitted, on the left, with the people, photographs and links; its status, notes and history beside it. */
export function RequestDetail({ id }: { id: string }) {
  const { actions } = useAdminMe();
  const toast = useToast();
  const [now] = useState(() => Date.now());
  const request = useSubmission(id);
  const history = useSubmissionTimeline(id);
  const start = useStartReview();
  const note = useAddNote(id);
  const original = useOriginal(id);
  const [opening, setOpening] = useState<string | null>(null);

  const detail = request.data;
  if (detail === undefined) {
    if (request.error === null) return <AdminPending />;
    if (request.error instanceof AdminApiError && request.error.status === 404) throw notFound();
    throw request.error;
  }
  const market = marketSlugOf[detail.state];
  const days = Math.max(0, Math.floor((now - Date.parse(detail.received_at)) / DAY_MS));

  const openOriginal = (mediaId: string) => {
    setOpening(mediaId);
    original.mutate(mediaId, {
      onSuccess: ({ url }) => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      onError: (error) => {
        toast({ message: messageOf(error), tone: "danger" });
      },
      onSettled: () => {
        setOpening(null);
      },
    });
  };

  const addNote = (text: string) =>
    new Promise<boolean>((resolve) => {
      note.mutate(text, {
        onSuccess: () => {
          resolve(true);
        },
        onError: () => {
          resolve(false);
        },
      });
    });

  return (
    <>
      <header className="admin-page-head">
        <div>
          <p className="admin-request__crumb">
            <a href="/admin/requests">Requests</a>
          </p>
          <h1>{detail.address}</h1>
          <p className="admin-request__sub">
            {detail.city}, {detail.state}
          </p>
        </div>
        <p className="admin-request__state">
          <StatusPill label={detail.workflow_state} tone={stateTone[detail.workflow_state]} />
          {detail.duplicate_of === null ? null : (
            <a href={`/admin/requests/${detail.duplicate_of}`}>
              <StatusPill label="Possible duplicate" tone="warning" />
            </a>
          )}
          <span>
            Received <LocalTime value={detail.received_at} marketSlug={market} style="date" />,{" "}
            {days} {days === 1 ? "day" : "days"} ago
          </span>
        </p>
      </header>
      <div className="admin-request">
        <div className="admin-request__main">
          <PhotoStrip photos={detail.media} opening={opening} onOpen={openOriginal} />
          <SubmittedFields detail={detail} />
        </div>
        <aside className="admin-request__side">
          <DecisionPanel
            detail={detail}
            actions={actions}
            pending={start.isPending}
            onStartReview={() => {
              start.mutate([id], {
                onSuccess: () => {
                  toast({ message: "Review started." });
                },
                onError: (error) => {
                  toast({ message: messageOf(error), tone: "danger" });
                },
              });
            }}
          />
          <NotesPanel
            notes={detail.notes}
            marketSlug={market}
            canNote={actions.includes("submissions.note")}
            pending={note.isPending}
            error={note.error instanceof AdminApiError ? note.error.message : null}
            onAdd={addNote}
          />
          <section className="admin-history" aria-label="History">
            <h2>History</h2>
            {history.data === undefined ? (
              <p className="admin-history__none">
                {history.error === null ? "Loading the history." : history.error.message}
              </p>
            ) : history.data.items.length === 0 ? (
              <p className="admin-history__none">Nothing has happened to this request yet.</p>
            ) : (
              <Timeline entries={history.data.items.map(historyEntry)} marketSlug={market} />
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
