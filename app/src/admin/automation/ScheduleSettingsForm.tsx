import { useState } from "react";
import { scheduleSettingsPutSchema } from "../../domain/automation";
import { formatInZone } from "../../domain/market-time";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill } from "../ui/StatusPill";
import { useAdminMe } from "../ui/admin-me";
import { useToast } from "../ui/use-toast";
import { useSaveSchedule, type SchedulePatch, type ScheduleRow } from "./automation-queries";
import { RequestFailure } from "./RequestFailure";

// Keep-warm, the audit routine and backup.yml run on clocks outside the database: `automation_put_schedule` refuses a
// changed cron for these three with `external_clock`, so the screen shows the cron and does not offer it.
const externalClocks: readonly string[] = ["keepwarm", "audit", "backup"];

interface Draft {
  enabled: boolean;
  cron: string;
  intervalDays: string;
}

const draftOf = (row: ScheduleRow): Draft => ({
  enabled: row.enabled,
  cron: row.cron,
  intervalDays: row.interval_days === null ? "" : String(row.interval_days),
});

const cadenceOf = (days: number | null): string => {
  if (days === null) return "by its cron";
  return days === 1 ? "every day" : `every ${String(days)} days`;
};

/**
 * One clock on screen 20. The cron and `next_run_at` are UTC and say so; the next run is also shown in the market zone.
 * The parent keys this component by the stored row, so a refetch after a save starts a fresh draft.
 */
export function ScheduleSettingsForm({ row }: { row: ScheduleRow }) {
  const toast = useToast();
  const save = useSaveSchedule();
  const { actions } = useAdminMe();
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [error, setError] = useState<Partial<Record<"cron" | "intervalDays", string>>>({});
  const external = externalClocks.includes(row.key);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(row));
  const canEdit = actions.includes("automation.schedules_put");

  const submit = () => {
    const patch: SchedulePatch = { enabled: draft.enabled };
    if (!external) patch.cron = draft.cron.trim();
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
      setError({ cron: parsed.error.issues[0]?.message ?? "Check the cron" });
      return;
    }
    setError({});
    save.mutate(
      { key: row.key, patch },
      {
        onSuccess: () => {
          toast({ message: `${row.key} saved.` });
        },
      },
    );
  };

  return (
    <article className="admin-clock" aria-label={row.key}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="admin-clock__fields" disabled={!canEdit || save.isPending}>
          <legend className="admin-template__key">
            <code>{row.key}</code>
            {external ? <StatusPill label="External clock" tone="info" /> : null}
          </legend>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                setDraft({ ...draft, enabled: event.target.checked });
              }}
            />
            Clock on
          </label>
          <p className="admin-clock__cadence">Cadence: {cadenceOf(row.interval_days)}</p>
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
          {external ? (
            <p>
              Cron (UTC) <code>{row.cron}</code>
              <span className="admin-field__hint">
                {" "}
                Set outside the database, so it is read only here.
              </span>
            </p>
          ) : (
            <Field label="Cron (UTC)" {...(error.cron === undefined ? {} : { error: error.cron })}>
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
          )}
          <dl className="admin-clock__times">
            <dt>Next run</dt>
            <dd>
              {row.next_run_at === null ? (
                "Not scheduled"
              ) : (
                <>
                  <time dateTime={row.next_run_at}>
                    {formatInZone(row.next_run_at, "UTC", "datetime")}
                  </time>
                  {" · "}
                  <LocalTime value={row.next_run_at} />
                </>
              )}
            </dd>
            <dt>Last run</dt>
            <dd>{row.last_run_at === null ? "Never" : <LocalTime value={row.last_run_at} />}</dd>
          </dl>
        </fieldset>
        <RoleGate action="automation.schedules_put">
          <div className="admin-actions">
            {dirty ? <span className="admin-field__hint">Unsaved changes</span> : null}
            <button type="submit" className="admin-button" disabled={!dirty || save.isPending}>
              Save {row.key}
            </button>
          </div>
        </RoleGate>
        {save.isError ? <RequestFailure error={save.error} className="admin-field__error" /> : null}
      </form>
    </article>
  );
}
