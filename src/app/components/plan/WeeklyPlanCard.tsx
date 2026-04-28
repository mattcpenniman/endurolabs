"use client";

// ============================================================
// EnduroLab — Weekly Plan Card
// ============================================================
// Collapsible card showing a single week&apos;s schedule with
// daily workouts, mileage totals, and phase indicator.
// ============================================================

import React from "react";
import { useState } from "react";
import { WeeklyPlan, DailyPlan } from "@/lib/training/models";

interface WeeklyPlanCardProps {
  week: WeeklyPlan;
  isExpanded: boolean;
  onToggle: () => void;
}

const workoutEmoji: Record<string, string> = {
  easy: "🏃",
  recovery: "🚶",
  threshold: "🔥",
  marathon_pace: "🎯",
  vo2: "⚡",
  long: "🦵",
  progression: "📈",
  strength: "💪",
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
  rest: "text-gray-400",
};

function renderDay(day: DailyPlan) {
  if (day.isRestDay || !day.workout) {
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
          <span className="text-lg">{workoutEmoji[day.workout.type] ?? "🏃"}</span>
          <div className="flex-1">
            <p className={`text-sm font-medium ${workoutColor[day.workout.type] ?? "text-gray-700"}`}>
              {day.workout.title}
            </p>
            <p className="text-xs text-gray-500">
              {day.workout.totalDistance > 0 ? `${day.workout.totalDistance} mi · ` : ""}
              {Math.floor(day.workout.estimatedDuration / 60)}h {day.workout.estimatedDuration % 60}min
            </p>
          </div>
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
            {week.totalMileage} mi · Long: {week.longRunDistance} mi
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

          {/* Days */}
          <div className="divide-y divide-gray-50">
            {week.days.map(renderDay)}
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
