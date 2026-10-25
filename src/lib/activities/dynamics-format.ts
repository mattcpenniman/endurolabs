/** Explicit running-dynamics units and balance side, shared by stats, chart and splits. */
import type { DynamicsKey, DynamicsMetric } from "./running-dynamics";
import { validDynamics } from "./running-dynamics";
import type { UnitSystem } from "@/lib/units/format";

export const DYNAMICS_LABELS: Record<DynamicsKey, string> = {
  strideLengthCm: "Stride length",
  verticalOscillationCm: "Vertical oscillation",
  verticalRatioPercent: "Vertical ratio",
  groundContactTimeMs: "Ground contact time",
  groundContactBalanceLeftPercent: "Ground contact balance",
};

export function formatDynamics(key: DynamicsKey, value: unknown, units: UnitSystem): string {
  const valid = validDynamics(key, value);
  if (valid === null) return "Unavailable";
  if (key === "strideLengthCm") return units === "metric" ? `${(valid / 100).toFixed(2)} m` : `${(valid / 30.48).toFixed(2)} ft`;
  if (key === "verticalOscillationCm") return `${valid.toFixed(2)} cm`;
  if (key === "groundContactTimeMs") return `${valid.toFixed(1)} ms`;
  if (key === "groundContactBalanceLeftPercent") return `${valid.toFixed(2)}% left / ${(100 - valid).toFixed(2)}% right`;
  return `${valid.toFixed(2)}%`;
}

export function formatDynamicsCoverage(metric: DynamicsMetric | undefined): string {
  if (!metric) return "No trace";
  return `${metric.validSeconds.toFixed(1)} s valid · ${metric.coverage === null ? "no eligible time" : `${(metric.coverage * 100).toFixed(0)}% of eligible time`}`;
}
