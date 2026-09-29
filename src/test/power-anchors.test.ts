// ============================================================
// EnduroLab — Power Anchor Defaults Tests
// ============================================================
// User-level power anchor validation, parsing, profile
// application, and inheritance into generated plans.

import { describe, expect, it } from "vitest";
import {
  applyPowerZoneDefaults,
  mergePowerZoneDefaults,
  parsePowerZoneDefaults,
  validatePowerZoneDefaults,
  type PowerZoneDefaults,
} from "@/lib/training/power-anchors";
import type { RunnerProfile } from "@/lib/training/models";

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 45,
    peakHistoricalWeeklyMileage: 60,
    currentMarathonPR: 195,
    currentHalfMarathonPR: 90,
    goalMarathonTime: 180,
    raceDate: "2026-10-04",
    raceName: "Test Marathon",
    trainingDaysPerWeek: 6,
    preferredRestDay: "Monday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 16,
    comfortLevelWithWorkouts: "advanced",
    availableLongRunDays: ["Sunday"],
    strengthTrainingAvailability: "light",
    ...overrides,
  };
}

const DEFAULTS: PowerZoneDefaults = {
  hasPower: true,
  easyPower: 240,
  marathonPower: 300,
  thresholdPower: 336,
};

describe("validatePowerZoneDefaults", () => {
  it("accepts a complete anchor set and rounds watts", () => {
    const result = validatePowerZoneDefaults({
      hasPower: true,
      easyPower: 240.4,
      marathonPower: 300.6,
      thresholdPower: 336.2,
    });

    expect(result).toEqual({
      defaults: { hasPower: true, easyPower: 240, marathonPower: 301, thresholdPower: 336 },
    });
  });

  it("allows optional threshold and easy anchors", () => {
    expect(validatePowerZoneDefaults({ hasPower: true, marathonPower: 300 })).toEqual({
      defaults: { hasPower: true, easyPower: null, marathonPower: 300, thresholdPower: null },
    });
  });

  it("requires marathon power when enabled", () => {
    const result = validatePowerZoneDefaults({ hasPower: true, thresholdPower: 336 });
    expect(result).toEqual({ error: "Marathon power is required when power is enabled" });
  });

  it("rejects anchors outside the watt range and non-numbers", () => {
    expect(validatePowerZoneDefaults({ hasPower: true, marathonPower: 49 })).toEqual({
      error: "marathonPower must be between 50 and 700 W",
    });
    expect(validatePowerZoneDefaults({ hasPower: true, marathonPower: 701 })).toEqual({
      error: "marathonPower must be between 50 and 700 W",
    });
    expect(validatePowerZoneDefaults({ hasPower: true, marathonPower: "300" })).toEqual({
      error: "marathonPower must be a number of watts or null",
    });
    expect(validatePowerZoneDefaults({ hasPower: "yes", marathonPower: 300 })).toEqual({
      error: "hasPower must be a boolean",
    });
  });

  it("enforces anchor ordering only when power is enabled", () => {
    expect(validatePowerZoneDefaults({ hasPower: true, easyPower: 300, marathonPower: 300 })).toEqual({
      error: "Easy power must be below marathon power",
    });
    expect(validatePowerZoneDefaults({ hasPower: true, thresholdPower: 300, marathonPower: 300 })).toEqual({
      error: "Threshold power must be above marathon power",
    });
    expect(validatePowerZoneDefaults({ hasPower: false, easyPower: 300, marathonPower: 300 })).toEqual({
      defaults: { hasPower: false, easyPower: 300, marathonPower: 300, thresholdPower: null },
    });
  });
});

describe("parsePowerZoneDefaults", () => {
  it("round-trips stored jsonb and rejects unusable shapes", () => {
    expect(parsePowerZoneDefaults(DEFAULTS)).toEqual(DEFAULTS);
    expect(parsePowerZoneDefaults({ ...DEFAULTS, easyPower: null })).toEqual({ ...DEFAULTS, easyPower: null });
    expect(parsePowerZoneDefaults(null)).toBeNull();
    expect(parsePowerZoneDefaults("{}")).toBeNull();
    expect(parsePowerZoneDefaults({ marathonPower: 300 })).toBeNull();
    expect(parsePowerZoneDefaults({ hasPower: true, marathonPower: "300" })).toBeNull();
  });
});

describe("applyPowerZoneDefaults", () => {
  it("writes anchors and the power flag onto a profile", () => {
    const profile = applyPowerZoneDefaults(makeProfile(), DEFAULTS);

    expect(profile.hasAppleWatchPower).toBe(true);
    expect(profile.appleWatchPowerData).toEqual({
      easyPower: 240,
      marathonPower: 300,
      thresholdPower: 336,
    });
  });

  it("clears power settings when the defaults are disabled or absent", () => {
    const anchored = makeProfile({
      hasAppleWatchPower: true,
      appleWatchPowerData: { easyPower: 240, marathonPower: 300, thresholdPower: 336 },
    });

    expect(applyPowerZoneDefaults(anchored, { ...DEFAULTS, hasPower: false })).toMatchObject({
      hasAppleWatchPower: false,
      appleWatchPowerData: undefined,
    });
    expect(applyPowerZoneDefaults(anchored, null)).toMatchObject({
      hasAppleWatchPower: false,
      appleWatchPowerData: undefined,
    });
  });
});

describe("mergePowerZoneDefaults", () => {
  it("fills a generated profile that asked for power but has no anchors", () => {
    const profile = mergePowerZoneDefaults(
      makeProfile({ hasAppleWatchPower: true, appleWatchPowerData: { easyPower: null, marathonPower: null, thresholdPower: null } }),
      DEFAULTS,
    );

    expect(profile.appleWatchPowerData).toEqual({ easyPower: 240, marathonPower: 300, thresholdPower: 336 });
  });

  it("keeps explicit profile anchors and honors a disabled power choice", () => {
    const explicit = mergePowerZoneDefaults(
      makeProfile({ hasAppleWatchPower: true, appleWatchPowerData: { easyPower: 200, marathonPower: 280, thresholdPower: 320 } }),
      DEFAULTS,
    );
    const disabled = mergePowerZoneDefaults(makeProfile({ hasAppleWatchPower: false }), DEFAULTS);
    const noDefaults = mergePowerZoneDefaults(makeProfile({ hasAppleWatchPower: true }), null);

    expect(explicit.appleWatchPowerData).toEqual({ easyPower: 200, marathonPower: 280, thresholdPower: 320 });
    expect(disabled.hasAppleWatchPower).toBe(false);
    expect(noDefaults.hasAppleWatchPower).toBe(true);
    expect(noDefaults.appleWatchPowerData).toBeUndefined();
  });
});