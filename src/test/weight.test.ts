import { describe, expect, it } from "vitest";
import { kilogramsToPounds, poundsToKilograms } from "@/lib/profile/weight";

describe("body weight conversions", () => {
  it("converts pounds to kilograms", () => {
    expect(poundsToKilograms(165)).toBeCloseTo(74.8427, 4);
  });

  it("round trips kilograms and pounds", () => {
    expect(kilogramsToPounds(poundsToKilograms(165))).toBeCloseTo(165, 8);
  });
});
