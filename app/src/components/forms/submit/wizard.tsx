import { useCallback, useState } from "react";
import { useAsyncAction } from "../../../hooks/use-async-action";
import { track } from "../../../lib/analytics";
import { cx } from "../../../lib/cx";
import { padIndex } from "../../../lib/format";
import { t } from "../../../lib/strings";
import { services } from "../../../services";
import { DeliveryNotice, FormError, SentNotice } from "../form-notice";
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
import { ExposureStep, PropertyStep, RepresentationStep, ReviewStep, StoryStep } from "./steps";

/** Five-step property submission. Validation lives in `state.ts`; delivery in the submission service. */
export function SubmitWizard() {
  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<SubmitDraft>(initialDraft);

  const update = useCallback(
    <K extends keyof SubmitDraft>(key: K, value: SubmitDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    [],
  );

  const { state, run, reset, pending } = useAsyncAction((current: SubmitDraft) =>
    services.submissions.send(toSubmission(current, window.location.pathname), current.files),
  );

  const startAgain = () => {
    reset();
    setDraft(initialDraft);
    setStep(0);
  };

  const send = () => {
    void run(draft).then((receipt) => {
      if (receipt) track("submit_property", { state: draft.state, package: draft.package });
    });
  };

  if (state.status === "success") {
    return (
      <SentNotice title="Received. Editorial review comes next." text={sentText()}>
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
      {step === 2 && <RepresentationStep draft={draft} update={update} />}
      {step === 3 && <ExposureStep draft={draft} update={update} />}
      {step === 4 && <ReviewStep draft={draft} />}

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
