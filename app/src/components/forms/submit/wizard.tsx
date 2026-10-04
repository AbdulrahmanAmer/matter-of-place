import { useCallback, useRef, useState } from "react";
import { useAsyncAction } from "../../../hooks/use-async-action";
import { track } from "../../../lib/analytics";
import { cx } from "../../../lib/cx";
import { withHoneypot } from "../../../lib/form-data";
import { padIndex } from "../../../lib/format";
import { t } from "../../../lib/strings";
import { services, type UploadProgress } from "../../../services";
import { DeliveryNotice, FormError, SentNotice } from "../form-notice";
import { Honeypot } from "../honeypot";
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

/** Five-step property submission. Validation lives in `state.ts`; delivery in the submission service. */
export function SubmitWizard() {
  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<SubmitDraft>(initialDraft);

  const update = useCallback(
    <K extends keyof SubmitDraft>(key: K, value: SubmitDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    [],
  );

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
  });

  const startAgain = () => {
    reset();
    sending.current += 1;
    setProgress(null);
    setDraft(initialDraft);
    setStep(0);
  };

  const send = () => {
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
    <div className="wizard" aria-busy={pending}>
      <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li key={label} className={cx(index === step && "on", index < step && "past")}>
            {padIndex(index + 1)} {label}
          </li>
        ))}
      </ol>

      {step === 0 && <PropertyStep draft={draft} update={update} />}
      {step === 1 && <StoryStep draft={draft} update={update} />}
      {step === 2 && <AboutYouStep draft={draft} update={update} />}
      {step === 3 && <ExposureStep draft={draft} update={update} />}
      {step === 4 && <ReviewStep draft={draft} />}
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
      <FormError message={state.status === "error" ? state.message : null} />
      {step === lastStep && <DeliveryNotice />}
    </div>
  );
}
