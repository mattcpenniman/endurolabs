"use client";

// ============================================================
// EnduroLab — Sub-3 Scorecard
// ============================================================
// Renders objective sub-3 readiness markers for the generated
// plan and logged actuals.
// ============================================================

import React from "react";
import { DailyLog, MarathonPlan } from "@/lib/training/models";
import { buildSub3Scorecard, ScoreStatus } from "@/lib/training/sub3-scorecard";

interface Sub3ScorecardProps {
  plan: MarathonPlan;
  dailyLogs: DailyLog[];
}

const statusLabel: Record<ScoreStatus, string> = {
  earned: "Yes",
  missed: "No",
  untracked: "Not tracked",
};

const statusClass: Record<ScoreStatus, string> = {
  earned: "bg-green-50 text-green-700",
  missed: "bg-gray-100 text-gray-600",
  untracked: "bg-amber-50 text-amber-700",
};

function scoreClass(score: number): string {
  if (score >= 13) return "text-green-700";
  if (score >= 11) return "text-blue-700";
  if (score >= 9) return "text-amber-700";
  return "text-red-700";
}

export default function Sub3Scorecard({ plan, dailyLogs }: Sub3ScorecardProps) {
  const scorecard = buildSub3Scorecard(plan, dailyLogs);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm font-semibold text-gray-700">Planned Score</p>
          <p className={`mt-2 text-4xl font-bold ${scoreClass(scorecard.plan.score)}`}>
            {scorecard.plan.score}/{scorecard.plan.maxScore}
          </p>
          <p className="mt-1 text-sm text-gray-600">{scorecard.plan.interpretation}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm font-semibold text-gray-700">Actual Score</p>
          <p className={`mt-2 text-4xl font-bold ${scoreClass(scorecard.actual.score)}`}>
            {scorecard.actual.score}/{scorecard.actual.maxScore}
          </p>
          <p className="mt-1 text-sm text-gray-600">{scorecard.actual.interpretation}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="grid grid-cols-[1.2fr_1.5fr_1.5fr_1fr_1fr] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase text-gray-500">
          <span>Category</span>
          <span>Objective</span>
          <span>Standard</span>
          <span>Plan</span>
          <span>Actual</span>
        </div>
        <div className="divide-y divide-gray-100">
          {scorecard.rows.map((row) => (
            <div
              key={`${row.category}-${row.objective}`}
              className="grid grid-cols-[1.2fr_1.5fr_1.5fr_1fr_1fr] gap-3 px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-gray-900">{row.category}</p>
              </div>
              <p className="text-gray-700">{row.objective}</p>
              <p className="text-gray-600">{row.standard}</p>
              <div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${statusClass[row.plan.status]}`}>
                  {statusLabel[row.plan.status]}
                </span>
                <p className="mt-2 text-xs text-gray-500">{row.plan.evidence}</p>
              </div>
              <div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${statusClass[row.actual.status]}`}>
                  {statusLabel[row.actual.status]}
                </span>
                <p className="mt-2 text-xs text-gray-500">{row.actual.evidence}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
