import React from "react";
// ============================================================
// EnduroLab — Pace Zones Card
// ============================================================
// Displays the runner's calculated pace zones with color
// coding and RPE effort descriptors.
// ============================================================

import { PaceZones, PowerZones, formatPace } from "@/lib/training/models";

interface PaceZonesCardProps {
  paceZones: PaceZones;
  powerZones?: PowerZones;
}

const zoneColor: Record<string, string> = {
  recovery: "bg-green-100 text-green-800",
  easy: "bg-emerald-100 text-emerald-800",
  marathon: "bg-blue-100 text-blue-800",
  threshold: "bg-amber-100 text-amber-800",
  vo2: "bg-red-100 text-red-800",
};

export default function PaceZonesCard({ paceZones, powerZones }: PaceZonesCardProps) {
  const zones = [
    {
      name: "Recovery",
      pace: formatPace(paceZones.recovery),
      effort: "Very easy",
      color: zoneColor.recovery,
    },
    {
      name: "Easy",
      pace: `${formatPace(paceZones.easy.max)}–${formatPace(paceZones.easy.min)}`,
      effort: paceZones.easyEffort,
      color: zoneColor.easy,
    },
    {
      name: "Marathon",
      pace: formatPace(paceZones.marathon),
      effort: paceZones.marathonEffort,
      color: zoneColor.marathon,
    },
    {
      name: "Threshold",
      pace: formatPace(paceZones.threshold),
      effort: paceZones.thresholdEffort,
      color: zoneColor.threshold,
    },
    {
      name: "VO2 Max",
      pace: formatPace(paceZones.vo2),
      effort: paceZones.vo2Effort,
      color: zoneColor.vo2,
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Pace Zones</h3>
          <p className="text-xs text-gray-500">Paces are keyed to the anticipated marathon time.</p>
        </div>
        {paceZones.vo2MaxEstimate && (
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Garmin VO2 Max Ref</p>
            <p className="text-lg font-bold text-gray-900">{paceZones.vo2MaxEstimate}</p>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {zones.map((zone) => (
          <div key={zone.name} className={`rounded-lg p-3 ${zone.color}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{zone.name}</span>
              <span className="text-lg font-bold">{zone.pace}<span className="text-xs font-normal"> /mi</span></span>
            </div>
            {powerZones && (
              <p className="text-xs opacity-75">
                {zone.name === "Easy"
                  ? `${powerZones.easy.min}–${powerZones.easy.max} W`
                  : `${zone.name === "Recovery" ? powerZones.easy.min : zone.name === "Marathon" ? powerZones.marathon : zone.name === "Threshold" ? powerZones.threshold : powerZones.vo2} W`}
              </p>
            )}
            <p className="text-xs opacity-75">{zone.effort}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
