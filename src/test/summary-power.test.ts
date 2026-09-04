// ============================================================
// EnduroLab - Summary Power Resolution Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { resolveSummaryPower } from "@/lib/activities/serialize";

describe("resolveSummaryPower", () => {
  it("prefers Garmin power over calculated power", () => {
    expect(resolveSummaryPower({
      averagePower: 310,
      calculatedPower: 295,
      powerSource: "garmin",
    })).toMatchObject({
      garminPower: 310,
      calculatedPower: 295,
      averagePower: 310,
      averagePowerEstimated: false,
      displayPowerSource: "garmin",
    });
  });

  it("falls back to calculated power", () => {
    expect(resolveSummaryPower({
      averagePower: null,
      calculatedPower: 295,
      powerSource: "garmin",
    })).toMatchObject({
      garminPower: null,
      calculatedPower: 295,
      averagePower: 295,
      averagePowerEstimated: true,
      displayPowerSource: "estimated_speed_v1",
    });
  });

  it("reads the previous overloaded representation during migration", () => {
    expect(resolveSummaryPower({
      averagePower: 295,
      calculatedPower: null,
      powerSource: "estimated_speed_v1",
    })).toMatchObject({
      garminPower: null,
      calculatedPower: 295,
      averagePower: 295,
      averagePowerEstimated: true,
    });
  });
});
