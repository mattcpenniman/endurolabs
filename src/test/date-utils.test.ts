import { describe, expect, it } from "vitest";
import { formatPlanDate } from "@/lib/training/date-utils";

describe("formatPlanDate", () => {
  it("does not display Monday, Aug 31 as Aug 30", () => {
    expect(formatPlanDate("2026-08-31T00:00:00.000Z")).toBe("Aug 31");
  });
});
