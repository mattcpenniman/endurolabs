"use client";

// ============================================================
// EnduroLab — Weekly Plan Card
// ============================================================
// Collapsible card showing a single week's schedule with
// daily workouts, mileage totals, and phase indicator.
// Supports client-side workout swapping.
// ============================================================

import React from "react";
import { useState, useEffect, useMemo } from "react";
import { DailyLog, WeeklyPlan, DailyPlan, Workout, WorkoutType, RunnerProfile, formatPace } from "@/lib/training/models";
import { addDailyLog, removeDailyLog } from "@/lib/training/progress-tracker";

interface WeeklyPlanCardProps {
  planId: string;
  week: WeeklyPlan;
  isExpanded: boolean;
  onToggle: () => void;
  dailyLogs: DailyLog[];
  onDailyLogSaved: () => void;
  intensityTargetPercents: NonNullable<RunnerProfile["intensityTargetPercents"]>;
  onIntensityTargetChange: (key: keyof NonNullable<RunnerProfile["intensityTargetPercents"]>, value: number, weekNumber?: number) => void;
  highlightCurrentWeek?: boolean;
  focusDate?: string | null;
  onWeekUpdate?: (updatedWeek: WeeklyPlan) => Promise<void> | void;
}

type IntensityTargetKey = keyof NonNullable<RunnerProfile["intensityTargetPercents"]>;

// Swap targets a runner can choose from
const swapOptions: Array<{ type: WorkoutType; label: string; emoji: string }> = [
  { type: "easy", label: "Easy Run", emoji: "🏃" },
  { type: "recovery", label: "Recovery Run", emoji: "🚶" },
  { type: "cross_training", label: "Cross Training", emoji: "🚴" },
  { type: "strength", label: "Strength", emoji: "💪" },
  { type: "rest", label: "Rest Day", emoji: "😴" },
];

const workoutEmoji: Record<string, string> = {
  easy: "🏃",
  recovery: "🚶",
  threshold: "🔥",
  marathon_pace: "🎯",
  vo2: "⚡",
  long: "🦵",
  progression: "📈",
  strength: "💪",
  cross_training: "🚴",
  rest: "😴",
};

const workoutColor: Record<string, string> = {
  easy: "text-green-600",
  recovery: "text-green-400",
  threshold: "text-amber-600",
  marathon_pace: "text-blue-600",
  vo2: "text-red-600",
  long: "text-purple-600",
  progression: "text-blue-500",
  strength: "text-pink-600",
  cross_training: "text-teal-600",
  rest: "text-gray-400",
};

const dayDisplayOrder: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

const phaseDetails: Record<WeeklyPlan["phase"], { shortLabel: string; fullLabel: string }> = {
  base: {
    shortLabel: "Phase 1",
    fullLabel: "Phase 1: Aerobic + Threshold Base",
  },
  marathon_build: {
    shortLabel: "Phase 2",
    fullLabel: "Phase 2: Marathon-Specific Build",
  },
  peak_taper: {
    shortLabel: "Phase 3",
    fullLabel: "Phase 3: Peak + Taper",
  },
};

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function formatMiles(distance: number): string {
  return Number.isInteger(distance) ? `${distance}` : `${distance.toFixed(2).replace(/0$/, "")}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function toDateKey(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

function formatMileageValue(distance: number): string {
  return `${distance.toFixed(2).replace(/\.?0+$/, "")} mi`;
}

function segmentDistanceLabel(segment: Workout["segments"][number]): string {
  if (!segment.distance) {
    return segment.duration ? `${segment.duration} min` : "";
  }
  if (segment.repetitions && segment.repetitions > 1) {
    return `${segment.repetitions} x ${formatMiles(segment.distance)} mi = ${formatMiles(segment.distance * segment.repetitions)} mi`;
  }
  return `${formatMiles(segment.distance)} mi`;
}

function renderWorkoutSegments(workout: Workout) {
  if (workout.segments.length <= 1) return null;

  return (
    <div className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Workout breakdown</p>
      {workout.segments.map((segment, index) => {
        const distanceLabel = segmentDistanceLabel(segment);
        return (
          <div key={`${workout.id}-segment-${index}`} className="grid gap-1 text-xs text-gray-600 sm:grid-cols-[1fr_auto]">
            <div>
              <span className={`font-medium ${workoutColor[segment.type] ?? "text-gray-700"}`}>
                {segment.description}
              </span>
              {segment.pace && (
                <span className="ml-2 text-gray-400">@ {formatPace(segment.pace)}/mi</span>
              )}
            </div>
            {distanceLabel && <span className="font-semibold text-gray-700">{distanceLabel}</span>}
          </div>
        );
      })}
    </div>
  );
}

const MOBILE_MILEAGE_WHOLE_OPTIONS = Array.from({ length: 41 }, (_, index) => index);
const MOBILE_MILEAGE_FRACTION_OPTIONS = Array.from({ length: 20 }, (_, index) => index * 0.05);

interface RunLogDraft {
  actualMileage: number;
  feelRating: number;
  notes: string;
}

interface RunEditorState {
  title: string;
  totalDistance: number;
  estimatedDuration: number;
  targetDayOfWeek: string;
}

type WorkoutSlot = "workout" | "secondaryWorkout";

interface RunLocation {
  dayIndex: number;
  slot: WorkoutSlot;
}

interface RunEntry {
  runId: string;
  title: string;
  plannedMileage: number;
  plannedWorkoutId: string | null;
  workout: Workout | null;
  log: DailyLog | undefined;
  isAdditionalRun: boolean;
}

function createDefaultRunDraft(plannedMileage: number): RunLogDraft {
  return {
    actualMileage: plannedMileage,
    feelRating: 5,
    notes: "",
  };
}

function workoutToIntensityBucket(workout: Workout | null | undefined): keyof WeeklyPlan["intensityDistribution"] {
  switch (workout?.type) {
    case "threshold":
      return "threshold";
    case "marathon_pace":
      return "marathon";
    case "vo2":
      return "vo2";
    default:
      return "easy";
  }
}

function calculateWeekMetrics(days: DailyPlan[]): Pick<WeeklyPlan, "totalMileage" | "longRunDistance" | "intensityDistribution"> {
  const totals = days.reduce(
    (acc, day) => {
      [day.workout, day.secondaryWorkout].forEach((workout) => {
        if (!workout) return;
        const contribution = workout.weeklyMileageContribution ?? 0;
        acc.totalMileage += contribution;
        acc.longRunDistance = Math.max(acc.longRunDistance, workout.type === "long" ? workout.totalDistance : 0);
        acc.intensityDistribution[workoutToIntensityBucket(workout)] += contribution;
      });
      return acc;
    },
    {
      totalMileage: 0,
      longRunDistance: 0,
      intensityDistribution: {
        easy: 0,
        threshold: 0,
        marathon: 0,
        vo2: 0,
      },
    }
  );

  return {
    totalMileage: Math.round(totals.totalMileage * 10) / 10,
    longRunDistance: Math.round(totals.longRunDistance * 10) / 10,
    intensityDistribution: {
      easy: Math.round(totals.intensityDistribution.easy * 10) / 10,
      threshold: Math.round(totals.intensityDistribution.threshold * 10) / 10,
      marathon: Math.round(totals.intensityDistribution.marathon * 10) / 10,
      vo2: Math.round(totals.intensityDistribution.vo2 * 10) / 10,
    },
  };
}

function buildUpdatedWeek(baseWeek: WeeklyPlan, days: DailyPlan[]): WeeklyPlan {
  const metrics = calculateWeekMetrics(days);
  return {
    ...baseWeek,
    days,
    ...metrics,
  };
}

function findRunLocation(days: DailyPlan[], runId: string): RunLocation | null {
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    if (days[dayIndex]?.workout?.id === runId) {
      return { dayIndex, slot: "workout" };
    }
    if (days[dayIndex]?.secondaryWorkout?.id === runId) {
      return { dayIndex, slot: "secondaryWorkout" };
    }
  }

  return null;
}

function DailyLogControls({
  draft,
  plannedMileage,
  onDraftChange,
  onSave,
  onCancel,
}: {
  draft: RunLogDraft;
  plannedMileage: number;
  onDraftChange: (patch: Partial<RunLogDraft>) => void;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const [isMobileMileagePickerOpen, setIsMobileMileagePickerOpen] = useState(false);
  const normalizedMileage = Number.isFinite(draft.actualMileage) ? Math.max(0, draft.actualMileage) : 0;
  const wholeMiles = Math.min(40, Math.floor(normalizedMileage));
  const fractionalMiles = Math.round((normalizedMileage - wholeMiles) * 20) / 20;

  const updateMobileMileage = (whole: number, fraction: number): void => {
    const actualMileage = Math.min(40, Math.round((whole + fraction) * 20) / 20);
    onDraftChange({ actualMileage });
  };

  return (
    <div className="grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-[8rem_8rem_1fr_auto] sm:items-end">
      <div className="block">
        <span className="text-xs font-medium text-gray-500">Actual mi</span>
        <button
          type="button"
          onClick={() => setIsMobileMileagePickerOpen(true)}
          className="mt-1 flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20 sm:hidden"
        >
          <span>{formatMileageValue(normalizedMileage)}</span>
          <span className="text-xs text-gray-400">Set</span>
        </button>
        <input
          type="number"
          min={0}
          max={40}
          step={0.1}
          value={draft.actualMileage}
          onChange={(e) => onDraftChange({ actualMileage: parseFloat(e.target.value) || 0 })}
          className="mt-1 hidden w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20 sm:block"
        />
        {isMobileMileagePickerOpen && (
          <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35 sm:hidden">
            <button
              type="button"
              aria-label="Close actual mileage picker"
              className="absolute inset-0"
              onClick={() => setIsMobileMileagePickerOpen(false)}
            />
            <div className="relative w-full rounded-t-3xl bg-white p-4 shadow-2xl">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Actual miles</p>
                  <p className="text-xs text-gray-500">{formatMileageValue(normalizedMileage)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileMileagePickerOpen(false)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600"
                >
                  Done
                </button>
              </div>
              <div className="mt-4 grid grid-cols-[1fr_1fr] gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Whole</span>
                  <select
                    value={wholeMiles}
                    onChange={(e) => updateMobileMileage(parseInt(e.target.value, 10), fractionalMiles)}
                    className="mt-2 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-base focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
                    size={6}
                  >
                    {MOBILE_MILEAGE_WHOLE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Fraction</span>
                  <select
                    value={fractionalMiles.toFixed(2)}
                    onChange={(e) => updateMobileMileage(wholeMiles, parseFloat(e.target.value))}
                    className="mt-2 h-40 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-base focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
                    size={6}
                  >
                    {MOBILE_MILEAGE_FRACTION_OPTIONS.map((value) => (
                      <option key={value.toFixed(2)} value={value.toFixed(2)}>
                        {value === 0 ? ".00" : value.toFixed(2).replace(/^0/, "")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
      <label className="block">
        <span className="text-xs font-medium text-gray-500">Feel</span>
        <select
          value={draft.feelRating}
          onChange={(e) => onDraftChange({ feelRating: parseInt(e.target.value) })}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
        >
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value}/10
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-gray-500">Notes</span>
        <input
          type="text"
          value={draft.notes}
          onChange={(e) => onDraftChange({ notes: e.target.value })}
          placeholder="How did it go?"
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded bg-enduro-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-enduro-700"
        >
          Log
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 sm:col-span-4">
        Planned {plannedMileage} mi
      </p>
    </div>
  );
}

export default function WeeklyPlanCard({
  planId,
  week,
  isExpanded,
  onToggle,
  dailyLogs,
  onDailyLogSaved,
  intensityTargetPercents,
  onIntensityTargetChange,
  highlightCurrentWeek = false,
  focusDate = null,
  onWeekUpdate,
}: WeeklyPlanCardProps) {
  const [localDays, setLocalDays] = useState<DailyPlan[]>(
    [...week.days].sort((a, b) => dayDisplayOrder[a.dayOfWeek] - dayDisplayOrder[b.dayOfWeek])
  );
  const [runDrafts, setRunDrafts] = useState<Record<string, RunLogDraft>>({});
  const [pendingExtraRuns, setPendingExtraRuns] = useState<Record<string, string[]>>({});
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [runEditors, setRunEditors] = useState<Record<string, RunEditorState>>({});
  const orderedDays = useMemo(
    () => [...localDays].sort((a, b) => dayDisplayOrder[a.dayOfWeek] - dayDisplayOrder[b.dayOfWeek]),
    [localDays]
  );

  useEffect(() => {
    setLocalDays([...week.days].sort((a, b) => dayDisplayOrder[a.dayOfWeek] - dayDisplayOrder[b.dayOfWeek]));
  }, [week.days]);

  // Listen for swap events from child renders
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { dayOfWeek, workoutType } = customEvent.detail as { dayOfWeek: string; workoutType: WorkoutType };

      setLocalDays((prev) => {
        let replacement: Workout | null = null;
        switch (workoutType) {
          case "easy":
            replacement = {
              id: `swapped-easy-${dayOfWeek}`,
              type: "easy",
              title: "3 mi Easy Run",
              description: "Steady, conversational-paced run.",
              segments: [],
              totalDistance: 3,
              estimatedDuration: 30,
              weeklyMileageContribution: 3,
              intensityCategory: "easy",
            };
            break;
          case "recovery":
            replacement = {
              id: `swapped-recovery-${dayOfWeek}`,
              type: "recovery",
              title: "2 mi Recovery Run",
              description: "Very relaxed jog to promote recovery.",
              segments: [],
              totalDistance: 2,
              estimatedDuration: 25,
              weeklyMileageContribution: 2,
              intensityCategory: "easy",
            };
            break;
          case "cross_training":
            replacement = {
              id: `swapped-cross-${dayOfWeek}`,
              type: "cross_training",
              title: "45 min Cross Training",
              description: "Low-impact cardio — cycling, swimming, elliptical.",
              segments: [],
              totalDistance: 0,
              estimatedDuration: 45,
              weeklyMileageContribution: 0,
              intensityCategory: "easy",
            };
            break;
          case "strength":
            replacement = {
              id: `swapped-strength-${dayOfWeek}`,
              type: "strength",
              title: "Strength Training (30 min)",
              description: "Single-leg work, core, and hip stability.",
              segments: [],
              totalDistance: 0,
              estimatedDuration: 30,
              weeklyMileageContribution: 0,
              intensityCategory: "moderate",
            };
            break;
          case "rest":
          default:
            replacement = null;
        }

        return prev.map((day) => {
          if (day.dayOfWeek !== dayOfWeek) return day;
          return {
            ...day,
            workout: replacement,
            isRestDay: replacement === null,
            secondaryWorkout: replacement === null ? null : day.secondaryWorkout,
          };
        });
      });
    };

    window.addEventListener("workout-swap", handler);
    return () => window.removeEventListener("workout-swap", handler);
  }, []);

  const updateRunDraft = (runId: string, plannedMileage: number, patch: Partial<RunLogDraft>) => {
    setRunDrafts((prev) => ({
      ...prev,
      [runId]: {
        ...(prev[runId] ?? createDefaultRunDraft(plannedMileage)),
        ...patch,
      },
    }));
  };

  const resetRunDraft = (runId: string): void => {
    setRunDrafts((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  };

  const addAdditionalRun = (dayOfWeek: string): void => {
    const runId = `manual-${dayOfWeek}-${Date.now()}`;
    setPendingExtraRuns((prev) => ({
      ...prev,
      [dayOfWeek]: [...(prev[dayOfWeek] ?? []), runId],
    }));
    updateRunDraft(runId, 0, createDefaultRunDraft(0));
  };

  const cancelAdditionalRun = (dayOfWeek: string, runId: string): void => {
    setPendingExtraRuns((prev) => ({
      ...prev,
      [dayOfWeek]: (prev[dayOfWeek] ?? []).filter((id) => id !== runId),
    }));
    resetRunDraft(runId);
  };

  const saveRunLog = (day: DailyPlan, entry: RunEntry, draft: RunLogDraft): void => {
    addDailyLog(planId, {
      weekNumber: week.weekNumber,
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      runId: entry.runId,
      plannedWorkoutId: entry.plannedWorkoutId,
      runTitle: entry.title,
      isAdditionalRun: entry.isAdditionalRun,
      actualMileage: draft.actualMileage,
      completed: true,
      feelRating: draft.feelRating,
      notes: draft.notes,
      loggedAt: new Date().toISOString(),
    });
    resetRunDraft(entry.runId);
    setPendingExtraRuns((prev) => ({
      ...prev,
      [day.dayOfWeek]: (prev[day.dayOfWeek] ?? []).filter((id) => id !== entry.runId),
    }));
    onDailyLogSaved();
  };

  const removeRunLog = (day: DailyPlan, runId: string): void => {
    removeDailyLog(planId, week.weekNumber, day.dayOfWeek, runId);
    onDailyLogSaved();
  };

  const initializeRunEditor = (runId: string, workout: Workout, dayOfWeek: string): void => {
    setRunEditors((prev) => ({
      ...prev,
      [runId]: prev[runId] ?? {
        title: workout.title,
        totalDistance: workout.totalDistance,
        estimatedDuration: workout.estimatedDuration,
        targetDayOfWeek: dayOfWeek,
      },
    }));
    setEditingRunId((current) => (current === runId ? null : runId));
  };

  const saveRunEdit = async (runId: string): Promise<void> => {
    const editor = runEditors[runId];
    if (!editor) return;

    const location = findRunLocation(localDays, runId);
    if (!location) return;

    const sourceDay = localDays[location.dayIndex];
    const existingWorkout = sourceDay[location.slot];
    if (!existingWorkout) return;

    const updatedWorkout: Workout = {
      ...existingWorkout,
      title: editor.title,
      totalDistance: editor.totalDistance,
      estimatedDuration: editor.estimatedDuration,
      weeklyMileageContribution: existingWorkout.weeklyMileageContribution > 0 ? editor.totalDistance : existingWorkout.weeklyMileageContribution,
    };

    const nextDays = localDays.map((day) => ({ ...day }));
    nextDays[location.dayIndex] = { ...nextDays[location.dayIndex] };
    if (location.slot === "workout") {
      nextDays[location.dayIndex].workout = nextDays[location.dayIndex].secondaryWorkout;
      nextDays[location.dayIndex].secondaryWorkout = null;
      nextDays[location.dayIndex].isRestDay = !nextDays[location.dayIndex].workout;
    } else {
      nextDays[location.dayIndex].secondaryWorkout = null;
    }

    const targetIndex = nextDays.findIndex((day) => day.dayOfWeek === editor.targetDayOfWeek);
    if (targetIndex < 0) return;

    nextDays[targetIndex] = { ...nextDays[targetIndex] };
    if (!nextDays[targetIndex].workout) {
      nextDays[targetIndex].workout = updatedWorkout;
      nextDays[targetIndex].isRestDay = false;
    } else if (!nextDays[targetIndex].secondaryWorkout) {
      nextDays[targetIndex].secondaryWorkout = updatedWorkout;
    } else if (targetIndex === location.dayIndex && location.slot === "workout") {
      nextDays[targetIndex].workout = updatedWorkout;
    } else if (targetIndex === location.dayIndex && location.slot === "secondaryWorkout") {
      nextDays[targetIndex].secondaryWorkout = updatedWorkout;
    } else {
      return;
    }

    setLocalDays(nextDays);
    setEditingRunId(null);
    if (onWeekUpdate) {
      await onWeekUpdate(buildUpdatedWeek(week, nextDays));
    }
  };

  const adjustedMileage = localDays.reduce(
    (sum, day) =>
      sum +
      (day.workout?.weeklyMileageContribution ?? 0) +
      (day.secondaryWorkout?.weeklyMileageContribution ?? 0),
    0
  );
  const phaseDetail = phaseDetails[week.phase];
  const qualityTotals = [
    { label: "T", value: week.intensityDistribution.threshold, className: "bg-amber-50 text-amber-700" },
    { label: "MP", value: week.intensityDistribution.marathon, className: "bg-blue-50 text-blue-700" },
    { label: "VO2", value: week.intensityDistribution.vo2, className: "bg-red-50 text-red-700" },
  ].filter((item) => item.value > 0);
  const intensityRows: Array<{
    key: IntensityTargetKey;
    label: string;
    shortLabel: string;
    actualMiles: number;
    targetMiles: number;
    targetPercent: number;
    className: string;
  }> = [
    {
      key: "marathon",
      label: "Marathon pace",
      shortLabel: "MP",
      actualMiles: week.intensityDistribution.marathon,
      targetMiles: week.intensityTargetDistribution?.marathon ?? 0,
      targetPercent: intensityTargetPercents.marathon,
      className: "bg-blue-50 text-blue-700",
    },
    {
      key: "threshold",
      label: "Threshold / LT",
      shortLabel: "T",
      actualMiles: week.intensityDistribution.threshold,
      targetMiles: week.intensityTargetDistribution?.threshold ?? 0,
      targetPercent: intensityTargetPercents.threshold,
      className: "bg-amber-50 text-amber-700",
    },
    {
      key: "vo2",
      label: "VO2max / Speed",
      shortLabel: "VO2",
      actualMiles: week.intensityDistribution.vo2,
      targetMiles: week.intensityTargetDistribution?.vo2 ?? 0,
      targetPercent: intensityTargetPercents.vo2,
      className: "bg-red-50 text-red-700",
    },
  ];
  const activeIntensityRows = intensityRows.filter((row) => row.targetMiles > 0 || row.actualMiles > 0 || (isExpanded && (row.key === "marathon" || row.key === "threshold" || row.key === "vo2")));
  const weekLogs = dailyLogs.filter((log) => log.weekNumber === week.weekNumber);
  const actualMileage =
    weekLogs.length > 0
      ? Math.round(weekLogs.reduce((sum, log) => sum + log.actualMileage, 0) * 10) / 10
      : null;
  const variancePct =
    actualMileage !== null && adjustedMileage > 0
      ? Math.round(((actualMileage - adjustedMileage) / adjustedMileage) * 100)
      : null;
  const varianceClass =
    variancePct === null
      ? ""
      : Math.abs(variancePct) <= 5
      ? "bg-green-50 text-green-700"
      : variancePct < 0
      ? "bg-amber-50 text-amber-700"
      : "bg-blue-50 text-blue-700";

  // Highlight the current week, next week, and upcoming day markers.
  const today = new Date();
  const todayStr = toDateKey(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateKey(tomorrow);
  const nextWeekBoundary = new Date(today);
  nextWeekBoundary.setDate(nextWeekBoundary.getDate() + 7);
  const nextWeekBoundaryStr = toDateKey(nextWeekBoundary);
  const weekEnd = orderedDays.length > 0
    ? orderedDays[orderedDays.length - 1]
      ? toDateKey(orderedDays[orderedDays.length - 1].date)
      : ""
    : "";
  const weekStart = week.startDate ? toDateKey(week.startDate) : "";
  const isCurrentWeek = todayStr >= weekStart && todayStr <= weekEnd;
  const isNextWeek =
    !isCurrentWeek &&
    weekStart > todayStr &&
    weekStart <= nextWeekBoundaryStr;

  const isToday = (dayOfWeek: string): boolean => {
    const day = orderedDays.find((d) => d.dayOfWeek === dayOfWeek);
    if (!day) return false;
    return day.date ? toDateKey(day.date) === todayStr : false;
  };

  const isTomorrow = (dayOfWeek: string): boolean => {
    const day = orderedDays.find((d) => d.dayOfWeek === dayOfWeek);
    if (!day) return false;
    return day.date ? toDateKey(day.date) === tomorrowStr : false;
  };

  const buildRunEntries = (day: DailyPlan): RunEntry[] => {
    const dayLogs = dailyLogs.filter(
      (entry) => entry.weekNumber === week.weekNumber && entry.dayOfWeek === day.dayOfWeek
    );
    const plannedEntries: RunEntry[] = [day.workout, day.secondaryWorkout]
      .filter((workout): workout is Workout => Boolean(workout))
      .map((workout) => ({
        runId: workout.id,
        title: workout.title,
        plannedMileage: workout.weeklyMileageContribution ?? 0,
        plannedWorkoutId: workout.id,
        workout,
        log: dayLogs.find((entry) => entry.runId === workout.id),
        isAdditionalRun: false,
      }));

    const additionalEntries: RunEntry[] = dayLogs
      .filter((entry) => entry.isAdditionalRun)
      .map((entry) => ({
        runId: entry.runId,
        title: entry.runTitle ?? "Actual run",
        plannedMileage: 0,
        plannedWorkoutId: null,
        workout: null,
        log: entry,
        isAdditionalRun: true,
      }));

    const pendingEntries: RunEntry[] = (pendingExtraRuns[day.dayOfWeek] ?? [])
      .filter((runId) => !additionalEntries.some((entry) => entry.runId === runId))
      .map((runId) => ({
        runId,
        title: "Actual run",
        plannedMileage: 0,
        plannedWorkoutId: null,
        workout: null,
        log: undefined,
        isAdditionalRun: true,
      }));

    return [...plannedEntries, ...additionalEntries, ...pendingEntries];
  };

  return (
    <div
      data-current-week-card={highlightCurrentWeek ? "true" : undefined}
      className={`scroll-mt-24 overflow-hidden rounded-xl border shadow-sm ${
      isCurrentWeek
        ? "border-green-300 bg-green-50/30"
        : isNextWeek
        ? "border-sky-300 bg-sky-50/30"
        : "border-gray-200 bg-white"
    }`}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-gray-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${
              week.isDownWeek ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
            }`}>
              Week {week.weekNumber}
            </span>
            {isCurrentWeek && (
              <span className="rounded-full bg-green-600 px-2 py-1 text-xs font-bold text-white">
                Current Week
              </span>
            )}
            {isNextWeek && (
              <span className="rounded-full bg-sky-600 px-2 py-1 text-xs font-bold text-white">
                Next Week
              </span>
            )}
            <span className="text-sm font-medium text-gray-800">
              Starts {formatShortDate(week.startDate)}
            </span>
            <span className="text-xs font-semibold text-enduro-700">{phaseDetail.shortLabel}</span>
            {week.isDownWeek && (
              <span className="text-xs text-green-600">Recovery Week</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="font-medium">
              {formatMiles(adjustedMileage)} mi total
            </span>
            <span>Long {formatMiles(week.longRunDistance)} mi</span>
            <span className="rounded bg-green-50 px-2 py-1 text-green-700">
              Easy {formatMiles(week.intensityDistribution.easy)} mi
            </span>
            {qualityTotals.map((item) => (
              <span key={item.label} className={`rounded px-2 py-1 ${item.className}`}>
                {item.label} {formatMiles(item.value)} mi
              </span>
            ))}
            {actualMileage !== null && variancePct !== null && (
              <span className={`rounded px-2 py-1 ${varianceClass}`}>
                Actual {formatMiles(actualMileage)} mi ({variancePct > 0 ? "+" : ""}{variancePct}%)
              </span>
            )}
          </div>
        </div>
        {activeIntensityRows.length > 0 && (
          <div className="hidden shrink-0 flex-col items-end gap-1 md:flex">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">At target</span>
            <div className="flex flex-wrap justify-end gap-1">
              {activeIntensityRows.filter(r => r.targetMiles > 0 || r.actualMiles > 0).map((row) => (
                <span key={row.key} className={`rounded px-2 py-1 text-xs ${row.className}`}>
                  {row.shortLabel} {formatMiles(row.actualMiles)} / {formatMiles(row.targetMiles)} mi
                </span>
              ))}
            </div>
          </div>
        )}
        <span className={`text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-4">
          {/* Phase badge */}
          <div className="mt-3 mb-2">
            <span className="rounded-full bg-enduro-100 px-2 py-1 text-xs font-medium text-enduro-700">
              {phaseDetail.fullLabel}
            </span>
          </div>

          {activeIntensityRows.length > 0 && (
            <div className="my-3 grid grid-cols-2 gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 md:grid-cols-3">
              {activeIntensityRows.map((row) => {
                const actualPercent = week.totalMileage > 0 ? (row.actualMiles / week.totalMileage) * 100 : 0;
                const targetMileage = (week.totalMileage * row.targetPercent) / 100;

                return (
                  <label key={row.key} className="block rounded-lg bg-white p-3 shadow-sm">
                    <span className="text-xs font-semibold leading-tight text-gray-700">{row.label}</span>
                    <div className="mt-2 space-y-1 text-[11px] leading-tight text-gray-500">
                      <div>
                        <span className="block font-semibold uppercase tracking-wide text-gray-400">Actual</span>
                        <span className="block">{formatPercent(actualPercent)} ({formatMiles(row.actualMiles)} mi)</span>
                      </div>
                      <div>
                        <span className="block font-semibold uppercase tracking-wide text-gray-400">Target</span>
                        <span className="block">{formatPercent(row.targetPercent)} ({formatMiles(targetMileage)} mi)</span>
                      </div>
                    </div>
                    <input
                      key={`${week.weekNumber}-${row.key}-${actualPercent}`}
                      type="number"
                      min={0}
                      max={30}
                      step={0.5}
                      defaultValue={Math.round(actualPercent * 2) / 2}
                      onBlur={(e) => onIntensityTargetChange(row.key, Number(e.target.value), week.weekNumber)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
                    />
                  </label>
                );
              })}
            </div>
          )}

          {/* Days — apply swaps */}
          <div className="space-y-3 pt-3">
            {orderedDays.map((day) => {
              const runEntries = buildRunEntries(day);
              const dayActualMileage = runEntries.reduce((sum, entry) => sum + (entry.log?.actualMileage ?? 0), 0);
              const dayPlannedMileage = (day.workout?.weeklyMileageContribution ?? 0) + (day.secondaryWorkout?.weeklyMileageContribution ?? 0);
              const availableTargetDays = orderedDays
                .filter((candidate) => {
                  if (candidate.dayOfWeek === day.dayOfWeek) return true;
                  const occupiedSlots = [candidate.workout, candidate.secondaryWorkout].filter(Boolean).length;
                  return occupiedSlots < 2;
                })
                .map((candidate) => candidate.dayOfWeek);

              return (
                <div
                  key={day.dayOfWeek}
                  data-current-day={isToday(day.dayOfWeek) ? "true" : undefined}
                  data-current-week={highlightCurrentWeek ? "true" : undefined}
                  data-focus-day={Boolean(focusDate && toDateKey(day.date) === focusDate) ? "true" : undefined}
                  className="grid scroll-mt-24 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-100 lg:grid-cols-[6.5rem_1fr]"
                >
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    {isToday(day.dayOfWeek) && (
                      <span className="mb-1 inline-block rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        Today
                      </span>
                    )}
                    {isTomorrow(day.dayOfWeek) && (
                      <span className="mb-1 inline-block rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        Tomorrow
                      </span>
                    )}
                    <p className="text-xs font-medium text-gray-500">{day.dayOfWeek.slice(0, 3)}</p>
                    <p className="text-xs text-gray-400">{formatShortDate(day.date)}</p>
                    <p className="mt-3 text-[11px] text-gray-500">
                      Planned {formatMiles(dayPlannedMileage)} mi
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Actual {formatMiles(dayActualMileage)} mi
                    </p>
                  </div>
                  <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    {runEntries.length === 0 ? (
                      <p className="text-sm text-gray-400">Rest</p>
                    ) : (
                      runEntries.map((entry, index) => {
                        const actualMileage = entry.log?.actualMileage ?? 0;
                        const draft = runDrafts[entry.runId] ?? createDefaultRunDraft(entry.plannedMileage);
                        const isLastEntry = index === runEntries.length - 1;
                        const editor = entry.workout
                          ? (runEditors[entry.runId] ?? {
                              title: entry.workout.title,
                              totalDistance: entry.workout.totalDistance,
                              estimatedDuration: entry.workout.estimatedDuration,
                              targetDayOfWeek: day.dayOfWeek,
                            })
                          : null;

                        return (
                          <div key={entry.runId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <button
                                type="button"
                                disabled={!entry.workout}
                                onClick={() => entry.workout && initializeRunEditor(entry.runId, entry.workout, day.dayOfWeek)}
                                className={`min-w-0 flex-1 text-left ${entry.workout ? "cursor-pointer" : "cursor-default"}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{entry.workout ? workoutEmoji[entry.workout.type] ?? "🏃" : "➕"}</span>
                                  <div className="min-w-0">
                                    <p className={`truncate text-sm font-medium ${entry.workout ? workoutColor[entry.workout.type] ?? "text-gray-700" : "text-gray-700"}`}>
                                      {entry.title}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      Planned {formatMiles(entry.plannedMileage)} mi
                                      {entry.log ? ` · Actual ${formatMiles(actualMileage)} mi` : ""}
                                    </p>
                                  </div>
                                </div>
                              </button>
                              {entry.workout && (
                                <select
                                  defaultValue=""
                                  aria-label={`Swap workout for ${day.dayOfWeek}`}
                                  className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
                                  onChange={(e) => {
                                    const selectedType = e.target.value as WorkoutType;
                                    if (!selectedType) return;
                                    window.dispatchEvent(
                                      new CustomEvent("workout-swap", {
                                        detail: { dayOfWeek: day.dayOfWeek, workoutType: selectedType },
                                      })
                                    );
                                  }}
                                >
                                  <option value="" disabled>↻ Swap</option>
                                  {swapOptions.map((opt) => (
                                    <option key={opt.type} value={opt.type}>
                                      {opt.emoji} {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>

                            {entry.workout && (
                              <>
                                <p className="mt-2 text-xs text-gray-500">
                                  {entry.workout.totalDistance > 0 ? `${entry.workout.totalDistance} mi · ` : ""}
                                  {Math.floor(entry.workout.estimatedDuration / 60)}h {entry.workout.estimatedDuration % 60}min
                                </p>
                                {renderWorkoutSegments(entry.workout)}
                              </>
                            )}

                            {editingRunId === entry.runId && entry.workout && editor && (
                              <div className="mt-3 grid gap-2 rounded-lg border border-enduro-100 bg-enduro-50 p-3 sm:grid-cols-2">
                                <label className="block sm:col-span-2">
                                  <span className="text-xs font-medium text-gray-600">Title</span>
                                  <input
                                    type="text"
                                    value={editor.title}
                                    onChange={(e) =>
                                      setRunEditors((prev) => ({
                                        ...prev,
                                        [entry.runId]: { ...editor, title: e.target.value },
                                      }))
                                    }
                                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-xs font-medium text-gray-600">Distance</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.1}
                                    value={editor.totalDistance}
                                    onChange={(e) =>
                                      setRunEditors((prev) => ({
                                        ...prev,
                                        [entry.runId]: { ...editor, totalDistance: Number(e.target.value) || 0 },
                                      }))
                                    }
                                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-xs font-medium text-gray-600">Duration (min)</span>
                                  <input
                                    type="number"
                                    min={0}
                                    step={5}
                                    value={editor.estimatedDuration}
                                    onChange={(e) =>
                                      setRunEditors((prev) => ({
                                        ...prev,
                                        [entry.runId]: { ...editor, estimatedDuration: Number(e.target.value) || 0 },
                                      }))
                                    }
                                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                                  />
                                </label>
                                <label className="block sm:col-span-2">
                                  <span className="text-xs font-medium text-gray-600">Shift to day</span>
                                  <select
                                    value={editor.targetDayOfWeek}
                                    onChange={(e) =>
                                      setRunEditors((prev) => ({
                                        ...prev,
                                        [entry.runId]: { ...editor, targetDayOfWeek: e.target.value },
                                      }))
                                    }
                                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                                  >
                                    {availableTargetDays.map((dayOption) => (
                                      <option key={dayOption} value={dayOption}>
                                        {dayOption}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="flex gap-2 sm:col-span-2">
                                  <button
                                    type="button"
                                    onClick={() => saveRunEdit(entry.runId)}
                                    className="rounded bg-enduro-600 px-3 py-1.5 text-xs font-medium text-white"
                                  >
                                    Save plan change
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingRunId(null)}
                                    className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {entry.log ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                                <span className="rounded bg-green-50 px-2 py-1 text-green-700">
                                  Actual {formatMiles(entry.log.actualMileage)} mi
                                </span>
                                <span>Feel {entry.log.feelRating}/10</span>
                                {entry.log.notes && <span className="text-gray-500">{entry.log.notes}</span>}
                                <button
                                  type="button"
                                  onClick={() => removeRunLog(day, entry.runId)}
                                  className="rounded border border-red-200 bg-white px-2 py-1 font-medium text-red-600 hover:bg-red-50"
                                >
                                  Remove
                                </button>
                                {isLastEntry && (
                                  <button
                                    type="button"
                                    onClick={() => addAdditionalRun(day.dayOfWeek)}
                                    className="rounded border border-enduro-200 bg-enduro-50 px-2 py-1 font-medium text-enduro-700 hover:bg-enduro-100"
                                  >
                                    Add actual run
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="mt-3">
                                <DailyLogControls
                                  draft={draft}
                                  plannedMileage={entry.plannedMileage}
                                  onDraftChange={(patch) => updateRunDraft(entry.runId, entry.plannedMileage, patch)}
                                  onSave={() => saveRunLog(day, entry, draft)}
                                  onCancel={entry.isAdditionalRun ? () => cancelAdditionalRun(day.dayOfWeek, entry.runId) : undefined}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    {!runEntries.some((entry) => entry.isAdditionalRun && !entry.log) && !runEntries.some((entry) => entry.log) && (
                      <button
                        type="button"
                        onClick={() => addAdditionalRun(day.dayOfWeek)}
                        className="rounded border border-enduro-200 bg-enduro-50 px-3 py-2 text-xs font-medium text-enduro-700 hover:bg-enduro-100"
                      >
                        Add actual run
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Intensity breakdown */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="rounded bg-green-50 px-2 py-1">
              Easy: {formatMiles(week.intensityDistribution.easy)} mi
            </span>
            {intensityRows.map((row) => (
              <span key={row.key} className={`rounded px-2 py-1 ${row.className}`}>
                {row.shortLabel}: {formatMiles(row.actualMiles)} mi at target {formatMiles(row.targetMiles)} mi
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
