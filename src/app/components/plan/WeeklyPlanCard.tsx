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

interface DayLogDraft {
  actualMileage: number;
  completed: boolean;
  feelRating: number;
  notes: string;
}

function renderDay(
  planId: string,
  weekNumber: number,
  day: DailyPlan,
  isSwapped: boolean,
  log: DailyLog | undefined,
  draft: DayLogDraft,
  onDraftChange: (dayOfWeek: string, patch: Partial<DayLogDraft>) => void,
  onDraftReset: (dayOfWeek: string) => void,
  onSaved: () => void,
  isToday: boolean,
  isTomorrow: boolean,
  highlightCurrentWeek: boolean
) {
  const currentWorkout = day.workout;
  const plannedMileage =
    (currentWorkout?.weeklyMileageContribution ?? 0) +
    (day.secondaryWorkout?.weeklyMileageContribution ?? 0);

  const handleSaveLog = () => {
    addDailyLog(planId, {
      weekNumber,
      date: day.date,
      dayOfWeek: day.dayOfWeek,
      actualMileage: draft.actualMileage,
      completed: true,
      feelRating: draft.feelRating,
      notes: draft.notes,
      loggedAt: new Date().toISOString(),
    });
    onSaved();
  };

  const handleRemoveLog = () => {
    removeDailyLog(planId, weekNumber, day.dayOfWeek);
    onDraftReset(day.dayOfWeek);
    onSaved();
  };

  if (day.isRestDay || !currentWorkout) {
    return (
      <div
        key={day.dayOfWeek}
        data-current-day={isToday ? "true" : undefined}
        data-current-week={highlightCurrentWeek ? "true" : undefined}
        className="grid scroll-mt-24 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-100 lg:grid-cols-[6.5rem_1fr]"
      >
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          {isToday && (
            <span className="mb-1 inline-block rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">
              Today
            </span>
          )}
          {isTomorrow && (
            <span className="mb-1 inline-block rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
              Tomorrow
            </span>
          )}
          <p className="text-xs font-medium text-gray-400">{day.dayOfWeek.slice(0, 3)}</p>
          <p className="text-xs text-gray-400">{formatShortDate(day.date)}</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <p className="text-sm text-gray-400">Rest</p>
          <DailyLogControls
            day={day}
            draft={draft}
            log={log}
            plannedMileage={0}
            onDraftChange={onDraftChange}
            onSave={handleSaveLog}
            onRemove={handleRemoveLog}
          />
        </div>
      </div>
    );
  }

  const hasSecondary = !!day.secondaryWorkout;

  return (
    <div
      key={day.dayOfWeek}
      data-current-day={isToday ? "true" : undefined}
      data-current-week={highlightCurrentWeek ? "true" : undefined}
      className="grid scroll-mt-24 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-100 lg:grid-cols-[6.5rem_1fr]"
    >
      <div className="rounded-lg bg-slate-50 px-3 py-2">
        {isToday && (
          <span className="mb-1 inline-block rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">
            Today
          </span>
        )}
        {isTomorrow && (
          <span className="mb-1 inline-block rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
            Tomorrow
          </span>
        )}
        <p className="text-xs font-medium text-gray-500">{day.dayOfWeek.slice(0, 3)}</p>
        <p className="text-xs text-gray-400">{formatShortDate(day.date)}</p>
      </div>
      <div className="flex-1 space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
        {/* Primary workout */}
        <div className="flex items-center gap-2">
          <span className="text-lg">{workoutEmoji[currentWorkout.type] ?? "🏃"}</span>
          <div className="flex-1">
            <p className={`text-sm font-medium ${workoutColor[currentWorkout.type] ?? "text-gray-700"}`}>
              {currentWorkout.title}
              {isSwapped && <span className="ml-2 text-xs text-gray-400">(swapped)</span>}
            </p>
            <p className="text-xs text-gray-500">
              {currentWorkout.totalDistance > 0 ? `${currentWorkout.totalDistance} mi · ` : ""}
              {Math.floor(currentWorkout.estimatedDuration / 60)}h {currentWorkout.estimatedDuration % 60}min
            </p>
          </div>
          {/* Swap dropdown */}
          <select
            defaultValue=""
            aria-label={`Swap workout for ${day.dayOfWeek}`}
            className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
            onChange={(e) => {
              const selectedType = e.target.value as WorkoutType;
              if (!selectedType) return;

              // Dispatch custom event for swap
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
        </div>
        {renderWorkoutSegments(currentWorkout)}
        {/* Secondary workout (double-day) */}
        {hasSecondary && day.secondaryWorkout && (
          <>
            <div className="flex items-center gap-2 pl-7">
              <span className="text-base">🏃</span>
              <div className="flex-1">
                <p className={`text-sm font-medium ${workoutColor[day.secondaryWorkout.type] ?? "text-gray-700"}`}>
                  {day.secondaryWorkout.title}
                </p>
                <p className="text-xs text-gray-500">
                  {day.secondaryWorkout.totalDistance > 0 ? `${day.secondaryWorkout.totalDistance} mi · ` : ""}
                  {Math.floor(day.secondaryWorkout.estimatedDuration / 60)}h {day.secondaryWorkout.estimatedDuration % 60}min
                </p>
              </div>
            </div>
            {renderWorkoutSegments(day.secondaryWorkout)}
          </>
        )}
        <DailyLogControls
          day={day}
          draft={draft}
          log={log}
          plannedMileage={plannedMileage}
          onDraftChange={onDraftChange}
          onSave={handleSaveLog}
          onRemove={handleRemoveLog}
        />
      </div>
    </div>
  );
}

function DailyLogControls({
  day,
  draft,
  log,
  plannedMileage,
  onDraftChange,
  onSave,
  onRemove,
}: {
  day: DailyPlan;
  draft: DayLogDraft;
  log?: DailyLog;
  plannedMileage: number;
  onDraftChange: (dayOfWeek: string, patch: Partial<DayLogDraft>) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const logButtonLabel = log ? (log.completed ? "Update" : "Mark done") : "Log";

  return (
    <div className="grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-[8rem_8rem_1fr_auto] sm:items-end">
      <label className="block">
        <span className="text-xs font-medium text-gray-500">Actual mi</span>
        <input
          type="number"
          min={0}
          max={40}
          step={0.1}
          value={draft.actualMileage}
          onChange={(e) =>
            onDraftChange(day.dayOfWeek, { actualMileage: parseFloat(e.target.value) || 0 })
          }
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-enduro-500 focus:outline-none focus:ring-1 focus:ring-enduro-500/20"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-gray-500">Feel</span>
        <select
          value={draft.feelRating}
          onChange={(e) => onDraftChange(day.dayOfWeek, { feelRating: parseInt(e.target.value) })}
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
          onChange={(e) => onDraftChange(day.dayOfWeek, { notes: e.target.value })}
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
          {logButtonLabel}
        </button>
        {log && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 sm:col-span-4">
        Planned {plannedMileage} mi{log ? ` · Logged ${log.actualMileage} mi` : ""}
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
}: WeeklyPlanCardProps) {
  // Track swapped workouts by day-of-week key
  const [swappedWorkouts, setSwappedWorkouts] = useState<Record<string, Workout | null>>({});
  const [drafts, setDrafts] = useState<Record<string, DayLogDraft>>({});
  const orderedDays = useMemo(
    () => [...week.days].sort((a, b) => dayDisplayOrder[a.dayOfWeek] - dayDisplayOrder[b.dayOfWeek]),
    [week.days]
  );

  // Listen for swap events from child renders
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { dayOfWeek, workoutType } = customEvent.detail as { dayOfWeek: string; workoutType: WorkoutType };

      setSwappedWorkouts((prev) => {
        // Create a placeholder workout for the swap
        let swapped: Workout | null = null;
        switch (workoutType) {
          case "easy":
            swapped = {
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
            swapped = {
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
            swapped = {
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
            swapped = {
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
            swapped = null;
            break;
          default:
            swapped = null;
        }

        return { ...prev, [dayOfWeek]: swapped };
      });
    };

    window.addEventListener("workout-swap", handler);
    return () => window.removeEventListener("workout-swap", handler);
  }, []);

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      orderedDays.forEach((day) => {
        const log = dailyLogs.find(
          (entry) => entry.weekNumber === week.weekNumber && entry.dayOfWeek === day.dayOfWeek
        );
        const plannedMileage =
          (day.workout?.weeklyMileageContribution ?? 0) +
          (day.secondaryWorkout?.weeklyMileageContribution ?? 0);
        next[day.dayOfWeek] = {
          actualMileage: log?.actualMileage ?? plannedMileage,
          completed: log?.completed ?? false,
          feelRating: log?.feelRating ?? 5,
          notes: log?.notes ?? "",
        };
      });
      return next;
    });
  }, [dailyLogs, orderedDays]);

  const updateDraft = (dayOfWeek: string, patch: Partial<DayLogDraft>) => {
    setDrafts((prev) => {
      const existing =
        prev[dayOfWeek] ??
        ({
          actualMileage: 0,
          completed: false,
          feelRating: 5,
          notes: "",
        } satisfies DayLogDraft);

      return {
        ...prev,
        [dayOfWeek]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const resetDraft = (dayOfWeek: string) => {
    const day = orderedDays.find((entry) => entry.dayOfWeek === dayOfWeek);
    const plannedMileage =
      (day?.workout?.weeklyMileageContribution ?? 0) +
      (day?.secondaryWorkout?.weeklyMileageContribution ?? 0);

    setDrafts((prev) => ({
      ...prev,
      [dayOfWeek]: {
        actualMileage: plannedMileage,
        completed: false,
        feelRating: 5,
        notes: "",
      },
    }));
  };

  // Recalculate weekly mileage with swaps applied
  const adjustedMileage = week.days.reduce((sum, day) => {
    const workout = swappedWorkouts[day.dayOfWeek] ?? day.workout;
    const secondaryMileage =
      swappedWorkouts[day.dayOfWeek] === null
        ? 0
        : day.secondaryWorkout?.weeklyMileageContribution ?? 0;
    return sum + (workout?.weeklyMileageContribution ?? 0) + secondaryMileage;
  }, 0);
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
              {formatMiles(adjustedMileage)} mi{Object.keys(swappedWorkouts).length > 0 ? " adjusted" : ""} total
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
              const swapped = swappedWorkouts[day.dayOfWeek];
              const effectiveWorkout = swapped !== undefined ? swapped : day.workout;
              const isSwapped = swapped !== undefined;
              const adjustedDay: DailyPlan = {
                ...day,
                workout: effectiveWorkout,
                isRestDay: swapped === null,
              };
              const log = dailyLogs.find(
                (entry) => entry.weekNumber === week.weekNumber && entry.dayOfWeek === day.dayOfWeek
              );
              const plannedMileage =
                (adjustedDay.workout?.weeklyMileageContribution ?? 0) +
                (adjustedDay.secondaryWorkout?.weeklyMileageContribution ?? 0);
              const draft = drafts[day.dayOfWeek] ?? {
                actualMileage: log?.actualMileage ?? plannedMileage,
                completed: log?.completed ?? false,
                feelRating: log?.feelRating ?? 5,
                notes: log?.notes ?? "",
              };
              return renderDay(
                planId,
                week.weekNumber,
                adjustedDay,
                isSwapped,
                log,
                draft,
                updateDraft,
                resetDraft,
                onDailyLogSaved,
                isToday(day.dayOfWeek),
                isTomorrow(day.dayOfWeek),
                highlightCurrentWeek
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
