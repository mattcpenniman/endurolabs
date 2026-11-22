// ============================================================
// EnduroLab — Plan Schedule Guards
// ============================================================
// Stored plan_data is not always a generated plan: legacy/imported rows
// can carry phase-level stubs whose weeks have no dates or days. Callers
// that window activities by calendar date must check for a dated schedule
// before reading week.startDate / week.days.
// ============================================================

import type { MarathonPlan } from "./models";

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * True when every week has a start date, a days array, and a resolvable
 * end date (last day's date, falling back to the week's endDate).
 */
export function hasDatedSchedule(plan: unknown): plan is MarathonPlan {
  if (!plan || typeof plan !== "object") return false;
  const weeks = (plan as { weeks?: unknown }).weeks;
  if (!Array.isArray(weeks) || weeks.length === 0) return false;
  return weeks.every((week: unknown) => {
    if (!week || typeof week !== "object") return false;
    const { startDate, endDate, days } = week as { startDate?: unknown; endDate?: unknown; days?: unknown };
    if (!isDateString(startDate) || !Array.isArray(days)) return false;
    const lastDay = days[days.length - 1] as { date?: unknown } | undefined;
    return isDateString(lastDay?.date ?? endDate);
  });
}
