import type { Db } from "../lib/db.ts";
import { addDays, kpiWeekSchema, type KpiWeek } from "./definitions.ts";

// The numbers of one week and of the week before it, both from SQL `kpi_weekly`, so each value carries its change.

export interface WeeklyKpis {
  current: KpiWeek;
  previous: KpiWeek;
}

async function readWeek(db: Db, weekStart: string): Promise<KpiWeek> {
  const { data, error } = await db.rpc("kpi_weekly", { p_week_start: weekStart });
  if (error !== null) throw new Error(`kpi_weekly_failed:${error.code}`);
  return kpiWeekSchema.parse(data);
}

/** The week that starts on `weekStart` (a Monday, `YYYY-MM-DD`) and the week before it. */
export async function collectWeeklyKpis(db: Db, weekStart: string): Promise<WeeklyKpis> {
  const [current, previous] = await Promise.all([
    readWeek(db, weekStart),
    readWeek(db, addDays(weekStart, -7)),
  ]);
  return { current, previous };
}
