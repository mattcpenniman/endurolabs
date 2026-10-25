import type { GarminActivitySample } from "./activity-detail";
import type { RunningDynamics } from "./running-dynamics.mjs";
export function mapGarminActivityDetail(payload: unknown, activityStart: Date): (GarminActivitySample & RunningDynamics)[];
