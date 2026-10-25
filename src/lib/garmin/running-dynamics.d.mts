/** Canonical fractional measured dynamics; null means unavailable, never inferred. */
export interface RunningDynamics {
  verticalOscillationCm: number | null;
  verticalRatioPercent: number | null;
  groundContactTimeMs: number | null;
  groundContactBalanceLeftPercent: number | null;
  strideLengthCm: number | null;
}
export const DYNAMICS_FIELDS: Record<keyof RunningDynamics, readonly [string, string, string, number]>;
export function dynamicsValue(value: unknown, maximum: number): number | null;
export function mapGarminSummaryDynamics(payload: unknown): RunningDynamics;
