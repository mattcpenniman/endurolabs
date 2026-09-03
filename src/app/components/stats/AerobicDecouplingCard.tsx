// ============================================================
// EnduroLab - Aerobic Decoupling Summary
// ============================================================

"use client";

import React from "react";

export interface DecouplingActivity {
  activityId: string;
  activityName: string;
  localDate: string;
  percentage: number;
  usableMinutes: number;
}

interface AerobicDecouplingCardProps {
  current: DecouplingActivity[];
  prior: DecouplingActivity[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function interpretation(value: number): { label: string; tone: string } {
  if (value < 0) return { label: "No drift", tone: "text-enduro-700 bg-enduro-50" };
  if (value <= 3) return { label: "Minimal drift", tone: "text-enduro-700 bg-enduro-50" };
  if (value <= 5) return { label: "Controlled drift", tone: "text-amber-700 bg-amber-50" };
  return { label: "Elevated drift", tone: "text-red-700 bg-red-50" };
}

function formatPercentage(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function AerobicDecouplingCard({ current, prior }: AerobicDecouplingCardProps): React.ReactNode {
  const currentMedian = median(current.map((activity) => activity.percentage));
  const priorMedian = median(prior.map((activity) => activity.percentage));
  const recent = [...current].sort((a, b) => b.localDate.localeCompare(a.localDate)).slice(0, 5);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Aerobic decoupling</h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Change in power-to-heart-rate efficiency from the first half to the second. Lower is better; 5% or less is generally controlled.
          </p>
        </div>
        <span className="text-xs text-gray-400">Measured power only</span>
      </div>

      {currentMedian === null ? (
        <p className="py-10 text-center text-sm text-gray-500">
          No qualifying steady runs with at least 30 usable minutes yet.
        </p>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[220px_1fr]">
          <div>
            <p className="text-4xl font-bold tabular-nums text-gray-900">{formatPercentage(currentMedian)}</p>
            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${interpretation(currentMedian).tone}`}>
              {interpretation(currentMedian).label}
            </span>
            <p className="mt-3 text-xs text-gray-500">
              Median across {current.length} qualifying {current.length === 1 ? "run" : "runs"}.
            </p>
            {priorMedian !== null && (
              <p className="mt-1 text-xs text-gray-500">
                Prior plan: <span className="font-medium tabular-nums text-gray-700">{formatPercentage(priorMedian)}</span>
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-100">
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 bg-gray-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              <span>Date</span>
              <span>Run</span>
              <span>Drift</span>
            </div>
            <div className="divide-y divide-gray-100">
              {recent.map((activity) => (
                <div key={activity.activityId} className="grid grid-cols-[90px_1fr_auto] gap-3 px-3 py-2.5 text-sm">
                  <span className="tabular-nums text-gray-500">{activity.localDate.slice(5)}</span>
                  <span className="min-w-0 truncate text-gray-700" title={activity.activityName}>
                    {activity.activityName} <span className="text-xs text-gray-400">({activity.usableMinutes} min)</span>
                  </span>
                  <span className={`font-semibold tabular-nums ${activity.percentage <= 5 ? "text-enduro-700" : "text-red-600"}`}>
                    {formatPercentage(activity.percentage)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
