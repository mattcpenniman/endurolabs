// ============================================================
// EnduroLab - Synced Activity Models
// ============================================================

export interface RunActivity {
  id: string;
  providerActivityId: string;
  source: string;
  powerSource?: string;
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
  qualityScore?: number | null;
  excludedFromAnalytics?: boolean;
  sampleCount: number;
  samplesFetchedAt: string | null;
  detailFetchStatus?: string | null;
  detailLastError?: string | null;
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

export interface ActivityChartSample {
  elapsedSeconds: number;
  heartRate: number | null;
  power: number | null;
  cadence: number | null;
  speedMetersPerSecond: number | null;
  latitude?: number | null;
  longitude?: number | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
}

export interface ActivityChartPoint extends ActivityChartSample {
  paceMinutesPerMile: number | null;
}

export interface ActivityDetailResponse {
  samples: ActivityChartSample[];
}
