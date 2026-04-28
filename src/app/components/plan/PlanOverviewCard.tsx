import React from "react";
// ============================================================
// EnduroLab — Plan Overview Card
// ============================================================
// Displays high-level plan stats: goal time, weeks, peak
// mileage, feasibility rating, and phase breakdown.
// ============================================================

import { MarathonPlan, formatTime, minutesToTime } from "@/lib/training/models";

interface PlanOverviewCardProps {
  plan: MarathonPlan;
}

const feasibilityEmoji: Record<string, string> = {
  realistic: "✅",
  ambitious: "🎯",
  very_ambitious: "🔥",
  unlikely: "⚠️",
};

export default function PlanOverviewCard({ plan }: PlanOverviewCardProps) {
  const goalTime = formatTime(minutesToTime(plan.runnerProfile.goalMarathonTime));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Plan Overview</h3>
        <span className="text-2xl">{feasibilityEmoji[plan.goalAssessment.feasibility]}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Goal Time</p>
          <p className="mt-1 text-2xl font-bold text-enduro-600">{goalTime}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Duration</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{plan.totalWeeks} wks</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Peak Mileage</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{plan.peakWeeklyMileage} mi</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Feasibility</p>
          <p className="mt-1 text-sm font-bold capitalize text-gray-900">
            {plan.goalAssessment.feasibility.replace("_", " ")}
          </p>
        </div>
      </div>

      {/* Phase breakdown */}
      <div className="mt-4 border-t border-gray-100 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Training Phases</p>
        <div className="mt-2 flex gap-2">
          {plan.phases.map((phase) => (
            <div key={phase.name} className="flex-1 rounded-lg bg-gray-50 p-2">
              <p className="text-xs font-semibold text-gray-700">{phase.name}</p>
              <p className="text-[10px] text-gray-500">Weeks {phase.weekRange[0]}&ndash;{phase.weekRange[1]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Risk warnings */}
      {plan.riskWarnings.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-600">Risk Factors</p>
          <ul className="mt-2 space-y-1">
            {plan.riskWarnings.map((warning, i) => (
              <li key={i} className="text-xs text-amber-700">
                ⚠️ {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
