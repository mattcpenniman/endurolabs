// ============================================================
// EnduroLab - Canonical Race Result Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { isPredictionEligibleRaceResult, parseNewRaceResult } from "@/lib/races/results";

describe("canonical race results", () => {
  it("normalizes a valid official finish", () => {
    expect(parseNewRaceResult({
      raceName: "City Marathon",
      raceDate: "2026-10-04",
      officialDistanceMeters: 42_195,
      chipTimeSeconds: 10_800,
      status: "finish",
      verificationStatus: "verified",
      classification: "official",
      predictionExcluded: false,
      temperatureCelsius: 18.5,
      elevationGainMeters: 0,
      placing: 42,
    })).toMatchObject({
      raceName: "City Marathon",
      source: "manual",
      chipTimeSeconds: 10_800,
      gunTimeSeconds: null,
      verificationStatus: "verified",
      temperatureCelsius: 18.5,
      elevationGainMeters: 0,
      placing: 42,
    });
  });

  it("records predeclared prediction classifications and notes", () => {
    expect(parseNewRaceResult({
      raceName: "Pacing assignment",
      raceDate: "2026-10-04",
      officialDistanceMeters: 21_097.5,
      chipTimeSeconds: 7200,
      status: "finish",
      classification: "pacing_duty",
      predictionExcluded: true,
      notes: "Led the 2-hour pace group",
    })).toMatchObject({
      classification: "pacing_duty",
      predictionExcluded: true,
      notes: "Led the 2-hour pace group",
    });
    expect(() => parseNewRaceResult({
      raceName: "Invalid classification",
      raceDate: "2026-10-04",
      officialDistanceMeters: 5000,
      chipTimeSeconds: 1200,
      status: "finish",
      classification: "ignored-after-bad-race",
    })).toThrow("classification is invalid");
  });

  it("only admits official, completed, non-excluded outcomes to forecasts", () => {
    const official = parseNewRaceResult({
      raceName: "Official 10K",
      raceDate: "2026-10-04",
      officialDistanceMeters: 10_000,
      chipTimeSeconds: 2400,
      status: "finish",
    });
    expect(isPredictionEligibleRaceResult(official)).toBe(true);
    expect(isPredictionEligibleRaceResult({ ...official, classification: "training_race" })).toBe(false);
    expect(isPredictionEligibleRaceResult({ ...official, predictionExcluded: true })).toBe(false);
    expect(isPredictionEligibleRaceResult({ ...official, status: "dnf", chipTimeSeconds: null })).toBe(false);
  });

  it("rejects a finish without a finish time", () => {
    expect(() => parseNewRaceResult({
      raceName: "Incomplete result",
      raceDate: "2026-10-04",
      officialDistanceMeters: 5000,
      status: "finish",
    })).toThrow("A finish requires chipTimeSeconds or gunTimeSeconds");
  });

  it("allows DNF and DNS outcomes without inventing finish times", () => {
    expect(parseNewRaceResult({
      raceName: "Trail race",
      raceDate: "2026-10-04",
      officialDistanceMeters: 50_000,
      status: "dnf",
    }).chipTimeSeconds).toBeNull();
  });

  it("rejects normalized calendar dates and invalid placings", () => {
    expect(() => parseNewRaceResult({
      raceName: "Impossible date",
      raceDate: "2026-02-31",
      officialDistanceMeters: 5000,
      chipTimeSeconds: 1200,
      status: "finish",
    })).toThrow("raceDate must be a valid YYYY-MM-DD date");
    expect(() => parseNewRaceResult({
      raceName: "Fractional place",
      raceDate: "2026-02-28",
      officialDistanceMeters: 5000,
      chipTimeSeconds: 1200,
      status: "finish",
      placing: 1.5,
    })).toThrow("placing must be an integer");
  });
});
