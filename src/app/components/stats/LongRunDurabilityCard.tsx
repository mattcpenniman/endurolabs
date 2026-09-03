// ============================================================
// EnduroLab - Long-Run Durability Summary
// ============================================================

"use client";

import React from "react";

export type DurabilityClassification = "steady" | "progression" | "structured";

export interface DurabilityActivity {
  activityId: string;
  activityName: string;
  localDate: string;
  classification: DurabilityClassification;
  powerRetention: number | null;
  paceRetention: number;
  heartRateDrift: number;
  usableMinutes: number;
}

interface LongRunDurabilityCardProps {
  current: DurabilityActivity[];
  prior: DurabilityActivity[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function metric(value: number | null, suffix = "%"): string {
  return value === null ? "--" : `${value.toFixed(1)}${suffix}`;
}

function classificationTone(classification: DurabilityClassification): string {
  if (classification === "steady") return "bg-enduro-50 text-enduro-700";
  if (classification === "progression") return "bg-blue-50 text-blue-700";
  return "bg-violet-50 text-violet-700";
}

export default function LongRunDurabilityCard({ current, prior }: LongRunDurabilityCardProps): React.ReactNode {
  const steady = current.filter((activity) => activity.classification === "steady");
  const priorSteady = prior.filter((activity) => activity.classification === "steady");
  const recent = [...current].sort((a, b) => b.localDate.localeCompare(a.localDate)).slice(0, 6);
  const paceMedian = median(steady.map((activity) => activity.paceRetention));
  const powerMedian = median(steady.flatMap((activity) => activity.powerRetention === null ? [] : [activity.powerRetention]));
  const heartRateMedian = median(steady.map((activity) => activity.heartRateDrift));
  const priorPaceMedian = median(priorSteady.map((activity) => activity.paceRetention));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Long-run durability</h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Final-quarter output compared with the first three quarters. Retention near 100% and low heart-rate drift indicate a durable finish.
          </p>
        </div>
        <span className="text-xs text-gray-400">Power is measured only</span>
      </div>

      {current.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">
          No matched long runs with at least 60 minutes and sufficient pace and heart-rate coverage yet.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric label="Pace retention" value={metric(paceMedian)} />
            <SummaryMetric label="Power retention" value={metric(powerMedian)} />
            <SummaryMetric label="HR drift" value={heartRateMedian === null ? "--" : `${heartRateMedian > 0 ? "+" : ""}${metric(heartRateMedian)}`} />
          </div>
          <p className="text-xs text-gray-500">
            Medians use {steady.length} steady {steady.length === 1 ? "long run" : "long runs"}; progression and structured sessions are shown but excluded.
            {priorPaceMedian !== null && <> Prior steady pace retention: <span className="font-medium tabular-nums text-gray-700">{metric(priorPaceMedian)}</span>.</>}
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <div className="grid min-w-[680px] grid-cols-[72px_1fr_92px_90px_90px_76px] gap-3 bg-gray-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              <span>Date</span><span>Run</span><span>Type</span><span className="text-right">Pace</span><span className="text-right">Power</span><span className="text-right">HR drift</span>
            </div>
            <div className="divide-y divide-gray-100">
              {recent.map((activity) => (
                <div key={activity.activityId} className="grid min-w-[680px] grid-cols-[72px_1fr_92px_90px_90px_76px] items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="tabular-nums text-gray-500">{activity.localDate.slice(5)}</span>
                  <span className="min-w-0 truncate text-gray-700" title={activity.activityName}>
                    {activity.activityName} <span className="text-xs text-gray-400">({activity.usableMinutes} min)</span>
                  </span>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${classificationTone(activity.classification)}`}>
                    {activity.classification}
                  </span>
                  <span className="text-right font-medium tabular-nums text-gray-900">{metric(activity.paceRetention)}</span>
                  <span className="text-right font-medium tabular-nums text-gray-900">{metric(activity.powerRetention)}</span>
                  <span className="text-right font-medium tabular-nums text-gray-900">
                    {activity.heartRateDrift > 0 ? "+" : ""}{metric(activity.heartRateDrift)}
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

function SummaryMetric({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}
