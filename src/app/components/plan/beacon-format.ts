// ============================================================
// EnduroLab — Impact Beacon display formatting
// ============================================================
// Shared formatting for the goal targets shown by the Score Card
// beacon panel and the floating beacon widget.

import type { ImpactBeaconTargets } from "@/lib/analytics/impact-beacon";

export function formatGoalTime(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

export function formatGoalPace(minutesPerMile: number): string {
  const minutes = Math.floor(minutesPerMile);
  const seconds = Math.round((minutesPerMile - minutes) * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/mi`;
}

export function formatHeartRateTargets(targets: ImpactBeaconTargets["heartRate"]): string {
  const parts = targets
    .map((target) => target.minBpm !== null && target.maxBpm !== null
      ? `${target.label} ${target.minBpm}-${target.maxBpm} bpm`
      : null)
    .filter((value): value is string => value !== null);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function formatPowerTargets(targets: NonNullable<ImpactBeaconTargets["power"]>): string {
  const parts = targets
    .map((target) => target.watts !== null ? `${target.label} ${target.watts} W` : null)
    .filter((value): value is string => value !== null);
  return parts.length > 0 ? parts.join(" · ") : "—";
}