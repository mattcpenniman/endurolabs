"use client";

// ============================================================
// EnduroLab — Weekly Plan Card
// ============================================================
// Collapsible card showing a single week's schedule with
// daily workouts, mileage totals, and phase indicator.
// Supports client-side workout swapping.
// ============================================================

import React from "react";
import { useState, useEffect } from "react";
import { WeeklyPlan, DailyPlan, Workout, WorkoutType } from "@/lib/training/models";

interface WeeklyPlanCardProps {
  week: WeeklyPlan;
  isExpanded: boolean;
  onToggle: () => void;
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

function renderDay(day: DailyPlan, isSwapped: boolean) {
  const currentWorkout = day.workout;

  if (day.isRestDay || !currentWorkout) {
    return (
      <div key={day.dayOfWeek} className="flex items-center gap-3 py-2">
        <span className="w-16 text-xs font-medium text-gray-400">{day.dayOfWeek.slice(0, 3)}</span>
        <span className="text-sm text-gray-400">Rest</span>
      </div>
    );
  }

  const hasSecondary = !!day.secondaryWorkout;

  return (
    <div key={day.dayOfWeek} className="flex items-start gap-3 py-2">
      <span className="w-16 shrink-0 text-xs font-medium text-gray-500 pt-0.5">{day.dayOfWeek.slice(0, 3)}</span>
      <div className="flex-1 space-y-1">
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
      </div>
    </div>
  );
}

export default function WeeklyPlanCard({ week, isExpanded, onToggle }: WeeklyPlanCardProps) {
  // Track swapped workouts by day-of-week key
  const [swappedWorkouts, setSwappedWorkouts] = useState<Record<string, Workout | null>>({});

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

  // Recalculate weekly mileage with swaps applied
  const adjustedMileage = week.days.reduce((sum, day) => {
    const workout = swappedWorkouts[day.dayOfWeek] ?? day.workout;
    return sum + (workout?.weeklyMileageContribution ?? 0);
  }, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4 hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${
            week.isDownWeek ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
          }`}>
            Week {week.weekNumber}
          </span>
          <span className="text-sm font-medium text-gray-700">
            {adjustedMileage} mi{Object.keys(swappedWorkouts).length > 0 ? " (adjusted)" : ""} · Long: {week.longRunDistance} mi
          </span>
          {week.isDownWeek && (
            <span className="text-xs text-green-600">Recovery Week</span>
          )}
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
            {week.days.map((day) => {
              const swapped = swappedWorkouts[day.dayOfWeek];
              const effectiveWorkout = swapped !== undefined ? swapped : day.workout;
              const isSwapped = swapped !== undefined;
              const adjustedDay: DailyPlan = {
                ...day,
                workout: effectiveWorkout,
                isRestDay: swapped === null,
              };
              return renderDay(adjustedDay, isSwapped);
            })}
          </div>

          {/* Intensity breakdown */}
          <div className="mt-3 flex gap-2 text-xs text-gray-500">
            <span className="rounded bg-green-50 px-2 py-1">Easy: {Math.round(week.intensityDistribution.easy)} mi</span>
            <span className="rounded bg-amber-50 px-2 py-1">Threshold: {Math.round(week.intensityDistribution.threshold)} mi</span>
            <span className="rounded bg-blue-50 px-2 py-1">MP: {Math.round(week.intensityDistribution.marathon)} mi</span>
            <span className="rounded bg-red-50 px-2 py-1">VO2: {Math.round(week.intensityDistribution.vo2)} mi</span>
          </div>
        </div>
      )}
    </div>
  );
}
