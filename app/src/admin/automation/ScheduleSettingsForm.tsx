import { useState } from "react";
import { scheduleSettingsPutSchema } from "../../domain/automation";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useSaveSchedule, type SchedulePatch, type ScheduleRow } from "./automation-queries";
import { RequestFailure } from "./RequestFailure";
import {
  cadenceOf,
  clock,
  cronOf,
  sayCadence,
  scheduleName,
  scheduleNames,
  toOffice,
  weekdays,
  type Cadence,
} from "./schedule-words";

// Keep-warm, the audit routine and backup.yml run on clocks outside the database: `automation_put_schedule` refuses a
// changed cron for these three with `external_clock`, so the screen says when they run and offers no change.
const externalClocks: readonly string[] = ["keepwarm", "audit", "backup"];

type Often = "minutes" | "daily" | "weekly" | "other";

interface Draft {
  enabled: boolean;
  often: Often;
  every: string;
  day: number;
  time: string;
  cron: string;
  intervalDays: string;
}

function draftOf(row: ScheduleRow): Draft {
  const local: Cadence = toOffice(cadenceOf(row.cron));
  return {
    enabled: row.enabled,
    often: local.kind,
    every: local.kind === "minutes" ? String(local.every) : "15",
    day: local.kind === "weekly" ? local.day : 6,
    time:
      local.kind === "daily" || local.kind === "weekly" ? clock(local.hour, local.minute) : "09:00",
    cron: row.cron,
    intervalDays: row.interval_days === null ? "" : String(row.interval_days),
  };
}

/** The cron the draft asks for, or a message for the field that is wrong. */
function cronFrom(draft: Draft): { cron: string } | { error: string } {
  if (draft.often === "other") return { cron: draft.cron.trim() };
  if (draft.often === "minutes") {
    const every = Number(draft.every);
    if (!Number.isInteger(every) || every < 1 || every > 59)
      return { error: "Use a whole number of minutes from 1 to 59" };
    return { cron: cronOf({ kind: "minutes", every }) ?? "" };
  }
  const match = /^(\d{2}):(\d{2})$/.exec(draft.time);
  const hour = Number(match?.[1] ?? "x");
  const minute = Number(match?.[2] ?? "x");
  if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59)
    return { error: "Choose a time" };
  const cadence: Cadence =
    draft.often === "daily"
      ? { kind: "daily", hour, minute }
      : { kind: "weekly", day: draft.day, hour, minute };
  return { cron: cronOf(cadence) ?? "" };
}

/**
 * One clock on Channels and schedules (W3): its name and what it does, when it runs in words and Cairo time, the next
 * and last run, and a change made by choosing how often, the day and the time. The database keeps the UTC cron; a
 * cron of another shape is kept and edited as it is. The parent keys this component by the stored row, so a refetch
 * after a save starts a fresh draft.
 */
export function ScheduleSettingsForm({ row }: { row: ScheduleRow }) {
  const toast = useToast();
  const save = useSaveSchedule();
  const { actions } = useAdminMe();
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [error, setError] = useState<Partial<Record<"when" | "intervalDays", string>>>({});
  const external = externalClocks.includes(row.key);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(row));
  const canEdit = actions.includes("automation.schedules_put");
  const name = scheduleName(row.key);

  const submit = () => {
    const patch: SchedulePatch = { enabled: draft.enabled };
    if (!external) {
      const when = cronFrom(draft);
      if ("error" in when) {
        setError({ when: when.error });
        return;
      }
      patch.cron = when.cron;
    }
    if (row.interval_days !== null) {
      const days = Number(draft.intervalDays);
      if (draft.intervalDays.trim() === "" || !Number.isInteger(days) || days < 1 || days > 90) {
        setError({ intervalDays: "Use a whole number of days from 1 to 90" });
        return;
      }
      patch.interval_days = days;
    }
    const parsed = scheduleSettingsPutSchema.safeParse(patch);
    if (!parsed.success) {
      setError({ when: parsed.error.issues[0]?.message ?? "Check the timetable" });
      return;
    }
    setError({});
    save.mutate(
      { key: row.key, patch },
      {
        onSuccess: () => {
          toast({ message: `${name} saved.` });
        },
      },
    );
  };

  return (
    <article className="admin-clock" aria-label={name}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="admin-clock__head">
          <div className="admin-clock__title">
            <h3>{name}</h3>
            {scheduleNames[row.key] === undefined ? null : (
              <p className="admin-field__hint">{scheduleNames[row.key]?.about}</p>
            )}
          </div>
          <StatusPill label={row.enabled ? "On" : "Off"} tone={row.enabled ? "ok" : "neutral"} />
        </div>
        <p className="admin-clock__when">{sayCadence(row.cron, row.interval_days)}</p>
        <dl className="admin-clock__times">
          <dt>Next run</dt>
          <dd>
            {row.next_run_at === null || !row.enabled ? (
              "Not scheduled"
            ) : (
              <LocalTime value={row.next_run_at} />
            )}
          </dd>
          <dt>Last run</dt>
          <dd>{row.last_run_at === null ? "Never" : <LocalTime value={row.last_run_at} />}</dd>
        </dl>
        <details className="admin-clock__change" open={dirty || error.when !== undefined}>
          <summary>Change when it runs</summary>
          <fieldset className="admin-clock__fields" disabled={!canEdit || save.isPending}>
            <legend className="admin-visually-hidden">When {name} runs</legend>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => {
                  setDraft({ ...draft, enabled: event.target.checked });
                }}
              />
              {name} runs
            </label>
            {external ? (
              <p className="admin-field__hint">
                Its time is set outside the site (on the laptop or on GitHub), so only on and off
                change here.
              </p>
            ) : (
              <div className="admin-clock__picker">
                <Field label="How often">
                  {(control) => (
                    <select
                      {...control}
                      value={draft.often}
                      onChange={(event) => {
                        const often = event.target.value;
                        if (
                          often === "minutes" ||
                          often === "daily" ||
                          often === "weekly" ||
                          often === "other"
                        )
                          setDraft({ ...draft, often });
                      }}
                    >
                      <option value="minutes">Every few minutes</option>
                      <option value="daily">Every day</option>
                      <option value="weekly">Every week</option>
                      <option value="other">Custom timetable</option>
                    </select>
                  )}
                </Field>
                {draft.often === "minutes" ? (
                  <Field
                    label="Minutes between runs"
                    {...(error.when === undefined ? {} : { error: error.when })}
                  >
                    {(control) => (
                      <input
                        {...control}
                        type="number"
                        min={1}
                        max={59}
                        value={draft.every}
                        onChange={(event) => {
                          setDraft({ ...draft, every: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                ) : null}
                {draft.often === "weekly" ? (
                  <Field label="Day">
                    {(control) => (
                      <select
                        {...control}
                        value={String(draft.day)}
                        onChange={(event) => {
                          setDraft({ ...draft, day: Number(event.target.value) });
                        }}
                      >
                        {weekdays.map((day, index) => (
                          <option key={day} value={String(index)}>
                            {day}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                ) : null}
                {draft.often === "daily" || draft.often === "weekly" ? (
                  <Field
                    label="Time, Cairo"
                    {...(error.when === undefined ? {} : { error: error.when })}
                  >
                    {(control) => (
                      <input
                        {...control}
                        type="time"
                        value={draft.time}
                        onChange={(event) => {
                          setDraft({ ...draft, time: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                ) : null}
                {draft.often === "other" ? (
                  <Field
                    label="Timetable (cron, UTC)"
                    hint="Five fields: minute, hour, day of month, month, day of week."
                    {...(error.when === undefined ? {} : { error: error.when })}
                  >
                    {(control) => (
                      <input
                        {...control}
                        type="text"
                        value={draft.cron}
                        onChange={(event) => {
                          setDraft({ ...draft, cron: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            )}
            {row.interval_days === null ? null : (
              <Field
                label="Days between runs"
                {...(error.intervalDays === undefined ? {} : { error: error.intervalDays })}
              >
                {(control) => (
                  <input
                    {...control}
                    type="number"
                    min={1}
                    max={90}
                    value={draft.intervalDays}
                    onChange={(event) => {
                      setDraft({ ...draft, intervalDays: event.target.value });
                    }}
                  />
                )}
              </Field>
            )}
          </fieldset>
          <RoleGate action="automation.schedules_put">
            <div className="admin-actions">
              <button type="submit" className="admin-button" disabled={!dirty || save.isPending}>
                Save {name}
              </button>
              {dirty ? <span className="admin-field__hint">Unsaved changes</span> : null}
            </div>
          </RoleGate>
          {save.isError ? (
            <RequestFailure error={save.error} className="admin-field__error" />
          ) : null}
        </details>
      </form>
    </article>
  );
}
