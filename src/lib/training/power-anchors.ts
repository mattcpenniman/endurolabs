// ============================================================
// EnduroLab — User Power Anchor Defaults
// ============================================================
// User-level power anchor settings. They seed newly generated
// plans and can be applied to the current plan, so the runner
// can override the beacon's logged-power recommendation with
// explicit numbers. Anchors are the only power configuration
// `calculatePowerZones` treats as user-provided; everything else
// is the pace-derived fallback.

import type { RunnerProfile } from "./models";

export const POWER_ANCHOR_MIN_WATTS = 50;
export const POWER_ANCHOR_MAX_WATTS = 700;

export interface PowerZoneDefaults {
  hasPower: boolean;
  easyPower: number | null;
  marathonPower: number | null;
  thresholdPower: number | null;
}

export interface PowerZoneDefaultsInput {
  hasPower?: unknown;
  easyPower?: unknown;
  marathonPower?: unknown;
  thresholdPower?: unknown;
}

/** null/undefined/"" mean "unset"; a non-number is invalid (`undefined`). */
function anchor(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(value);
}

/** Parse stored jsonb; returns null when the shape is unusable. */
export function parsePowerZoneDefaults(value: unknown): PowerZoneDefaults | null {
  if (value === null || value === undefined || typeof value !== "object") return null;
  const input = value as PowerZoneDefaultsInput;
  if (typeof input.hasPower !== "boolean") return null;
  const easyPower = anchor(input.easyPower);
  const marathonPower = anchor(input.marathonPower);
  const thresholdPower = anchor(input.thresholdPower);
  if (easyPower === undefined || marathonPower === undefined || thresholdPower === undefined) return null;
  return { hasPower: input.hasPower, easyPower, marathonPower, thresholdPower };
}

/** Validate a settings payload; returns normalized defaults or an error message. */
export function validatePowerZoneDefaults(
  input: PowerZoneDefaultsInput,
): { defaults: PowerZoneDefaults } | { error: string } {
  if (typeof input.hasPower !== "boolean") return { error: "hasPower must be a boolean" };
  const easyPower = anchor(input.easyPower);
  const marathonPower = anchor(input.marathonPower);
  const thresholdPower = anchor(input.thresholdPower);
  for (const [key, value] of [
    ["easyPower", easyPower],
    ["marathonPower", marathonPower],
    ["thresholdPower", thresholdPower],
  ] as const) {
    if (value === undefined) return { error: `${key} must be a number of watts or null` };
    if (value !== null && (value < POWER_ANCHOR_MIN_WATTS || value > POWER_ANCHOR_MAX_WATTS)) {
      return { error: `${key} must be between ${POWER_ANCHOR_MIN_WATTS} and ${POWER_ANCHOR_MAX_WATTS} W` };
    }
  }
  if (easyPower === undefined || marathonPower === undefined || thresholdPower === undefined) {
    return { error: "Power anchors must be numbers of watts or null" };
  }
  if (input.hasPower && marathonPower === null) {
    return { error: "Marathon power is required when power is enabled" };
  }
  if (input.hasPower && easyPower !== null && marathonPower !== null && easyPower >= marathonPower) {
    return { error: "Easy power must be below marathon power" };
  }
  if (input.hasPower && thresholdPower !== null && marathonPower !== null && thresholdPower <= marathonPower) {
    return { error: "Threshold power must be above marathon power" };
  }
  return { defaults: { hasPower: input.hasPower, easyPower, marathonPower, thresholdPower } };
}

/** Explicit runner anchors for a profile; undefined when power is disabled. */
export function powerZoneAnchors(defaults: PowerZoneDefaults): RunnerProfile["appleWatchPowerData"] {
  if (!defaults.hasPower) return undefined;
  return {
    easyPower: defaults.easyPower,
    marathonPower: defaults.marathonPower,
    thresholdPower: defaults.thresholdPower,
  };
}

function profileHasAnchors(profile: RunnerProfile): boolean {
  const data = profile.appleWatchPowerData;
  return Boolean(data && (
    (typeof data.easyPower === "number" && Number.isFinite(data.easyPower))
    || (typeof data.marathonPower === "number" && Number.isFinite(data.marathonPower))
    || (typeof data.thresholdPower === "number" && Number.isFinite(data.thresholdPower))
  ));
}

/**
 * Replace a profile's power settings with the stored defaults. Used when the
 * runner saves the profile editor: the defaults are authoritative for the
 * current plan.
 */
export function applyPowerZoneDefaults(
  profile: RunnerProfile,
  defaults: PowerZoneDefaults | null,
): RunnerProfile {
  if (!defaults?.hasPower) {
    return { ...profile, hasAppleWatchPower: false, appleWatchPowerData: undefined };
  }
  return { ...profile, hasAppleWatchPower: true, appleWatchPowerData: powerZoneAnchors(defaults) };
}

/**
 * Fill a generated-plan profile from the stored defaults when the runner
 * asked for power but supplied no anchors. Explicit profile anchors win.
 */
export function mergePowerZoneDefaults(
  profile: RunnerProfile,
  defaults: PowerZoneDefaults | null,
): RunnerProfile {
  if (!profile.hasAppleWatchPower || !defaults?.hasPower || profileHasAnchors(profile)) return profile;
  return { ...profile, appleWatchPowerData: powerZoneAnchors(defaults) };
}