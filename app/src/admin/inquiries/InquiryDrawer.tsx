import { useState, type ReactNode } from "react";
import {
  inquiryIntentLabels,
  inquiryStateLabels,
  openInquiryStates,
  type Assignee,
  type InquiryDetail,
} from "../../domain/admin-inquiries";
import { AdminApiError } from "../ui/admin-fetch";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Drawer } from "../ui/Drawer";
import { JobWatcher } from "../ui/JobWatcher";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { AssignDialog } from "./AssignDialog";
import { stateTone } from "./state-tone";
import {
  useAssignInquiry,
  useCloseInquiry,
  useForwardInquiry,
  useForwardJob,
  useInquiry,
} from "./inquiries-queries";

const isOpen = (inquiry: InquiryDetail) =>
  openInquiryStates.some((state) => state === inquiry.state);

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The job a forward queued, read until it ends; B15's step ends it skipped while Omnikom has no address (S59). */
function ForwardJob({ id }: { id: string }) {
  const job = useForwardJob(id);
  const skipped =
    typeof job.data?.result === "object" &&
    job.data.result !== null &&
    "skipped" in job.data.result &&
    job.data.result.skipped === "not_configured";
  return (
    <>
      <JobWatcher jobs={[{ id, type: "webhook_omnikom", status: job.data?.status ?? "queued" }]} />
      {skipped ? <p>Not sent: Omnikom has no address yet, so the inquiry stays as it is.</p> : null}
    </>
  );
}

function InquiryActions({
  inquiry,
  assignees,
}: {
  inquiry: InquiryDetail;
  assignees: readonly Assignee[];
}) {
  const toast = useToast();
  const assign = useAssignInquiry();
  const forward = useForwardInquiry();
  const close = useCloseInquiry();
  const [asking, setAsking] = useState<"assign" | "forward" | "close" | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const open = isOpen(inquiry);
  const canForward = open && inquiry.forward_available && inquiry.anonymised_at === null;
  const failed = (error: Error) => {
    setAsking(null);
    toast({ message: error.message, tone: "danger" });
  };
  const done = (message: string) => ({
    onSuccess: () => {
      setAsking(null);
      toast({ message });
    },
    onError: failed,
  });
  const stop = () => {
    setAsking(null);
  };
  return (
    <div className="admin-actions">
      <RoleGate action="inquiries.assign">
        <button
          type="button"
          className="admin-button"
          disabled={!open}
          onClick={() => {
            setAsking("assign");
          }}
        >
          Assign
        </button>
        <AssignDialog
          key={String(asking === "assign")}
          open={asking === "assign"}
          assignees={assignees}
          current={inquiry.assigned_to}
          pending={assign.isPending}
          onCancel={stop}
          onAssign={(assignee) => {
            assign.mutate({ id: inquiry.id, assignee }, done("Inquiry assigned."));
          }}
        />
      </RoleGate>
      <RoleGate action="inquiries.forward">
        <button
          type="button"
          className="admin-button"
          disabled={!canForward}
          onClick={() => {
            setAsking("forward");
          }}
        >
          Forward to Omnikom
        </button>
        {inquiry.forward_available ? null : (
          <p className="admin-field__hint">Forwarding to Omnikom is not switched on yet.</p>
        )}
        <ConfirmDialog
          open={asking === "forward"}
          title="Forward to Omnikom"
          confirmLabel="Forward"
          pending={forward.isPending}
          onCancel={stop}
          onConfirm={() => {
            forward.mutate(
              { id: inquiry.id },
              {
                onSuccess: ({ job_id }) => {
                  setAsking(null);
                  setJobId(job_id);
                  toast({ message: "Forward queued." });
                },
                onError: failed,
              },
            );
          }}
        >
          <p>A job sends this inquiry to Omnikom. Its state changes once Omnikom confirms.</p>
        </ConfirmDialog>
        {jobId === null ? null : <ForwardJob id={jobId} />}
      </RoleGate>
      <RoleGate action="inquiries.close">
        <button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={!open}
          onClick={() => {
            setAsking("close");
          }}
        >
          Close inquiry
        </button>
        <ConfirmDialog
          open={asking === "close"}
          title="Close this inquiry"
          confirmLabel="Close inquiry"
          pending={close.isPending}
          onCancel={stop}
          onConfirm={() => {
            close.mutate({ id: inquiry.id }, done("Inquiry closed."));
          }}
        >
          <p>A closed inquiry cannot be assigned or forwarded again.</p>
        </ConfirmDialog>
      </RoleGate>
    </div>
  );
}

function InquiryBody({
  inquiry,
  assignees,
  assigneeName,
}: {
  inquiry: InquiryDetail;
  assignees: readonly Assignee[];
  assigneeName: (id: string) => string;
}) {
  const anonymised = inquiry.anonymised_at !== null;
  return (
    <>
      <p>
        <StatusPill label={inquiryStateLabels[inquiry.state]} tone={stateTone[inquiry.state]} />
        {anonymised ? <StatusPill label="Anonymised" /> : null}
      </p>
      <dl className="admin-job__facts">
        <Fact term="Property">{inquiry.subject_title ?? inquiry.subject_slug ?? "None"}</Fact>
        <Fact term="Received">
          <LocalTime value={inquiry.received_at} />
        </Fact>
        <Fact term="Assigned">
          {inquiry.assigned_to === null ? "No one" : assigneeName(inquiry.assigned_to)}
        </Fact>
        <Fact term="Source page">{inquiry.source_path}</Fact>
        {anonymised ? null : (
          <>
            <Fact term="Name">{inquiry.name}</Fact>
            <Fact term="Email">{inquiry.email}</Fact>
            <Fact term="Phone">{inquiry.phone ?? "None"}</Fact>
            <Fact term="Location">{inquiry.location ?? "None"}</Fact>
          </>
        )}
      </dl>
      <InquiryActions inquiry={inquiry} assignees={assignees} />
      {anonymised ? null : (
        <>
          <h3>Message</h3>
          <p>{inquiry.message}</p>
          <h3>Details</h3>
          <pre className="admin-job__json">{JSON.stringify(inquiry.details, null, 2)}</pre>
        </>
      )}
    </>
  );
}

/** The open inquiry of screen 11, read on its own so a link from a mail opens it whatever page the list shows. */
export function InquiryDrawer({
  id,
  assignees,
  onClose,
}: {
  id: string;
  assignees: readonly Assignee[];
  onClose: () => void;
}) {
  const inquiry = useInquiry(id);
  const failure = inquiry.error;
  const names = new Map(assignees.map((assignee) => [assignee.id, assignee.name]));
  return (
    <Drawer
      open
      onClose={onClose}
      title={inquiry.data === undefined ? "Inquiry" : inquiryIntentLabels[inquiry.data.intent]}
    >
      {failure === null ? null : (
        <p role="alert">
          {failure.message}
          {failure instanceof AdminApiError && failure.requestId !== undefined
            ? ` Request ${failure.requestId}.`
            : null}
        </p>
      )}
      {inquiry.data === undefined ? (
        failure === null ? (
          <div className="admin-skeleton" />
        ) : null
      ) : (
        <InquiryBody
          inquiry={inquiry.data}
          assignees={assignees}
          assigneeName={(person) => names.get(person) ?? "A former editor"}
        />
      )}
    </Drawer>
  );
}
