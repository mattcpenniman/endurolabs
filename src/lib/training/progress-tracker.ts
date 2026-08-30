// ============================================================
// EnduroLab — Weekly Progress Tracker
// ============================================================
// Tracks actual vs planned mileage, feel ratings, adherence,
// and generates adjustment suggestions based on trends.
// ============================================================

import { DailyLog, WeeklyLog, WeeklyProgress, MarathonPlan } from "./models";

// ─── Storage Keys ─────────────────────────────────────────

const STORAGE_KEY = "endurlab-progress";
const DAILY_STORAGE_KEY = "endurlab-daily-progress";

// ─── Load / Save ──────────────────────────────────────────

export function loadLogs(planId: string): WeeklyLog[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${planId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLogs(planId: string, logs: WeeklyLog[]): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${planId}`, JSON.stringify(logs));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

export function addLog(planId: string, log: WeeklyLog): WeeklyLog[] {
  const logs = loadLogs(planId);
  const existingIdx = logs.findIndex((l) => l.weekNumber === log.weekNumber);
  if (existingIdx >= 0) {
    logs[existingIdx] = log;
  } else {
    logs.push(log);
  }
  saveLogs(planId, logs);
  return logs;
}

export function loadDailyLogs(planId: string): DailyLog[] {
  try {
    const raw = localStorage.getItem(`${DAILY_STORAGE_KEY}-${planId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDailyLogs(planId: string, logs: DailyLog[]): void {
  try {
    localStorage.setItem(`${DAILY_STORAGE_KEY}-${planId}`, JSON.stringify(logs));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

export function addDailyLog(planId: string, log: DailyLog): DailyLog[] {
  const logs = loadDailyLogs(planId);
  const existingIdx = logs.findIndex(
    (l) => l.weekNumber === log.weekNumber && l.dayOfWeek === log.dayOfWeek && l.runId === log.runId
  );

  if (existingIdx >= 0) {
    logs[existingIdx] = log;
  } else {
    logs.push(log);
  }

  saveDailyLogs(planId, logs);
  return logs;
}

export function removeDailyLog(
  planId: string,
  weekNumber: number,
  dayOfWeek: string,
  runId: string
): DailyLog[] {
  const logs = loadDailyLogs(planId).filter(
    (log) => !(log.weekNumber === weekNumber && log.dayOfWeek === dayOfWeek && log.runId === runId)
  );
  saveDailyLogs(planId, logs);
  return logs;
}

function planDayKey(weekNumber: number, dayOfWeek: string): string {
  return String(weekNumber) + ":" + dayOfWeek;
}

function dateKey(date: string): string {
  return date.slice(0, 10);
}

/**
 * Keeps the original planned day wherever an actual has been logged while
 * accepting recalculated workouts for every other day.
 */
export function preserveLoggedPlanDays(
  currentPlan: MarathonPlan,
  recalculatedPlan: MarathonPlan,
  dailyLogs: Array<Pick<DailyLog, "weekNumber" | "dayOfWeek" | "date">>
): MarathonPlan {
  if (dailyLogs.length === 0) return recalculatedPlan;

  const lockedSlots = new Set(dailyLogs.map((log) => planDayKey(log.weekNumber, log.dayOfWeek)));
  const lockedDates = new Set(dailyLogs.map((log) => dateKey(log.date)));
  const latestLoggedDate = dailyLogs.reduce(
    (latest, log) => dateKey(log.date) > latest ? dateKey(log.date) : latest,
    ""
  );
  const currentDaysBySlot = new Map(
    currentPlan.weeks.flatMap((week) =>
      week.days.map((day) => [planDayKey(week.weekNumber, day.dayOfWeek), day] as const)
    )
  );
  const currentDaysByDate = new Map(
    currentPlan.weeks.flatMap((week) => week.days.map((day) => [dateKey(day.date), day] as const))
  );

  const weeks = recalculatedPlan.weeks.map((week) => {
    let preservedADay = false;
    const days = week.days.map((day) => {
      const dayDate = dateKey(day.date);
      const currentDay = dayDate <= latestLoggedDate
        ? currentDaysByDate.get(dayDate)
        : lockedDates.has(dayDate)
          ? currentDaysByDate.get(dayDate)
        : lockedSlots.has(planDayKey(week.weekNumber, day.dayOfWeek))
          ? currentDaysBySlot.get(planDayKey(week.weekNumber, day.dayOfWeek))
          : undefined;

      if (!currentDay) return day;
      preservedADay = true;
      return currentDay;
    });

    if (!preservedADay) return week;

    const workouts = days
      .flatMap((day) => [day.workout, day.secondaryWorkout])
      .filter((workout) => workout !== null && workout !== undefined);
    const intensityDistribution = { easy: 0, threshold: 0, marathon: 0, vo2: 0 };
    let longRunDistance = 0;

    workouts.forEach((workout) => {
      const mileage = workout.weeklyMileageContribution ?? 0;
      if (workout.type === "threshold") intensityDistribution.threshold += mileage;
      else if (workout.type === "marathon_pace") intensityDistribution.marathon += mileage;
      else if (workout.type === "vo2") intensityDistribution.vo2 += mileage;
      else intensityDistribution.easy += mileage;
      if (workout.type === "long") longRunDistance = Math.max(longRunDistance, workout.totalDistance);
    });

    return {
      ...week,
      days,
      totalMileage: Math.round(days.reduce((sum, day) => sum + day.plannedMileage, 0) * 100) / 100,
      longRunDistance,
      intensityDistribution,
    };
  });

  return { ...recalculatedPlan, weeks };
}

export function dailyLogsToWeeklyLogs(plan: MarathonPlan, dailyLogs: DailyLog[]): WeeklyLog[] {
  return plan.weeks
    .map((week) => {
      const weekLogs = dailyLogs.filter((log) => log.weekNumber === week.weekNumber);
      if (weekLogs.length === 0) return null;

      const plannedWorkoutIds = week.days.flatMap((day) => [
        ...(day.workout ? [day.workout.id] : []),
        ...(day.secondaryWorkout ? [day.secondaryWorkout.id] : []),
      ]);
      const longRunWorkoutIds = week.days.flatMap((day) => [
        ...(day.workout?.type === "long" ? [day.workout.id] : []),
        ...(day.secondaryWorkout?.type === "long" ? [day.secondaryWorkout.id] : []),
      ]);
      const longRunActual = Math.round(
        weekLogs
          .filter((log) => log.plannedWorkoutId && longRunWorkoutIds.includes(log.plannedWorkoutId))
          .reduce((sum, log) => sum + log.actualMileage, 0) * 10
      ) / 10;
      const completedCount = new Set(
        weekLogs
          .filter((log) => log.completed && log.plannedWorkoutId && plannedWorkoutIds.includes(log.plannedWorkoutId))
          .map((log) => log.plannedWorkoutId)
      ).size;
      const plannedWorkoutCount = plannedWorkoutIds.length;
      const adherence =
        plannedWorkoutCount > 0
          ? Math.round((completedCount / plannedWorkoutCount) * 100)
          : 100;

      return {
        weekNumber: week.weekNumber,
        actualMileage: Math.round(weekLogs.reduce((sum, log) => sum + log.actualMileage, 0) * 10) / 10,
        plannedMileage: week.totalMileage,
        longRunActual,
        longRunPlanned: week.longRunDistance,
        feelRating:
          Math.round(
            (weekLogs.reduce((sum, log) => sum + log.feelRating, 0) / weekLogs.length) * 10
          ) / 10,
        adherence,
        notes: weekLogs
          .map((log) => log.notes.trim())
          .filter(Boolean)
          .join(" | "),
        loggedAt: weekLogs[weekLogs.length - 1].loggedAt,
      };
    })
    .filter((log): log is WeeklyLog => log !== null);
}

// ─── Progress Analysis ────────────────────────────────────

export function analyzeProgress(
  plan: MarathonPlan,
  logs: WeeklyLog[]
): WeeklyProgress {
  const sorted = [...logs].sort((a, b) => a.weekNumber - b.weekNumber);
  const currentWeek = plan.weeks[plan.weeks.length - 1]?.weekNumber ?? plan.totalWeeks;

  const averageFeel =
    sorted.length > 0
      ? Math.round((sorted.reduce((sum, l) => sum + l.feelRating, 0) / sorted.length) * 10) / 10
      : 0;

  const averageAdherence =
    sorted.length > 0
      ? Math.round(sorted.reduce((sum, l) => sum + l.adherence, 0) / sorted.length)
      : 0;

  // Project peak mileage based on recent trend
  const recentLogs = sorted.slice(-3); // last 3 weeks
  const projectedPeakMileage = recentLogs.length > 0
    ? Math.round(recentLogs[recentLogs.length - 1].actualMileage)
    : plan.peakWeeklyMileage;

  // Generate adjustment suggestions
  const suggestions: string[] = [];

  // Check adherence trend
  if (sorted.length >= 2) {
    const recentAdherence = sorted.slice(-2).reduce((sum, l) => sum + l.adherence, 0) / 2;
    if (recentAdherence < 60) {
      suggestions.push(
        "Adherence has dropped below 60% — consider reducing next week's mileage by 10-15%"
      );
    } else if (recentAdherence >= 90 && averageFeel <= 4) {
      suggestions.push(
        "High adherence with low feel ratings — you're pushing hard. Consider a recovery week"
      );
    }
  }

  // Check mileage trend
  if (recentLogs.length >= 2) {
    const lastMileage = recentLogs[recentLogs.length - 1].actualMileage;
    const prevMileage = recentLogs[recentLogs.length - 2].actualMileage;
    const spike = ((lastMileage - prevMileage) / prevMileage) * 100;

    if (spike > 15) {
      suggestions.push(
        `Mileage spiked ${Math.round(spike)}% this week — keep next week flat or down to avoid injury`
      );
    }
  }

  // Check long run adherence
  const longRunLogs = sorted.filter((l) => l.longRunPlanned > 0);
  if (longRunLogs.length > 0) {
    const avgLongRunRatio =
      longRunLogs.reduce((sum, l) => sum + (l.longRunActual / l.longRunPlanned), 0) / longRunLogs.length;
    if (avgLongRunRatio < 0.7) {
      suggestions.push(
        "Long run adherence is low — prioritize completing long runs, even if shorter than planned"
      );
    }
  }

  // Check fatigue trend
  if (sorted.length >= 3) {
    const recentFeel = sorted.slice(-3).reduce((sum, l) => sum + l.feelRating, 0) / 3;
    if (recentFeel <= 3) {
      suggestions.push(
        "Consistently low feel ratings (≤3/10) — your body is telling you to back off. Take an extra rest day"
      );
    }
  }

  // Positive reinforcement
  if (averageAdherence >= 85 && averageFeel >= 6) {
    suggestions.push(
      "Great adherence with good feel ratings — you're on track. Stick to the plan!"
    );
  }

  return {
    logs: sorted,
    currentWeek,
    totalWeeks: plan.totalWeeks,
    averageFeel,
    averageAdherence,
    projectedPeakMileage,
    adjustmentSuggestions: suggestions,
  };
}

// ─── Mileage Trend Data ───────────────────────────────────

export function getMileageTrend(logs: WeeklyLog[]): { planned: number[]; actual: number[] } {
  const sorted = [...logs].sort((a, b) => a.weekNumber - b.weekNumber);
  return {
    planned: sorted.map((l) => l.plannedMileage),
    actual: sorted.map((l) => l.actualMileage),
  };
}
