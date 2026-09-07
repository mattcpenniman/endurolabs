// ============================================================
// EnduroLab - Canonical Race Results
// ============================================================

export type RaceResultStatus = "finish" | "dnf" | "dns";
export type RaceResultVerification = "unverified" | "self-reported" | "verified";
export type RaceClassification = "official" | "training_race" | "pacing_duty" | "bad_gps";

export interface NewRaceResult {
  linkedActivityId: string | null;
  raceName: string;
  raceDate: string;
  officialDistanceMeters: number;
  chipTimeSeconds: number | null;
  gunTimeSeconds: number | null;
  status: RaceResultStatus;
  source: string;
  verificationStatus: RaceResultVerification;
  classification: RaceClassification;
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

/** Applies the fixed outcome-quality gate used by race forecasts. */
export function isPredictionEligibleRaceResult(result: {
  status: string;
  classification: string;
  predictionExcluded: boolean;
  chipTimeSeconds: number | null;
  gunTimeSeconds: number | null;
}): boolean {
  return result.status === "finish"
    && result.classification === "official"
    && !result.predictionExcluded
    && (result.chipTimeSeconds ?? result.gunTimeSeconds ?? 0) > 0;
}

function optionalNumber(value: unknown, field: string, minimum: number | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== null && value < minimum)) {
    throw new Error(`${field} must be ${minimum === null ? "a finite number" : `at least ${minimum}`}`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string, minimum: number): number | null {
  const parsed = optionalNumber(value, field, minimum);
  if (parsed !== null && !Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates an append-only canonical race result request. */
export function parseNewRaceResult(value: unknown): NewRaceResult {
  if (!value || typeof value !== "object") throw new Error("Race result is required");
  const input = value as Record<string, unknown>;
  const status = input.status;
  if (status !== "finish" && status !== "dnf" && status !== "dns") {
    throw new Error("status must be finish, dnf, or dns");
  }
  const verificationStatus = input.verificationStatus ?? "unverified";
  if (verificationStatus !== "unverified" && verificationStatus !== "self-reported" && verificationStatus !== "verified") {
    throw new Error("verificationStatus is invalid");
  }
  const classification = input.classification ?? "official";
  if (classification !== "official" && classification !== "training_race"
    && classification !== "pacing_duty" && classification !== "bad_gps") {
    throw new Error("classification is invalid");
  }
  const raceName = typeof input.raceName === "string" ? input.raceName.trim() : "";
  if (!raceName || raceName.length > 255) throw new Error("raceName is required and must be at most 255 characters");
  const raceDate = typeof input.raceDate === "string" ? input.raceDate : "";
  if (!validDate(raceDate)) {
    throw new Error("raceDate must be a valid YYYY-MM-DD date");
  }
  const officialDistanceMeters = optionalNumber(input.officialDistanceMeters, "officialDistanceMeters", Number.MIN_VALUE);
  if (officialDistanceMeters === null) throw new Error("officialDistanceMeters is required");
  const chipTimeSeconds = optionalInteger(input.chipTimeSeconds, "chipTimeSeconds", 1);
  const gunTimeSeconds = optionalInteger(input.gunTimeSeconds, "gunTimeSeconds", 1);
  if (status === "finish" && chipTimeSeconds === null && gunTimeSeconds === null) {
    throw new Error("A finish requires chipTimeSeconds or gunTimeSeconds");
  }

  return {
    linkedActivityId: typeof input.linkedActivityId === "string" && input.linkedActivityId ? input.linkedActivityId : null,
    raceName,
    raceDate,
    officialDistanceMeters,
    chipTimeSeconds,
    gunTimeSeconds,
    status,
    source: typeof input.source === "string" && input.source.trim() ? input.source.trim().slice(0, 32) : "manual",
    verificationStatus,
    classification,
    predictionExcluded: typeof input.predictionExcluded === "boolean" ? input.predictionExcluded : false,
    notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 2000) : null,
    courseId: typeof input.courseId === "string" && input.courseId.trim() ? input.courseId.trim().slice(0, 255) : null,
    elevationGainMeters: optionalInteger(input.elevationGainMeters, "elevationGainMeters", 0),
    surface: typeof input.surface === "string" && input.surface.trim() ? input.surface.trim().slice(0, 32) : null,
    temperatureCelsius: optionalNumber(input.temperatureCelsius, "temperatureCelsius", null),
    dewPointCelsius: optionalNumber(input.dewPointCelsius, "dewPointCelsius", null),
    windSpeedMetersPerSecond: optionalNumber(input.windSpeedMetersPerSecond, "windSpeedMetersPerSecond", 0),
    precipitationMillimeters: optionalNumber(input.precipitationMillimeters, "precipitationMillimeters", 0),
    placing: optionalInteger(input.placing, "placing", 1),
    ageGroupPlacing: optionalInteger(input.ageGroupPlacing, "ageGroupPlacing", 1),
  };
}
