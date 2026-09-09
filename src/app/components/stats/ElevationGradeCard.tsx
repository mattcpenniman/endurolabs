// ============================================================
// EnduroLab - Elevation And Grade Card
// ============================================================

"use client";

import React from "react";
import type {
  ElevationGradeAnalysisResult,
  GradeBandResult,
} from "@/lib/analytics/elevation-grade";
import { useUnits } from "@/app/components/units/UnitsProvider";
import {
  formatGrade,
  paceUnitAbbr,
  paceUnitSuffix,
  secondsPerMileForDisplay,
} from "@/lib/units/format";

interface ElevationGradeCardProps {
  current: ElevationGradeAnalysisResult;
  prior: ElevationGradeAnalysisResult;
}

function formatPaceShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export default function ElevationGradeCard({
  current,
  prior,
}: ElevationGradeCardProps): React.ReactNode {
  const { units } = useUnits();
  const hasMeasuredPower = current.bands.some((band) => band.powerWattsMeasured !== null)
    || prior.bands.some((band) => band.powerWattsMeasured !== null);
  const hasData = current.suppressReason === null;

  const bandRow = (result: ElevationGradeAnalysisResult, key: GradeBandResult["key"]): GradeBandResult | undefined =>
    result.bands.find((band) => band.key === key);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Elevation and grade</h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Weekly elevation gain per {paceUnitAbbr(units)} and observed pace, heart rate, and measured power across flat, climbing,
            and descending samples. Grade-adjusted results are suppressed until GPS and elevation coverage qualify.
          </p>
        </div>
        <span className="text-xs text-gray-400">
          {hasMeasuredPower ? "Power is measured only" : "Measured power not available"}
        </span>
      </div>

      {!hasData ? (
        <div>
          <p className="py-6 text-center text-sm text-gray-500">
            {current.suppressReason ?? "Not enough qualifying elevation data yet."}
          </p>
          {current.totalActivities > 0 && (
            <p className="pb-2 text-center text-xs text-gray-400">
              Checked {current.totalActivities} run{current.totalActivities === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {current.partialNote && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              {current.partialNote}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Gain per {paceUnitAbbr(units)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                {formatGrade(current.elevationGainFeetPerMile, units)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                across {current.qualifyingActivities} qualifying {current.qualifyingActivities === 1 ? "run" : "runs"}
                {current.totalActivities > current.qualifyingActivities
                  ? ` (of ${current.totalActivities} total)`
                  : ""}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Distance</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{current.distanceMiles.toFixed(1)} mi</p>
              {prior.suppressReason === null && (
                <p className="mt-1 text-xs text-gray-500">
                  prior {prior.distanceMiles.toFixed(1)} mi
                </p>
              )}
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Prior gain/{paceUnitAbbr(units)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                {prior.suppressReason === null
                  ? formatGrade(prior.elevationGainFeetPerMile, units)
                  : "--"}
              </p>
            </div>
          </div>

          {current.weeks.length > 0 && (
            <p className="text-xs text-gray-500">
              Weekly trend: {current.weeks
                .map((week) => `W${week.weekNumber} ${formatGrade(week.elevationGainFeetPerMile ?? 0, units)}`)
                .join(" · ")}
              .
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <div className="grid min-w-[560px] grid-cols-[100px_1fr_90px_90px_100px] gap-3 bg-gray-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              <span>Terrain</span>
              <span className="text-right">Pace</span>
              <span className="text-right">HR</span>
              <span className="text-right">Power</span>
              <span className="text-right">Support</span>
            </div>
            <div className="divide-y divide-gray-100">
              {(["flat", "climbing", "descending"] as const).map((key) => {
                const band = bandRow(current, key);
                if (!band) return null;
                return (
                  <div key={key} className="grid min-w-[560px] grid-cols-[100px_1fr_90px_90px_100px] items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="font-medium text-gray-900">{band.label}</span>
                    <span className="text-right font-medium tabular-nums text-gray-900">
                      {band.paceSecondsPerMile === null ? "--" : `${formatPaceShort(secondsPerMileForDisplay(band.paceSecondsPerMile, units))}${paceUnitSuffix(units)}`}
                    </span>
                    <span className="text-right font-medium tabular-nums text-gray-900">
                      {band.heartRate === null ? "--" : `${band.heartRate} bpm`}
                    </span>
                    <span className="text-right font-medium tabular-nums text-gray-900">
                      {band.powerWattsMeasured === null ? "--" : `${band.powerWattsMeasured} W`}
                    </span>
                    <span className="text-right tabular-nums text-gray-500">
                      {band.usableMinutes} min / {band.activityCount}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            A terrain row is shown only when at least two runs contribute eight or more usable minutes; pace
            requires speed, HR requires a heart-rate trace, and power is shown only for measured sensor power.
          </p>
        </div>
      )}
    </section>
  );
}
