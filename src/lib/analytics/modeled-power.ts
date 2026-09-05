// ============================================================
// EnduroLab - Activity-summary speed/power calibration
// ============================================================

export interface SpeedPowerModel {
  intercept: number;
  slope: number;
  activityCount: number;
}

interface PowerActivitySummary {
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  averagePower: number | null;
  powerSource: string;
}

export const MIN_VALID_MOVING_DURATION_RATIO = 0.5;

export function summarySpeed(activity: Pick<
  PowerActivitySummary,
  "distanceMeters" | "durationSeconds" | "movingDurationSeconds"
>): number {
  const movingDuration = activity.movingDurationSeconds;
  const duration = movingDuration !== null
    && movingDuration >= activity.durationSeconds * MIN_VALID_MOVING_DURATION_RATIO
    && movingDuration <= activity.durationSeconds
    ? movingDuration
    : activity.durationSeconds;
  return activity.distanceMeters / duration;
}

/** Fit measured average activity power as a linear function of average speed. */
export function fitSpeedPowerModel(activities: PowerActivitySummary[]): SpeedPowerModel | null {
  const points = activities
    .filter((activity) => activity.averagePower !== null && !activity.powerSource.startsWith("estimated_"))
    .map((activity) => ({
      speed: summarySpeed(activity),
      power: activity.averagePower as number,
    }))
    .filter((point) => Number.isFinite(point.speed) && point.speed > 0);
  if (points.length < 5) return null;

  const meanSpeed = mean(points.map((point) => point.speed));
  const meanPower = mean(points.map((point) => point.power));
  const variance = points.reduce((sum, point) => sum + (point.speed - meanSpeed) ** 2, 0);
  if (variance <= 0) return null;
  const covariance = points.reduce((sum, point) => (
    sum + (point.speed - meanSpeed) * (point.power - meanPower)
  ), 0);
  const slope = covariance / variance;
  return {
    slope,
    intercept: meanPower - slope * meanSpeed,
    activityCount: points.length,
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
