"use client";

// ============================================================
// EnduroLab — Floating Impact Beacon
// ============================================================
// A fixed lower-right traffic-light indicator that summarizes the
// plan-vs-actual impact beacon on every plan page tab and opens a
// popup with the metric detail. The Score Card panel stays the
// full view; this widget never presents a rejected metric as an
// impact driver (context rows are labeled and never turn it red).
// ============================================================

import React, { useEffect, useRef, useState } from "react";
import {
  impactBeaconLevel,
  type ImpactBeaconLevel,
  type ImpactBeaconMetricStatus,
  type ImpactBeaconReport,
} from "@/lib/analytics/impact-beacon";
import {
  formatGoalPace,
  formatGoalTime,
  formatHeartRateTargets,
  formatPowerTargets,
} from "@/app/components/plan/beacon-format";

interface ImpactBeaconWidgetProps {
  planId: string;
  refreshToken?: number;
  /** Opens the full Score Card tab; omitted when there is no parent tab bar. */
  onOpenDetails?: () => void;
}

const levelButtonClass: Record<ImpactBeaconLevel, string> = {
  red: "bg-red-600 text-white hover:bg-red-500",
  amber: "bg-amber-500 text-amber-950 hover:bg-amber-400",
  green: "bg-green-600 text-white hover:bg-green-500",
};

const levelDotClass: Record<ImpactBeaconLevel, string> = {
  red: "bg-red-200",
  amber: "bg-amber-100",
  green: "bg-green-200",
};

const levelPanelClass: Record<ImpactBeaconLevel, string> = {
  red: "border-red-200",
  amber: "border-amber-200",
  green: "border-green-200",
};

const levelBadgeClass: Record<ImpactBeaconLevel, string> = {
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-green-50 text-green-700",
};

const levelLabel: Record<ImpactBeaconLevel, string> = {
  red: "Behind plan",
  amber: "Watch items",
  green: "On track",
};

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

function formatValue(value: number, unit: ImpactBeaconMetricStatus["unit"]): string {
  const rounded = Number.isInteger(value) ? `${value}` : value.toFixed(1);
  if (unit === "miles") return `${rounded} mi`;
  if (unit === "minutes") return `${rounded} min`;
  if (unit === "weeks") return `${rounded} wk`;
  return rounded;
}

export default function ImpactBeaconWidget({
  planId,
  refreshToken = 0,
  onOpenDetails,
}: ImpactBeaconWidgetProps) {
  const [report, setReport] = useState<ImpactBeaconReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setFailed(false);
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

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  if (failed || report === null) return null;

  const level = impactBeaconLevel(report);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2 print:hidden"
    >
      {open && (
        <div
          role="dialog"
          aria-label="Impact beacon detail"
          className={`w-80 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-xl border bg-white shadow-2xl ${levelPanelClass[level]}`}
        >
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Impact beacon</p>
            <p className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${levelBadgeClass[level]}`}>
              {levelLabel[level]}
            </p>
            <p className="mt-2 text-sm text-gray-700">{report.summary}</p>
          </div>
          <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
            {report.metrics.map((metric) => (
              <div key={metric.key} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{metric.label}</span>
                    {!metric.impactEligible && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        Context
                      </span>
                    )}
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${directionClass[metric.direction]}`}>
                    {directionLabel[metric.direction]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {metric.actual === null
                    ? "No measured data"
                    : `${formatValue(metric.actual, metric.unit)} actual`}
                  {metric.planned !== null ? ` · ${formatValue(metric.planned, metric.unit)} planned` : ""}
                </p>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-600">
            <p>
              <span className="font-semibold text-gray-700">Goal</span>{" "}
              {report.targets.goalSeconds !== null
                ? formatGoalTime(report.targets.goalSeconds)
                : "—"}
              {report.targets.goalPaceMinutesPerMile !== null
                ? ` · ${formatGoalPace(report.targets.goalPaceMinutesPerMile)}`
                : ""}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-gray-700">HR</span>{" "}
              {formatHeartRateTargets(report.targets.heartRate)}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-gray-700">Power</span>{" "}
              {report.targets.power
                ? formatPowerTargets(report.targets.power)
                : "Not configured on this plan"}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
            <p className="text-[11px] text-gray-500">
              {report.mode === "opening_block" && report.baseline
                ? `Plan starts ${report.baseline.plannedStart}; compared with your trailing ${report.baseline.weeks} weeks.`
                : "Plan to date."}
            </p>
            {onOpenDetails && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenDetails();
                }}
                className="shrink-0 text-xs font-semibold text-enduro-700 hover:text-enduro-800"
              >
                Score Card
              </button>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Impact beacon: ${levelLabel[level]}`}
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg transition ${levelButtonClass[level]}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${levelDotClass[level]}`} />
        Impact beacon
      </button>
    </div>
  );
}