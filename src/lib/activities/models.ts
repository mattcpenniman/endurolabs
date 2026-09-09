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
  eventType: string | null;
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
  garminPower: number | null;
  calculatedPower: number | null;
  averagePower: number | null;
  averagePowerEstimated: boolean;
  calories: number | null;
  deviceName: string | null;
  planId: string | null;
  weekNumber: number | null;
  dayOfWeek: string | null;
  plannedWorkoutId: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
  qualityScore?: number | null;
  excludedFromAnalytics?: boolean;
  predictionExcluded?: boolean;
  raceClassification?: string | null;
  raceNotes?: string | null;
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
  /** True when a sealed password is kept so expired sessions re-login automatically. */
  rememberMe?: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
  activities: RunActivity[];
}

export interface RaceListResponse {
  races: RunActivity[];
  officialResults: RaceResultRecord[];
}

export interface RaceResultRecord {
  id: string;
  linkedActivityId: string | null;
  raceName: string;
  raceDate: string;
  officialDistanceMeters: number;
  chipTimeSeconds: number | null;
  gunTimeSeconds: number | null;
  status: "finish" | "dnf" | "dns";
  source: string;
  verificationStatus: "unverified" | "self-reported" | "verified";
  classification: "official" | "training_race" | "pacing_duty" | "bad_gps";
  predictionExcluded: boolean;
  notes: string | null;
  courseId: string | null;
  elevationGainMeters: number | null;
  surface: string | null;
  temperatureCelsius: number | null;
  dewPointCelsius: number | null;
  windSpeedMetersPerSecond: number | null;
  precipitationMillimeters: number | null;
  placing: number | null;
  ageGroupPlacing: number | null;
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

export interface ActivitySplit {
  number: number;
  distanceMiles: number;
  durationSeconds: number;
  elapsedSeconds: number;
  paceMinutesPerMile: number | null;
  averageHeartRate: number | null;
  /** Null unless the source is measured sensor power. */
  averagePower: number | null;
  averageCadence: number | null;
  averageTemperatureCelsius: number | null;
  elevationGainMeters: number;
  elevationLossMeters: number;
}

export interface ActivityDetailResponse {
  samples: ActivityChartSample[];
  splits: ActivitySplit[];
}
