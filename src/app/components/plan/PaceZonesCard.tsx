"use client";
// ============================================================
// EnduroLab — Pace Zones Card
// ============================================================
// Displays the runner's calculated pace zones with color
// coding and RPE effort descriptors, in the user's profile
// unit system (min/mile or min/km).
// ============================================================

import React from "react";
import { PaceZones, PowerZones, HeartRateZone } from "@/lib/training/models";
import { useUnits } from "@/app/components/units/UnitsProvider";
import { formatPaceForSystem, paceUnitAbbr } from "@/lib/units/format";

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
  const { units } = useUnits();
  const formatPercentRange = (range: HeartRateZone["hrrPercent"]): string =>
    `${Math.round(range.min * 100)}-${Math.round(range.max * 100)}%`;
  const formatHeartRateLine = (heartRateZone: HeartRateZone): string => {
    if (heartRateZone.targetBpm) {
      return `${heartRateZone.targetBpm.min}-${heartRateZone.targetBpm.max} bpm`;
    }

    return `${formatPercentRange(heartRateZone.hrrPercent)} HRR · ${formatPercentRange(heartRateZone.hrMaxPercent)} HRmax`;
  };

  const zones = [
    {
      name: "Recovery",
      pace: formatPaceForSystem(paceZones.recovery, units),
      effort: "Very easy",
      color: zoneColor.recovery,
      heartRate: paceZones.heartRateZones.recovery,
    },
    {
      name: "Easy",
      pace: `${formatPaceForSystem(paceZones.easy.max, units)}–${formatPaceForSystem(paceZones.easy.min, units)}`,
      effort: paceZones.easyEffort,
      color: zoneColor.easy,
      heartRate: paceZones.heartRateZones.easy,
    },
    {
      name: "Marathon",
      pace: formatPaceForSystem(paceZones.marathon, units),
      effort: paceZones.marathonEffort,
      color: zoneColor.marathon,
      heartRate: paceZones.heartRateZones.marathon,
    },
    {
      name: "Threshold",
      pace: formatPaceForSystem(paceZones.threshold, units),
      effort: paceZones.thresholdEffort,
      color: zoneColor.threshold,
      heartRate: paceZones.heartRateZones.threshold,
    },
    {
      name: "VO2 Max",
      pace: formatPaceForSystem(paceZones.vo2, units),
      effort: paceZones.vo2Effort,
      color: zoneColor.vo2,
      heartRate: paceZones.heartRateZones.vo2,
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
              <span className="text-lg font-bold">{zone.pace}<span className="text-xs font-normal"> /{paceUnitAbbr(units)}</span></span>
            </div>
            {powerZones && (
              <p className="text-xs opacity-75">
                {zone.name === "Easy"
                  ? `${powerZones.easy.min}–${powerZones.easy.max} W`
                  : `${zone.name === "Recovery" ? powerZones.easy.min : zone.name === "Marathon" ? powerZones.marathon : zone.name === "Threshold" ? powerZones.threshold : powerZones.vo2} W`}
              </p>
            )}
            <p className="text-xs opacity-75">HR {formatHeartRateLine(zone.heartRate)}</p>
            {zone.heartRate.note && (
              <p className="text-xs opacity-75">{zone.heartRate.note}</p>
            )}
            <p className="text-xs opacity-75">{zone.effort}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
