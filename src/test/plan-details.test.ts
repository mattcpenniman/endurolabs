/** Saved-plan inspection keeps source prescriptions intact and calendar dates stable. */
import { describe, expect, it } from "vitest";
import { selectPlanDetails } from "../../scripts/plan-details.mjs";

const primary = { id: "primary", segments: [{ distance: 4.75, pace: 6.87 }] };
const secondary = { id: "secondary", segments: [{ distance: 4.75, pace: 8.1 }] };
const plan = {
  paceZones: { marathon: 6.87 },
  weeks: [{ weekNumber: 16, days: [{ date: "2027-02-16T00:00:00.000Z", workout: primary, secondaryWorkout: secondary }] }],
};

describe("plan details", () => {
  it("decodes legacy JSONB without regenerating a prescription", () => {
    expect(selectPlanDetails(JSON.stringify(plan))).toEqual(plan);
  });
  it("selects the exact calendar day including doubles and zones", () => {
    const before = JSON.stringify(plan);
    expect(selectPlanDetails(plan, { date: "2027-02-16" })).toEqual({
      date: "2027-02-16", day: plan.weeks[0].days[0], paceZones: plan.paceZones,
    });
    expect(JSON.stringify(plan)).toBe(before);
  });
  it("selects by stored weekNumber rather than array position", () => {
    expect(selectPlanDetails(plan, { week: "16" })).toEqual({ week: plan.weeks[0], paceZones: plan.paceZones });
    expect(() => selectPlanDetails(plan, { week: "1" })).toThrow("no week");
  });
  it("rejects invalid, missing, duplicate, or conflicting selections", () => {
    for (const date of ["2027-02-30", "2027-13-01", "2027-2-16", "2027-02-17"]) {
      expect(() => selectPlanDetails(plan, { date })).toThrow();
    }
    expect(() => selectPlanDetails(plan, { week: "0" })).toThrow();
    expect(() => selectPlanDetails(plan, { date: "2027-02-16", week: "16" })).toThrow();
    expect(() => selectPlanDetails({ weeks: [plan.weeks[0], plan.weeks[0]] }, { date: "2027-02-16" })).toThrow();
    expect(() => selectPlanDetails({})).toThrow();
  });
});
