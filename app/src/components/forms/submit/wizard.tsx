import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { issuesOf, useAsyncAction } from "../../../hooks/use-async-action";
import { track } from "../../../lib/analytics";
import { cx } from "../../../lib/cx";
import { withHoneypot } from "../../../lib/form-data";
import { padIndex } from "../../../lib/format";
import { t } from "../../../lib/strings";
import { services, type UploadProgress } from "../../../services";
import { DeliveryNotice, FormError, SentNotice } from "../form-notice";
import { Honeypot } from "../honeypot";
import { fieldIssues, fieldOf, firstIssueStep, problemsOf, type FieldIssue } from "./issues";
import { sentText } from "../../../lib/form-copy";
import {
  canContinue,
  initialDraft,
  lastStep,
  nextStep,
  previousStep,
  steps,
  toSubmission,
  type StepIndex,
  type SubmitDraft,
} from "./state";
import { AboutYouStep, ExposureStep, PropertyStep, ReviewStep, StoryStep } from "./steps";

/** Where the photographs of a received submission stand, with a retry for the ones that failed (FE-04). */
function UploadStatus({ progress }: { progress: UploadProgress }) {
  const { done, total, failed, retry } = progress;
  if (done + failed < total) return <p>{t.forms.uploading(done, total)}</p>;
  if (failed === 0) return <p>{t.forms.uploadDone}</p>;
  return (
    <>
      <p>{t.forms.uploadFailed(failed)}</p>
      <button type="button" className="button ghost" onClick={() => void retry()}>
        {t.forms.uploadRetry}
      </button>
    </>
  );
}

/**
 * The line beneath the actions after a failed send. "Check the highlighted details" is said only while a field is
 * highlighted: once the last one is corrected the line goes, and a refusal that named no field says so plainly.
 */
function formMessage(
  state: { message: string; invalid: boolean },
  placed: boolean,
  issues: readonly FieldIssue[],
): string | null {
  if (!state.invalid) return state.message;
  if (!placed) return t.forms.invalidUnplaced;
  return issues.length > 0 ? state.message : null;
}

/** Five-step property submission. Validation lives in `state.ts`; delivery in the submission service. */
export function SubmitWizard() {
  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<SubmitDraft>(initialDraft);

  // The fields the API or the contract refused. Typing in one clears its mark, so what is left is still to fix.
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  // Whether the last refusal named a field the wizard shows; if not, the message cannot point at one.
  const [placed, setPlaced] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);

  const update = useCallback(<K extends keyof SubmitDraft>(key: K, value: SubmitDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    const field = fieldOf(key);
    setIssues((current) =>
      current.some((issue) => issue.field === field)
        ? current.filter((issue) => issue.field !== field)
        : current,
    );
  }, []);

  // A refused send goes back to the first step with a refused field (the Review step lists them all).
  const refused = useCallback((error: unknown) => {
    const found = fieldIssues(issuesOf(error));
    setIssues(found);
    setPlaced(found.length > 0);
    const first = firstIssueStep(found);
    if (first !== undefined) {
      setStep(first);
      setRefusals((count) => count + 1);
    }
  }, []);

  const trap = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  // Photographs of an earlier submission keep uploading after "Start again"; only the latest one reports here.
  const sending = useRef(0);
  const { state, run, reset, pending } = useAsyncAction((current: SubmitDraft) => {
    const mine = (sending.current += 1);
    return services.submissions.send(
      withHoneypot(toSubmission(current, window.location.pathname), trap.current?.value ?? ""),
      current.files,
      (next) => {
        if (sending.current === mine) setProgress(next);
      },
    );
  }, refused);

  // The visitor lands on the step with the first refused field and finds the cursor in it.
  useEffect(() => {
    if (refusals > 0) root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusals]);

  const problems = useMemo(() => problemsOf(issues, prefix), [issues, prefix]);

  const startAgain = () => {
    reset();
    sending.current += 1;
    setProgress(null);
    setDraft(initialDraft);
    setIssues([]);
    setStep(0);
  };

  const send = () => {
    setIssues([]);
    void run(draft).then((receipt) => {
      if (receipt) track("submit_property", { state: draft.state, package: draft.package });
    });
  };

  // Received: the submission exists, so this state never posts again; only its photographs can be sent again.
  if (state.status === "success") {
    return (
      <SentNotice title="Received. Editorial review comes next." text={sentText()}>
        {progress !== null && <UploadStatus progress={progress} />}
        <button type="button" className="button" onClick={startAgain}>
          Start again
        </button>
      </SentNotice>
    );
  }

  return (
    <div className="wizard" aria-busy={pending} ref={root}>
      <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li key={label} className={cx(index === step && "on", index < step && "past")}>
            {padIndex(index + 1)} {label}
          </li>
        ))}
      </ol>

      {step === 0 && <PropertyStep draft={draft} update={update} problems={problems} />}
      {step === 1 && <StoryStep draft={draft} update={update} problems={problems} />}
      {step === 2 && <AboutYouStep draft={draft} update={update} problems={problems} />}
      {step === 3 && <ExposureStep draft={draft} update={update} problems={problems} />}
      {step === 4 && <ReviewStep draft={draft} issues={issues} />}
      <Honeypot ref={trap} />

      <div className="form-actions">
        {step > 0 && (
          <button
            type="button"
            className="button ghost"
            onClick={() => setStep(previousStep(step))}
          >
            {t.common.back}
          </button>
        )}
        {step < lastStep ? (
          <button
            type="button"
            className="button"
            disabled={!canContinue(step, draft)}
            onClick={() => setStep(nextStep(step))}
          >
            {t.common.continue}
          </button>
        ) : (
          <button type="button" className="button" disabled={pending} onClick={send}>
            {pending ? t.common.sending : "Send for review"}
          </button>
        )}
      </div>
      <FormError message={state.status === "error" ? formMessage(state, placed, issues) : null} />
      {step === lastStep && <DeliveryNotice />}
    </div>
  );
}
