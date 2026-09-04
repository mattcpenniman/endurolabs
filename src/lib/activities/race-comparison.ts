// ============================================================
// EnduroLab - Race Classification and Comparison
// ============================================================
// Groups GPS-recorded race distances into common events and
// calculates selected-versus-baseline performance changes.

import type { RunActivity } from "@/lib/activities/models";

export interface RaceDistanceCategory {
  key: string;
  label: string;
}

export interface RaceComparison {
  timeImprovementSeconds: number;
  timeImprovementPercent: number;
  paceImprovementMinutesPerMile: number | null;
  heartRateDelta: number | null;
  powerDelta: number | null;
  elevationDeltaMeters: number | null;
}

const STANDARD_DISTANCES = [
  { key: "5k", label: "5K", miles: 3.1069, tolerance: 0.35 },
  { key: "10k", label: "10K", miles: 6.2137, tolerance: 0.5 },
  { key: "10-mile", label: "10 mile", miles: 10, tolerance: 0.65 },
  { key: "half-marathon", label: "Half marathon", miles: 13.1094, tolerance: 1 },
  { key: "20-mile", label: "20 mile", miles: 20, tolerance: 1.25 },
  { key: "marathon", label: "Marathon", miles: 26.2188, tolerance: 1.5 },
] as const;

/** Returns a stable event group while allowing normal GPS distance drift. */
export function classifyRaceDistance(distanceMiles: number): RaceDistanceCategory {
  const match = STANDARD_DISTANCES.find((distance) => (
    Math.abs(distanceMiles - distance.miles) <= distance.tolerance
  ));
  if (match) return { key: match.key, label: match.label };

  const rounded = Math.round(distanceMiles * 2) / 2;
  return { key: `custom-${rounded}`, label: `${rounded.toFixed(1)} mile` };
}

export function areComparableRaces(a: RunActivity, b: RunActivity): boolean {
  return classifyRaceDistance(a.distanceMiles).key === classifyRaceDistance(b.distanceMiles).key;
}

/** Positive time and pace values mean the selected race was faster. */
export function compareRaces(selected: RunActivity, baseline: RunActivity): RaceComparison {
  const timeImprovementSeconds = baseline.durationSeconds - selected.durationSeconds;
  return {
    timeImprovementSeconds,
    timeImprovementPercent: baseline.durationSeconds > 0
      ? (timeImprovementSeconds / baseline.durationSeconds) * 100
      : 0,
    paceImprovementMinutesPerMile:
      selected.averagePaceMinutesPerMile !== null && baseline.averagePaceMinutesPerMile !== null
        ? baseline.averagePaceMinutesPerMile - selected.averagePaceMinutesPerMile
        : null,
    heartRateDelta:
      selected.averageHeartRate !== null && baseline.averageHeartRate !== null
        ? selected.averageHeartRate - baseline.averageHeartRate
        : null,
    powerDelta:
      selected.averagePower !== null && baseline.averagePower !== null
        ? selected.averagePower - baseline.averagePower
        : null,
    elevationDeltaMeters:
      selected.elevationGainMeters !== null && baseline.elevationGainMeters !== null
        ? selected.elevationGainMeters - baseline.elevationGainMeters
        : null,
  };
}

/** Prefers the most recent earlier race, then the nearest later race. */
export function findDefaultComparisonRace(
  selected: RunActivity,
  races: RunActivity[],
): RunActivity | null {
  const comparable = races
    .filter((race) => race.id !== selected.id && areComparableRaces(selected, race))
    .sort((a, b) => b.startTimeGmt.localeCompare(a.startTimeGmt));
  return comparable.find((race) => race.startTimeGmt < selected.startTimeGmt)
    ?? comparable.at(-1)
    ?? null;
}
