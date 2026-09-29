"use client";

// ============================================================
// EnduroLab — Impact Beacon Card
// ============================================================
// Shows where the athlete stands plan vs actual on the readiness
// metrics and highlights the largest behind-plan gap that the
// validation table allows to be presented as impact. Rejected
// metrics are shown as context only.
// ============================================================

import React, { useEffect, useState } from "react";
import type {
  ImpactBeaconMetricStatus,
  ImpactBeaconReport,
} from "@/lib/analytics/impact-beacon";
import {
  formatGoalPace,
  formatGoalTime,
  formatHeartRateTargets,
  formatPowerTargets,
} from "@/app/components/plan/beacon-format";

interface ImpactBeaconCardProps {
  planId: string;
  refreshToken?: number;
}

const directionLabel: Record<ImpactBeaconMetricStatus["direction"], string> = {
  behind: "Behind",
  on_track: "On track",
  ahead: "Ahead",
  no_data: "No data",
};

const directionClass: Record<ImpactBeaconMetricStatus["direction"], string> = {
  behind: "bg-amber-50 text-amber-700",
  on_track: "bg-green-50 text-green-700",
  ahead: "bg-green-50 text-green-700",
  no_data: "bg-gray-100 text-gray-600",
};

const tierLabel: Record<ImpactBeaconMetricStatus["tier"], string> = {
  validated: "Validated",
  provisional: "Provisional",
  rejected: "Context only",
};

const tierClass: Record<ImpactBeaconMetricStatus["tier"], string> = {
  validated: "bg-emerald-50 text-emerald-700",
  provisional: "bg-sky-50 text-sky-700",
  rejected: "bg-gray-100 text-gray-500",
};

const unitLabel: Record<ImpactBeaconMetricStatus["unit"], string> = {
  miles: "mi",
  minutes: "min",
  count: "",
  weeks: "wk",
};

function formatValue(value: number | null, unit: ImpactBeaconMetricStatus["unit"]): string {
  if (value === null) return "—";
  const rounded = Number.isInteger(value) ? `${value}` : value.toFixed(1);
  return unitLabel[unit] ? `${rounded} ${unitLabel[unit]}` : rounded;
}

function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ImpactBeaconCard({ planId, refreshToken = 0 }: ImpactBeaconCardProps) {
  const [report, setReport] = useState<ImpactBeaconReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/plan/${planId}/impact-beacon`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ImpactBeaconReport | null) => {
        if (!active) return;
        setReport(data);
        setFailed(data === null);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [planId, refreshToken]);

  if (failed) return null;

  const isOpeningBlock = report?.mode === "opening_block" && report.baseline !== null;

  if (report === null) {
    return (
      <div className="mb-6 rounded-lg border border-gray-200 bg-white px-5 py-4">
        <h3 className="text-lg font-semibold text-gray-900">Impact Beacon</h3>
        <p className="mt-1 text-sm text-gray-500">Loading plan-vs-actual readiness...</p>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900">Impact Beacon</h3>
          {isOpeningBlock && report.baseline && (
            <span className="rounded bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
              Pre-plan
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {isOpeningBlock && report.baseline
            ? `Plan starts ${formatDate(report.baseline.plannedStart)}. Comparing the plan's first `
              + `${report.baseline.weeks} week${report.baseline.weeks === 1 ? "" : "s"} with your `
              + `trailing ${report.baseline.weeks} week${report.baseline.weeks === 1 ? "" : "s"} `
              + `through ${formatDate(report.baseline.actualEnd)}.`
            : "Plan vs actual on the readiness metrics, beaming the largest gap that validation supports as impact."}
        </p>
      </div>

      <div className={`mx-5 mt-5 rounded-lg p-4 ${report.beacon ? "bg-amber-50" : "bg-green-50"}`}>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${report.beacon ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
            {report.beacon ? "Largest gap" : isOpeningBlock ? "Ready" : "On track"}
          </span>
        </div>
        <p className={`mt-2 text-sm font-medium ${report.beacon ? "text-amber-900" : "text-green-900"}`}>
          {report.summary}
        </p>
        {report.beacon && (
          <p className="mt-1 text-xs text-amber-800">{report.beacon.evidence}</p>
        )}
      </div>

      <div className="mx-5 mt-4 grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Goal</p>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {report.targets.goalSeconds !== null ? formatGoalTime(report.targets.goalSeconds) : "—"}
            {report.targets.goalPaceMinutesPerMile !== null
              ? ` · ${formatGoalPace(report.targets.goalPaceMinutesPerMile)}`
              : ""}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Heart rate</p>
          <p className="mt-1 text-sm text-gray-700">{formatHeartRateTargets(report.targets.heartRate)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Power</p>
          <p className="mt-1 text-sm text-gray-700">
            {report.targets.power
              ? formatPowerTargets(report.targets.power)
              : "Not configured on this plan"}
          </p>
          {report.targets.powerBasis?.source === "measured" && (
            <p className="mt-1 text-xs text-gray-500">{report.targets.powerBasis.note}</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1.8fr_1fr_1fr_1fr] gap-3 border-b border-gray-100 bg-gray-50 px-5 py-3 text-xs font-semibold uppercase text-gray-500">
        <span>Metric</span>
        <span>Plan</span>
        <span>Actual</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-gray-100">
        {report.metrics.map((metric) => (
          <div key={metric.key} className="grid grid-cols-[1.8fr_1fr_1fr_1fr] gap-3 px-5 py-3 text-sm">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-gray-900">{metric.label}</p>
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tierClass[metric.tier]}`}>
                  {tierLabel[metric.tier]}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">{metric.evidence}</p>
            </div>
            <p className="text-gray-700">{formatValue(metric.planned, metric.unit)}</p>
            <p className="text-gray-700">{formatValue(metric.actual, metric.unit)}</p>
            <div>
              <span className={`rounded px-2 py-1 text-xs font-semibold ${directionClass[metric.direction]}`}>
                {directionLabel[metric.direction]}
              </span>
              <p className="mt-2 text-xs text-gray-500">{formatPercent(metric.completionRatio)} of plan</p>
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
        Only validated or provisional metrics can be the beacon. Context-only rows are shown for
        transparency and are never presented as impact.
      </p>
    </div>
  );
}