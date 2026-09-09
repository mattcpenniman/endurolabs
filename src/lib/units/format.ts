// ============================================================
// EnduroLab — Display Unit Preferences
// ============================================================
// Canonical storage is fixed: elevations are stored in meters,
// paces in minutes-per-mile, and course grades in feet-per-mile.
// Display code converts through these helpers according to the
// user's profile preference so no two surfaces can disagree on
// units (the meters-vs-feet inconsistency, VEC-152).
// ============================================================

export type UnitSystem = "imperial" | "metric";

export const DEFAULT_UNIT_SYSTEM: UnitSystem = "imperial";

export const METERS_PER_MILE = 1609.344;
export const KILOMETERS_PER_MILE = 1.609344;
export const FEET_PER_METER = 3.2808398950131234;
export const METERS_PER_FOOT = 0.3048;

export function parseUnitSystem(value: unknown): UnitSystem | null {
  return value === "imperial" || value === "metric" ? value : null;
}

export function paceUnitAbbr(system: UnitSystem): "mi" | "km" {
  return system === "metric" ? "km" : "mi";
}

export function paceUnitSuffix(system: UnitSystem): "/mi" | "/km" {
  return system === "metric" ? "/km" : "/mi";
}

export function elevationUnitAbbr(system: UnitSystem): "ft" | "m" {
  return system === "metric" ? "m" : "ft";
}

export function gradeUnitLabel(system: UnitSystem): "ft/mi" | "m/km" {
  return system === "metric" ? "m/km" : "ft/mi";
}

export function perDistanceWord(system: UnitSystem): "mile" | "kilometre" {
  return system === "metric" ? "kilometre" : "mile";
}

// ─── Conversions ───────────────────────────────────────────

/** Pace stored as minutes-per-mile converted to the display unit. */
export function paceMinPerMileForDisplay(paceMinPerMile: number, system: UnitSystem): number {
  return system === "metric" ? paceMinPerMile / KILOMETERS_PER_MILE : paceMinPerMile;
}

/** A pace delta stored as seconds-per-mile converted to the display unit. */
export function secondsPerMileForDisplay(secondsPerMile: number, system: UnitSystem): number {
  return system === "metric" ? secondsPerMile / KILOMETERS_PER_MILE : secondsPerMile;
}

/** Elevation stored in meters converted to display feet or meters. */
export function elevationMetersForDisplay(meters: number, system: UnitSystem): number {
  return system === "metric" ? meters : meters * FEET_PER_METER;
}

/** Elevation already expressed in feet converted to the display unit. */
export function elevationFeetForDisplay(feet: number, system: UnitSystem): number {
  return system === "metric" ? feet * METERS_PER_FOOT : feet;
}

/** Feet climbed per mile → meters climbed per kilometre. */
export function feetPerMileToMetersPerKm(feetPerMile: number): number {
  return (feetPerMile * METERS_PER_FOOT) / KILOMETERS_PER_MILE;
}

/** Grade stored as feet-per-mile converted to display magnitude. */
export function gradeForDisplay(feetPerMile: number, system: UnitSystem): number {
  return system === "metric" ? feetPerMileToMetersPerKm(feetPerMile) : feetPerMile;
}

// ─── Formatters ────────────────────────────────────────────

/** "9:23" from a value already expressed in minutes-per-display-unit. */
export function formatPaceMinutes(paceMinutes: number): string {
  const sign = paceMinutes < 0 ? "-" : "";
  const abs = Math.abs(paceMinutes);
  let m = Math.floor(abs);
  let s = Math.round((abs - m) * 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

/** Pace value text for the display unit; input is minutes-per-mile. */
export function formatPaceForSystem(paceMinPerMile: number, system: UnitSystem): string {
  return formatPaceMinutes(paceMinPerMileForDisplay(paceMinPerMile, system));
}

/** Full pace with unit, e.g. "9:23 /mi" or "5:51 /km"; "--" for null. */
export function formatPaceWithUnit(paceMinPerMile: number | null, system: UnitSystem): string {
  if (paceMinPerMile === null || !Number.isFinite(paceMinPerMile)) return "--";
  return `${formatPaceForSystem(paceMinPerMile, system)} ${paceUnitSuffix(system)}`;
}

/** Gain/loss stored in meters, e.g. "1,234 ft" or "376 m". */
export function formatElevationGain(meters: number | null, system: UnitSystem): string {
  if (meters === null || !Number.isFinite(meters)) return "--";
  return `${Math.round(elevationMetersForDisplay(meters, system)).toLocaleString("en-US")} ${elevationUnitAbbr(system)}`;
}

/** Gain/loss already expressed in feet, e.g. "1,234 ft" or "376 m". */
export function formatElevationFeet(feet: number | null, system: UnitSystem): string {
  if (feet === null || !Number.isFinite(feet)) return "--";
  return `${Math.round(elevationFeetForDisplay(feet, system)).toLocaleString("en-US")} ${elevationUnitAbbr(system)}`;
}

/** Altitude readout: whole feet, or one-decimal meters for sample traces. */
export function formatAltitude(meters: number | null, system: UnitSystem): string {
  if (meters === null || !Number.isFinite(meters)) return "--";
  if (system === "metric") return `${meters.toFixed(1)} m`;
  return `${Math.round(meters * FEET_PER_METER).toLocaleString("en-US")} ft`;
}

/** Course grade stored as feet-per-mile, e.g. "85 ft/mi" or "16 m/km". */
export function formatGrade(feetPerMile: number | null, system: UnitSystem): string {
  if (feetPerMile === null || !Number.isFinite(feetPerMile)) return "--";
  return `${Math.round(gradeForDisplay(feetPerMile, system)).toLocaleString("en-US")} ${gradeUnitLabel(system)}`;
}
