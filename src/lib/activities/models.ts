// ============================================================
// EnduroLab - Synced Activity Models
// ============================================================

export interface RunActivity {
  id: string;
  providerActivityId: string;
  activityName: string;
  activityType: string;
  localDate: string;
  startTimeLocal: string;
  startTimeGmt: string;
  distanceMiles: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  averagePaceMinutesPerMile: number | null;
  elevationGainMeters: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  averageCadence: number | null;
  averagePower: number | null;
  calories: number | null;
  deviceName: string | null;
  planId: string | null;
  weekNumber: number | null;
  dayOfWeek: string | null;
  plannedWorkoutId: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
  syncedAt: string;
}

export interface GarminConnectionStatus {
  connected: boolean;
  mfaRequired?: boolean;
  mfaMethod?: string | null;
  username?: string;
  displayName?: string | null;
  status?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  activities: RunActivity[];
}
