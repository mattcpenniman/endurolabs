/**
 * Explainable run-score-v1 coaching heuristic. Pure; this is execution feedback,
 * not a validated fitness/readiness metric. Missing components are not zeroes.
 */
import { normalizeActivityCadence } from "@/lib/activities/activity-chart";
import type { ActivityChartSample } from "@/lib/activities/models";
import type { MarathonPlan, Workout, WorkoutSegment } from "@/lib/training/models";

export const RUN_SCORE_VERSION = "run-score-v1";
export interface RunScoreComponent {
  key: "cadence" | "effort" | "distance";
  label: string;
  weight: number;
  score: number | null;
  basis: string;
  detail: string;
  coverage: number | null;
}
export interface RunScore {
  version: typeof RUN_SCORE_VERSION;
  score: number | null;
  partial: boolean;
  availableWeight: number;
  components: RunScoreComponent[];
  effortTargets: RunScoreTarget[];
}
export interface RunScoreInput {
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  averageCadence: number | null;
  powerSource: string;
  samples: ActivityChartSample[];
  workout: Workout | null;
  plan: MarathonPlan | null;
}
const round = (n: number): number => Math.round(n * 10) / 10;
const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
function deviationScore(fraction: number, tolerance: number, zeroAt: number): number {
  return Math.max(0, Math.min(10, 10 * (1 - Math.max(0, fraction - tolerance) / (zeroAt - tolerance))));
}

/** Minetti running energy-cost ratio; restrict steep/noisy slopes before use. */
export function gradeAdjustedSpeed(speed: number, slope: number): number | null {
  if (!valid(speed) || !Number.isFinite(slope) || Math.abs(slope) > 0.2) return null;
  const cost = 155.4 * slope ** 5 - 30.4 * slope ** 4 - 43.3 * slope ** 3
    + 46.3 * slope ** 2 + 19.5 * slope + 3.6;
  return speed * cost / 3.6;
}

export interface RunScoreTarget { label: string; pace: [number, number]; power: [number, number] | null; seconds: number }
function targetFor(segment: WorkoutSegment, plan: MarathonPlan): RunScoreTarget | null {
  const z = plan.paceZones;
  const easy = segment.type === "easy" || segment.type === "long";
  const recovery = segment.type === "recovery";
  const pace = segment.pace ?? (easy ? (z.easy.min + z.easy.max) / 2 : recovery ? z.recovery
    : segment.type === "marathon_pace" || segment.type === "race" ? z.marathon
    : segment.type === "threshold" ? z.threshold : segment.type === "vo2" ? z.vo2 : null);
  if (!valid(pace)) return null;
  const p = plan.powerZones;
  // Only runner-anchored power zones are suitable for grading sensor watts.
  const anchored = valid(plan.runnerProfile.appleWatchPowerData?.marathonPower);
  const watts = anchored && p ? segment.power ?? (easy || recovery ? (p.easy.min + p.easy.max) / 2
    : segment.type === "threshold" ? p.threshold : segment.type === "vo2" ? p.vo2 : p.marathon) : null;
  return {
    label: segment.description,
    pace: easy && !segment.pace ? [z.easy.min, z.easy.max] : [pace * 0.95, pace * 1.05],
    power: valid(watts) ? easy && p && !segment.power ? [p.easy.min, p.easy.max] : [watts * 0.95, watts * 1.05] : null,
    seconds: valid(segment.duration) ? segment.duration * 60 : valid(segment.distance) ? segment.distance * pace * 60 : 0,
  };
}
function targetsFor(workout: Workout | null, plan: MarathonPlan | null): RunScoreTarget[] {
  if (!workout || !plan) return [];
  const segments = workout.segments.length ? workout.segments : [{ type: workout.type, description: workout.title, duration: workout.estimatedDuration }];
  const targets: RunScoreTarget[] = [];
  for (const segment of segments) {
    const target = targetFor(segment, plan);
    if (!target || !valid(target.seconds)) return []; // Do not silently omit ambiguous segments.
    for (let rep = 0; rep < (segment.repetitions ?? 1); rep++) {
      targets.push(target);
      if (rep < (segment.repetitions ?? 1) - 1 && valid(segment.restBetween)) {
        const rest = targetFor({ type: "recovery", description: "Recovery", duration: segment.restBetween / 60 }, plan);
        if (rest) targets.push(rest);
      }
    }
  }
  return targets;
}
function rangeScore(value: number, range: [number, number]): number {
  const deviation = value < range[0] ? (range[0] - value) / range[0]
    : value > range[1] ? (value - range[1]) / range[1] : 0;
  return deviationScore(deviation, 0, 0.25);
}

/** Grades each available component and renormalizes its fixed weight. */
export function buildRunScore(input: RunScoreInput): RunScore {
  const duration = input.movingDurationSeconds ?? input.durationSeconds;
  const samples = [...input.samples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const targets = targetsFor(input.workout, input.plan);
  let cadenceSeconds = 0, cadenceTotal = 0, cadenceValue = 0;
  let effortSeconds = 0, effortTotal = 0, powerSeconds = 0, gradeSeconds = 0;
  let movingElapsed = 0, targetIndex = 0, targetEnd = targets[0]?.seconds ?? 0;
  // Elevation is differenced over >=30 s to reduce second-by-second noise.
  let elevationStart = 0, integratedDistance = 0;
  const distances = [0];
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1], sample = samples[i];
    const dt = sample.elapsedSeconds - before.elapsedSeconds;
    const speed = valid(before.speedMetersPerSecond) && valid(sample.speedMetersPerSecond)
      ? (before.speedMetersPerSecond + sample.speedMetersPerSecond) / 2 : null;
    if (dt <= 0 || dt > 30 || !valid(speed) || speed < 0.5 || speed > 12) {
      elevationStart = i; distances[i] = integratedDistance; continue;
    }
    integratedDistance += speed * dt;
    distances[i] = integratedDistance;
    while (elevationStart + 1 < i && samples[elevationStart + 1].elapsedSeconds <= sample.elapsedSeconds - 30) elevationStart++;
    const elevationDistance = integratedDistance - distances[elevationStart];
    const cadence = normalizeActivityCadence(sample.cadence);
    if (cadence !== null) {
      cadenceSeconds += dt; cadenceValue += cadence * dt;
      cadenceTotal += deviationScore(Math.abs(cadence - 180), 5, 35) * dt;
    }
    while (targetIndex < targets.length - 1 && movingElapsed >= targetEnd) {
      targetIndex++; targetEnd += targets[targetIndex].seconds;
    }
    const target = targets[targetIndex];
    if (target) {
      const measured = !input.powerSource.startsWith("estimated_") && valid(sample.power) && target.power;
      if (measured) {
        effortTotal += rangeScore(sample.power!, target.power!) * dt;
        effortSeconds += dt; powerSeconds += dt;
      } else {
        const start = samples[elevationStart];
        const span = sample.elapsedSeconds - start.elapsedSeconds;
        if (span >= 30 && start.elevationMeters != null && sample.elevationMeters != null && elevationDistance > 0) {
          const adjusted = gradeAdjustedSpeed(speed, (sample.elevationMeters - start.elevationMeters) / elevationDistance);
          if (adjusted !== null) {
            effortTotal += rangeScore(1609.344 / adjusted / 60, target.pace) * dt;
            effortSeconds += dt; gradeSeconds += dt;
          }
        }
      }
    }
    movingElapsed += dt;
  }
  const enough = (seconds: number): boolean => valid(duration) && seconds >= 120 && seconds / duration >= 0.5;
  const cadenceSummary = normalizeActivityCadence(input.averageCadence);
  const cadenceScore = enough(cadenceSeconds) ? round(cadenceTotal / cadenceSeconds)
    : cadenceSummary !== null ? round(deviationScore(Math.abs(cadenceSummary - 180), 5, 35)) : null;
  const effortScore = enough(effortSeconds) ? round(effortTotal / effortSeconds) : null;
  const distanceTarget = input.workout?.totalDistance;
  const distanceScore = valid(distanceTarget) && valid(input.distanceMeters)
    ? round(deviationScore(Math.abs(input.distanceMeters / 1609.344 - distanceTarget) / distanceTarget, 0.05, 0.5)) : null;
  const components: RunScoreComponent[] = [
    { key: "cadence", label: "Cadence", weight: 30, score: cadenceScore,
      basis: enough(cadenceSeconds) ? "Recorded cadence" : "Summary cadence",
      detail: cadenceScore === null ? "No valid cadence recorded." : `${round(enough(cadenceSeconds) ? cadenceValue / cadenceSeconds : cadenceSummary!)} spm; goal 180 ±5. Score falls linearly to 0 at 35 spm deviation.`,
      coverage: enough(cadenceSeconds) ? Math.min(1, cadenceSeconds / duration) : null },
    { key: "effort", label: "Target effort", weight: 50, score: effortScore,
      basis: powerSeconds > 0 ? gradeSeconds > 0 ? "Measured power + grade-adjusted pace" : "Measured power" : "Grade-adjusted pace",
      detail: targets.length === 0 ? "No matched workout with usable targets."
        : effortScore === null ? "Need ≥2 min and ≥50% trace coverage with measured anchored power or valid elevation/speed."
        : "Time-weighted target adherence; full credit inside the target range, 0 at 25% outside. Work/recovery targets follow planned segment times (an approximation, not detected laps). Grade uses the Minetti energy-cost model.",
      coverage: valid(duration) ? Math.min(1, effortSeconds / duration) : null },
    { key: "distance", label: "Planned distance", weight: 20, score: distanceScore, basis: "Provider distance",
      detail: distanceScore === null ? "No matched running-distance target." : `${round(input.distanceMeters / 1609.344)} / ${round(distanceTarget!)} mi; full credit within 5%, 0 at 50% deviation.`, coverage: null },
  ];
  const available = components.filter((component) => component.score !== null);
  const weight = available.reduce((sum, c) => sum + c.weight, 0);
  return { version: RUN_SCORE_VERSION, score: weight ? round(available.reduce((sum, c) => sum + c.score! * c.weight, 0) / weight) : null,
    partial: weight < 100, availableWeight: weight, components, effortTargets: targets };
}

export interface RunScoreComponentSummary {
  key: RunScoreComponent["key"];
  label: string;
  weight: number;
  score: number | null;
  scored: number;
}
export interface RunScoreSummary {
  score: number | null;
  scored: number;
  total: number;
  partial: number;
  components: RunScoreComponentSummary[];
}
/** Equal-run mean; missing and explicitly excluded runs do not depress the mean. */
export function summarizeRunScores(runs: { runScore?: RunScore | null; excludedFromAnalytics?: boolean }[]): RunScoreSummary {
  const included = runs.filter((run) => !run.excludedFromAnalytics);
  const scored = included.flatMap((run) => run.runScore?.score != null ? [run.runScore] : []);
  const components = ([
    { key: "cadence", label: "Cadence", weight: 30 },
    { key: "effort", label: "Target effort", weight: 50 },
    { key: "distance", label: "Planned distance", weight: 20 },
  ] as const).map((component) => {
    const values = scored.flatMap((run) => {
      const value = run.components.find((item) => item.key === component.key)?.score;
      return value != null ? [value] : [];
    });
    return { ...component, score: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      scored: values.length };
  });
  return { score: scored.length ? round(scored.reduce((sum, score) => sum + score.score!, 0) / scored.length) : null,
    scored: scored.length, total: included.length, partial: scored.filter((score) => score.partial).length, components };
}
