// ============================================================
// EnduroLab — Display Unit Preference Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIT_SYSTEM,
  elevationMetersForDisplay,
  feetPerMileToMetersPerKm,
  formatAltitude,
  formatElevationFeet,
  formatElevationGain,
  formatGrade,
  formatPaceForSystem,
  formatPaceMinutes,
  formatPaceWithUnit,
  gradeForDisplay,
  paceMinPerMileForDisplay,
  parseUnitSystem,
  secondsPerMileForDisplay,
} from "@/lib/units/format";

describe("parseUnitSystem", () => {
  it("accepts the two stored values", () => {
    expect(parseUnitSystem("imperial")).toBe("imperial");
    expect(parseUnitSystem("metric")).toBe("metric");
  });

  it("rejects anything else", () => {
    expect(parseUnitSystem("nautical")).toBeNull();
    expect(parseUnitSystem(null)).toBeNull();
    expect(parseUnitSystem(undefined)).toBeNull();
  });

  it("defaults to imperial", () => {
    expect(DEFAULT_UNIT_SYSTEM).toBe("imperial");
  });
});

describe("pace conversions", () => {
  it("keeps min/mile unchanged for imperial", () => {
    expect(paceMinPerMileForDisplay(9.5, "imperial")).toBe(9.5);
    expect(secondsPerMileForDisplay(400, "imperial")).toBe(400);
  });

  it("divides by 1.609344 for metric", () => {
    expect(paceMinPerMileForDisplay(9.0, "metric")).toBeCloseTo(5.5923, 4);
    expect(secondsPerMileForDisplay(400, "metric")).toBeCloseTo(248.55, 1);
  });

  it("formats pace values with the unit carry at 60 seconds", () => {
    expect(formatPaceMinutes(9)).toBe("9:00");
    expect(formatPaceMinutes(9.999999)).toBe("10:00");
    expect(formatPaceForSystem(9.0, "imperial")).toBe("9:00");
    expect(formatPaceForSystem(9.0, "metric")).toBe("5:36");
  });

  it("keeps a negative delta signed", () => {
    expect(formatPaceMinutes(-9.5)).toBe("-9:30");
  });

  it("renders pace with the unit suffix and handles null", () => {
    expect(formatPaceWithUnit(9.0, "imperial")).toBe("9:00 /mi");
    expect(formatPaceWithUnit(9.0, "metric")).toBe("5:36 /km");
    expect(formatPaceWithUnit(null, "metric")).toBe("--");
  });
});

describe("elevation conversions", () => {
  it("converts stored meters to display feet for imperial", () => {
    expect(elevationMetersForDisplay(100, "imperial")).toBeCloseTo(328.08, 1);
    expect(elevationMetersForDisplay(100, "metric")).toBe(100);
  });

  it("formats elevation gain from meters", () => {
    expect(formatElevationGain(1609.344, "imperial")).toBe("5,280 ft");
    expect(formatElevationGain(1609.344, "metric")).toBe("1,609 m");
    expect(formatElevationGain(null, "imperial")).toBe("--");
  });

  it("formats elevation already stored in feet", () => {
    expect(formatElevationFeet(5280, "imperial")).toBe("5,280 ft");
    expect(formatElevationFeet(5280, "metric")).toBe("1,609 m");
    expect(formatElevationFeet(null, "metric")).toBe("--");
  });

  it("formats altitude with decimals only in metric", () => {
    expect(formatAltitude(100.12, "metric")).toBe("100.1 m");
    expect(formatAltitude(100.05, "imperial")).toBe("328 ft");
    expect(formatAltitude(null, "imperial")).toBe("--");
  });
});

describe("grade conversions", () => {
  it("converts feet-per-mile to meters-per-kilometre", () => {
    expect(feetPerMileToMetersPerKm(5280)).toBeCloseTo(1000, 6);
    expect(gradeForDisplay(85, "metric")).toBeCloseTo(16.1, 1);
    expect(gradeForDisplay(85, "imperial")).toBe(85);
  });

  it("formats grade with the matching unit label", () => {
    expect(formatGrade(85, "imperial")).toBe("85 ft/mi");
    expect(formatGrade(85, "metric")).toBe("16 m/km");
    expect(formatGrade(null, "metric")).toBe("--");
  });
});
