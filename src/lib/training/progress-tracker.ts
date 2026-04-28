// ============================================================
// EnduroLab — Weekly Progress Tracker
// ============================================================
// Tracks actual vs planned mileage, feel ratings, adherence,
// and generates adjustment suggestions based on trends.
// ============================================================

import { WeeklyLog, WeeklyProgress, MarathonPlan } from "./models";

// ─── Storage Keys ─────────────────────────────────────────

const STORAGE_KEY = "endurlab-progress";

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
