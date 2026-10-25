/** Shared Node/app Garmin detail mapping; dynamics retain native fractional cm/ms/percent units. */
import type { RunningDynamics } from "./running-dynamics.mjs";

export interface GarminActivitySample extends Partial<RunningDynamics> {
  timestamp: Date;
  elapsedSeconds: number;
  distanceMeters: number | null;
  heartRate: number | null;
  power: number | null;
  speedMetersPerSecond: number | null;
  elevationMeters: number | null;
  grade: number | null;
  cadence: number | null;
  latitude: number | null;
  longitude: number | null;
  temperatureCelsius: number | null;
}

export { mapGarminActivityDetail } from "./activity-detail.mjs";
