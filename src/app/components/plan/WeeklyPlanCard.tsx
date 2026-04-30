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
import { DailyLog, WeeklyPlan, DailyPlan, Workout, WorkoutType } from "@/lib/training/models";
import { addDailyLog } from "@/lib/training/progress-tracker";

interface WeeklyPlanCardProps {
  planId: string;
  week: WeeklyPlan;
  isExpanded: boolean;
  onToggle: () => void;
  dailyLogs: DailyLog[];
  onDailyLogSaved: () => void;
}

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

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function formatMiles(distance: number): string {
  return Number.isInteger(distance) ? `${distance}` : `${distance.toFixed(2).replace(/0$/, "")}`;
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
  onSaved: () => void
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
      completed: draft.completed,
      feelRating: draft.feelRating,
      notes: draft.notes,
      loggedAt: new Date().toISOString(),
    });
    onSaved();
  };

  if (day.isRestDay || !currentWorkout) {
    return (
      <div key={day.dayOfWeek} className="grid gap-3 py-3 lg:grid-cols-[6rem_1fr]">
        <div>
          <p className="text-xs font-medium text-gray-400">{day.dayOfWeek.slice(0, 3)}</p>
          <p className="text-xs text-gray-400">{formatShortDate(day.date)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-sm text-gray-400">Rest</p>
          <DailyLogControls
            day={day}
            draft={draft}
            log={log}
            plannedMileage={0}
            onDraftChange={onDraftChange}
            onSave={handleSaveLog}
          />
        </div>
      </div>
    );
  }

  const hasSecondary = !!day.secondaryWorkout;

  return (
    <div key={day.dayOfWeek} className="grid gap-3 py-3 lg:grid-cols-[6rem_1fr]">
      <div>
        <p className="text-xs font-medium text-gray-500">{day.dayOfWeek.slice(0, 3)}</p>
        <p className="text-xs text-gray-400">{formatShortDate(day.date)}</p>
      </div>
      <div className="flex-1 space-y-3 rounded-lg border border-gray-100 p-3">
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
        {/* Secondary workout (double-day) */}
        {hasSecondary && day.secondaryWorkout && (
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
        )}
        <DailyLogControls
          day={day}
          draft={draft}
          log={log}
          plannedMileage={plannedMileage}
          onDraftChange={onDraftChange}
          onSave={handleSaveLog}
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
}: {
  day: DailyPlan;
  draft: DayLogDraft;
  log?: DailyLog;
  plannedMileage: number;
  onDraftChange: (dayOfWeek: string, patch: Partial<DayLogDraft>) => void;
  onSave: () => void;
}) {
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
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={draft.completed}
            onChange={(e) => onDraftChange(day.dayOfWeek, { completed: e.target.checked })}
            className="rounded border-gray-300 text-enduro-600 focus:ring-enduro-500"
          />
          Done
        </label>
        <button
          type="button"
          onClick={onSave}
          className="rounded bg-enduro-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-enduro-700"
        >
          {log ? "Update" : "Log"}
        </button>
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

  // Recalculate weekly mileage with swaps applied
  const adjustedMileage = week.days.reduce((sum, day) => {
    const workout = swappedWorkouts[day.dayOfWeek] ?? day.workout;
    const secondaryMileage =
      swappedWorkouts[day.dayOfWeek] === null
        ? 0
        : day.secondaryWorkout?.weeklyMileageContribution ?? 0;
    return sum + (workout?.weeklyMileageContribution ?? 0) + secondaryMileage;
  }, 0);
  const phaseLabel =
    week.phase === "base" ? "Base" : week.phase === "marathon_build" ? "Marathon" : "Taper";
  const qualityTotals = [
    { label: "T", value: week.intensityDistribution.threshold, className: "bg-amber-50 text-amber-700" },
    { label: "MP", value: week.intensityDistribution.marathon, className: "bg-blue-50 text-blue-700" },
    { label: "VO2", value: week.intensityDistribution.vo2, className: "bg-red-50 text-red-700" },
  ].filter((item) => item.value > 0);
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

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
            <span className="text-sm font-medium text-gray-800">
              Starts {formatShortDate(week.startDate)}
            </span>
            <span className="text-xs font-medium text-enduro-700">{phaseLabel}</span>
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
        <span className={`text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-4">
          {/* Phase badge */}
          <div className="mt-3 mb-2">
            <span className="rounded-full bg-enduro-100 px-2 py-1 text-xs font-medium text-enduro-700">
              {week.phase === "base" ? "Base Building" : week.phase === "marathon_build" ? "Marathon Specific" : "Peak & Taper"}
            </span>
          </div>

          {/* Days — apply swaps */}
          <div className="divide-y divide-gray-50">
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
                onDailyLogSaved
              );
            })}
          </div>

          {/* Intensity breakdown */}
          <div className="mt-3 flex gap-2 text-xs text-gray-500">
            <span className="rounded bg-green-50 px-2 py-1">Easy: {formatMiles(week.intensityDistribution.easy)} mi</span>
            <span className="rounded bg-amber-50 px-2 py-1">Threshold: {formatMiles(week.intensityDistribution.threshold)} mi</span>
            <span className="rounded bg-blue-50 px-2 py-1">MP: {formatMiles(week.intensityDistribution.marathon)} mi</span>
            <span className="rounded bg-red-50 px-2 py-1">VO2: {formatMiles(week.intensityDistribution.vo2)} mi</span>
          </div>
        </div>
      )}
    </div>
  );
}
