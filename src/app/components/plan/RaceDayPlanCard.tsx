"use client";

// ============================================================
// EnduroLab — Race Day Plan Card
// ============================================================
// Displays the mile-by-mile split sheet, nutrition cues,
// pre-race routine, and weather adjustments.
// ============================================================

import { useState } from "react";
import { RaceDayPlan } from "@/lib/training/models";
import { formatPace, formatTime } from "@/lib/training/models";

interface RaceDayPlanCardProps {
  plan: RaceDayPlan;
}

const TABS = ["splits", "nutrition", "pre-race", "weather"] as const;
type Tab = (typeof TABS)[number];

export default function RaceDayPlanCard({ plan }: RaceDayPlanCardProps) {
  const [activeTab, setActiveTab] = useState<Tab>("splits");

  const goalFormatted = formatTime({
    hours: Math.floor(plan.goalTime / 60),
    minutes: Math.floor(plan.goalTime % 60),
    seconds: 0,
  });

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900">🏁 Race Day Plan</h3>
        <p className="mt-1 text-sm text-gray-500">
          {plan.raceDate} · Goal: {goalFormatted} · Pace: {formatPace(plan.goalPace)}/mi
        </p>
        <p className="text-xs text-gray-400 capitalize">{plan.pacingStrategy} pacing strategy</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "bg-white text-enduro-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "splits" ? "Splits" : tab === "nutrition" ? "Nutrition" : tab === "pre-race" ? "Pre-Race" : "Weather"}
          </button>
        ))}
      </div>

      {/* Splits Tab */}
      {activeTab === "splits" && (
        <div className="space-y-1">
          {/* Half markers */}
          <div className="mb-2 grid grid-cols-[40px_1fr_1fr_1fr_1fr] gap-2 text-xs font-medium text-gray-400">
            <span>Mile</span>
            <span>Pace</span>
            <span>Time</span>
            <span>Effort</span>
            <span>Notes</span>
          </div>
          {plan.splits.map((split) => (
            <div
              key={split.mile}
              className={`grid grid-cols-[40px_1fr_1fr_1fr_1fr] gap-2 rounded-lg px-3 py-2 text-sm ${
                split.mile === 13
                  ? "bg-amber-50 border border-amber-200"
                  : split.mile === 20
                  ? "bg-red-50 border border-red-100"
                  : split.mile === 26.2
                  ? "bg-enduro-50 border border-enduro-200"
                  : "hover:bg-gray-50"
              }`}
            >
              <span className="font-mono font-bold text-gray-900">{split.mile <= 26 ? split.mile : "26.2"}</span>
              <span className="font-mono text-gray-700">{formatPace(split.targetPace)}</span>
              <span className="font-mono text-gray-600">
                {formatTime({
                  hours: Math.floor(split.targetTime / 60),
                  minutes: Math.floor(split.targetTime % 60),
                  seconds: Math.round((split.targetTime % 1) * 60),
                })}
              </span>
              <span className="text-gray-600">{split.effort}</span>
              <span className="text-xs text-gray-400">{split.notes || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nutrition Tab */}
      {activeTab === "nutrition" && (
        <div className="space-y-3">
          {plan.nutritionPlan.map((cue, i) => (
            <div key={i} className="flex gap-3">
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                cue.type === "fuel" ? "bg-orange-100 text-orange-700" :
                cue.type === "fluid" ? "bg-blue-100 text-blue-700" :
                "bg-green-100 text-green-700"
              }`}>
                {cue.type === "fuel" ? "🍌" : cue.type === "fluid" ? "💧" : "🧂"}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {cue.mile === 0 ? "Pre-race" : `Mile ${cue.mile}`}
                </p>
                <p className="text-sm text-gray-600">{cue.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pre-Race Tab */}
      {activeTab === "pre-race" && (
        <div className="space-y-3">
          {plan.preRaceRoutine.map((cue, i) => {
            const hours = Math.floor(cue.timeBeforeStart / 60);
            const mins = cue.timeBeforeStart % 60;
            const timeLabel = cue.timeBeforeStart >= 60
              ? `${hours}h ${mins > 0 ? `${mins}m` : ""} before`
              : `${mins} min before`;

            return (
              <div key={i} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-enduro-100 text-sm font-bold text-enduro-700">
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{timeLabel}</p>
                  <p className="text-sm text-gray-600">{cue.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Weather Tab */}
      {activeTab === "weather" && (
        <div className="space-y-3">
          {plan.weatherAdjustments.map((adj, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {adj.condition === "Temperature" ? "🌡️" :
                   adj.condition === "High temperature" ? "☀️" :
                   adj.condition === "Cold temperature" ? "❄️" :
                   adj.condition === "Extreme cold" ? "🥶" :
                   "💨"}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{adj.condition}</p>
                  <p className="text-sm text-gray-600">{adj.adjustment}</p>
                </div>
              </div>
              {adj.paceDelta > 0 && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  +{adj.paceDelta}s/mile adjustment
                </p>
              )}
            </div>
          ))}
          <p className="text-xs text-gray-400">
            * Weather data is a placeholder — integrate with a weather API for real-time forecasts
          </p>
        </div>
      )}
    </div>
  );
}
