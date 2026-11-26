/** Garmin daily wellness totals: calendar dates, never activity-derived step estimates. */
export interface DailySteps {
  localDate: string;
  totalSteps: number;
}

export interface StepsRange {
  startDate: string;
  endDate: string;
}

export interface WeeklyStepsSummary {
  totalSteps: number;
  averageSteps: number;
  daysWithData: number;
  totalDays: number;
  partial: boolean;
}

/** Average known calendar-day totals only; missing/future days never become zeros. */
export function summarizeWeeklySteps(dates: string[], totals: Record<string, number>, today: string): WeeklyStepsSummary | null {
  const weekDates = [...new Set(dates.map((date) => date.slice(0, 10)).filter(isCalendarDate))];
  const knownDates = weekDates.filter((date) => date <= today && Number.isSafeInteger(totals[date]) && totals[date] >= 0);
  if (!knownDates.length) return null;
  const totalSteps = knownDates.reduce((sum, date) => sum + totals[date], 0);
  return {
    totalSteps,
    averageSteps: totalSteps / knownDates.length,
    daysWithData: knownDates.length,
    totalDays: weekDates.length,
    partial: knownDates.length < weekDates.length || weekDates.includes(today),
  };
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

/** Garmin's daily-statistics endpoint accepts at most 28 inclusive calendar days. */
export function validateStepsRange(startDate: unknown, endDate: unknown, maxDays = 28): StepsRange {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) throw new Error("Use valid YYYY-MM-DD dates");
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  if (days < 1 || days > maxDays) throw new Error(`Choose an ordered range of at most ${maxDays} days`);
  return { startDate, endDate };
}

export function chunkStepsRange(range: StepsRange): StepsRange[] {
  validateStepsRange(range.startDate, range.endDate, 3660);
  const chunks: StepsRange[] = [];
  for (let start = Date.parse(range.startDate); start <= Date.parse(range.endDate); start += 28 * 86_400_000) {
    chunks.push({ startDate: new Date(start).toISOString().slice(0, 10),
      endDate: new Date(Math.min(start + 27 * 86_400_000, Date.parse(range.endDate))).toISOString().slice(0, 10) });
  }
  return chunks;
}

/** Reject malformed responses rather than caching them as successful empty history. */
export function normalizeDailySteps(payload: unknown, range: StepsRange): DailySteps[] {
  if (!Array.isArray(payload)) throw new Error("Invalid Garmin daily steps response");
  const days = new Map<string, DailySteps>();
  for (const value of payload) {
    if (typeof value !== "object" || value === null) throw new Error("Invalid Garmin daily steps row");
    const row = value as Record<string, unknown>;
    if (!isCalendarDate(row.calendarDate)) throw new Error("Invalid Garmin steps calendar date");
    if (row.calendarDate < range.startDate || row.calendarDate > range.endDate) continue;
    // Null/missing means unavailable, not zero. Preserve a genuine zero total.
    if (row.totalSteps === null || row.totalSteps === undefined) continue;
    if (typeof row.totalSteps !== "number" || !Number.isSafeInteger(row.totalSteps) || row.totalSteps < 0 || row.totalSteps > 2_147_483_647) {
      throw new Error("Invalid Garmin daily steps total");
    }
    if (days.has(row.calendarDate)) throw new Error("Duplicate Garmin steps calendar date");
    days.set(row.calendarDate, { localDate: row.calendarDate, totalSteps: row.totalSteps });
  }
  return [...days.values()].sort((a, b) => a.localDate.localeCompare(b.localDate));
}
