import { useState } from "react";
import {
  approvalModes,
  approvalModeLabels,
  channelLabels,
  channelSteps,
} from "../../domain/automation";
import { tiers } from "../../domain/events";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useSaveChannel, type ChannelRow } from "./automation-queries";
import { draftOf, patchOf, sameDraft, weekdays, zoneOptions, type Draft } from "./channel-draft";
import { RequestFailure } from "./RequestFailure";

/** What screen 20 says of a channel's sign-in; never the name or value of a secret (G-006). */
export type Credentials = "Connected" | "Expired" | "Not connected" | "Checking";

const credentialTone: Record<Credentials, Tone> = {
  Connected: "ok",
  Expired: "danger",
  "Not connected": "neutral",
  Checking: "neutral",
};

/** Facebook and YouTube are blocks until the flag is on, and a channel no catalog step posts to (YouTube) stays one (S48). */
function blocked(channel: ChannelRow["channel"], newChannels: boolean): boolean {
  const gated = channel === "facebook" || channel === "youtube";
  return (gated && !newChannels) || channelSteps[channel] === null;
}

/**
 * One channel on screen 20: the switch, the posting window in its own zone, the daily cap and who approves each tier.
 * `credentials` is null for a channel that signs in nowhere (Place Notes). The parent keys this component by the
 * stored row, so a refetch after a save starts a fresh draft.
 */
export function ChannelSettingsForm({
  row,
  newChannels,
  credentials,
}: {
  row: ChannelRow;
  newChannels: boolean;
  credentials: Credentials | null;
}) {
  const toast = useToast();
  const save = useSaveChannel();
  const { actions } = useAdminMe();
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [shown, setShown] = useState<ReturnType<typeof patchOf> | null>(null);
  const errors = shown !== null && !shown.ok ? shown.errors : {};
  const dirty = !sameDraft(draft, draftOf(row));
  const canEdit = actions.includes("automation.channels_put");
  const label = channelLabels[row.channel];
  const notEnabledYet = blocked(row.channel, newChannels);

  const submit = () => {
    const checked = patchOf(draft);
    setShown(checked);
    if (!checked.ok) return;
    save.mutate(
      { channel: row.channel, patch: checked.patch },
      {
        onSuccess: () => {
          toast({ message: `${label} saved.` });
        },
      },
    );
  };

  return (
    <article className="admin-channel" aria-label={label}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="admin-channel__fields" disabled={!canEdit || save.isPending}>
          <legend className="admin-template__key">{label}</legend>
          <div className="admin-channel__switch">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={notEnabledYet}
                onChange={(event) => {
                  setDraft({ ...draft, enabled: event.target.checked });
                }}
              />
              {label} on
            </label>
            {notEnabledYet ? <span className="admin-field__hint">Not enabled yet.</span> : null}
            {credentials === null ? null : (
              <span className="admin-channel__credentials">
                Sign-in <StatusPill label={credentials} tone={credentialTone[credentials]} />
              </span>
            )}
          </div>
          <div className="admin-channel__window">
            <Field
              label="Time zone"
              hint="Hours are wall time in this zone and keep their local time across daylight saving."
            >
              {(control) => (
                <select
                  {...control}
                  value={draft.tz}
                  onChange={(event) => {
                    setDraft({ ...draft, tz: event.target.value });
                  }}
                >
                  {zoneOptions(row.posting_window.tz).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="From" {...(errors.from === undefined ? {} : { error: errors.from })}>
              {(control) => (
                <input
                  {...control}
                  type="time"
                  value={draft.from}
                  onChange={(event) => {
                    setDraft({ ...draft, from: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label="To" {...(errors.to === undefined ? {} : { error: errors.to })}>
              {(control) => (
                <input
                  {...control}
                  type="time"
                  value={draft.to}
                  onChange={(event) => {
                    setDraft({ ...draft, to: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field
              label="Daily cap"
              hint="Posts a day, 1 to 25."
              {...(errors.dailyCap === undefined ? {} : { error: errors.dailyCap })}
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={1}
                  max={25}
                  value={draft.dailyCap}
                  onChange={(event) => {
                    setDraft({ ...draft, dailyCap: event.target.value });
                  }}
                />
              )}
            </Field>
          </div>
          <div className="admin-channel__days" role="group" aria-label={`${label} posting days`}>
            {weekdays.map(({ day, label: name }) => (
              <label key={day} className="admin-check">
                <input
                  type="checkbox"
                  checked={draft.days.includes(day)}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      days: event.target.checked
                        ? [...draft.days, day]
                        : draft.days.filter((other) => other !== day),
                    });
                  }}
                />
                {name}
              </label>
            ))}
          </div>
          {errors.days === undefined ? null : (
            <p className="admin-field__error" role="alert">
              {errors.days}
            </p>
          )}
          <div className="admin-channel__approval">
            {tiers.map((tier) => (
              <Field key={tier} label={`${tier} approval`}>
                {(control) => (
                  <select
                    {...control}
                    value={draft.approval[tier]}
                    onChange={(event) => {
                      const next = approvalModes.find((mode) => mode === event.target.value);
                      if (next === undefined) return;
                      setDraft({
                        ...draft,
                        approval: { ...draft.approval, [tier]: next },
                      });
                    }}
                  >
                    {approvalModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {approvalModeLabels[mode]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ))}
            <Field
              label="Automatic from"
              hint="A tier set to automatic posts without a person only from this date. Empty means never."
              {...(errors.autoAfter === undefined ? {} : { error: errors.autoAfter })}
            >
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={draft.autoAfter}
                  onChange={(event) => {
                    setDraft({ ...draft, autoAfter: event.target.value });
                  }}
                />
              )}
            </Field>
          </div>
        </fieldset>
        <RoleGate action="automation.channels_put">
          <div className="admin-actions">
            {dirty ? <span className="admin-field__hint">Unsaved changes</span> : null}
            <button
              type="button"
              className="admin-button admin-button--quiet"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(draftOf(row));
                setShown(null);
              }}
            >
              Discard changes
            </button>
            <button type="submit" className="admin-button" disabled={!dirty || save.isPending}>
              Save {label}
            </button>
          </div>
        </RoleGate>
        {save.isError ? <RequestFailure error={save.error} className="admin-field__error" /> : null}
      </form>
    </article>
  );
}
