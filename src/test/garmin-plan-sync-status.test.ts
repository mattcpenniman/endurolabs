/** Saved export comparisons cover dates, prescription edits, targets, doubles and checkpoints. */
import { describe, expect, it } from "vitest";
import { buildPlanSyncReport, plannedWorkoutVersion, type SavedWorkoutExport } from "@/lib/garmin/plan-sync-status";
import type { MarathonPlan, Workout } from "@/lib/training/models";

const workout: Workout = { id: "run-1", type: "easy", title: "Easy", description: "Easy run", totalDistance: 5,
  estimatedDuration: 40, weeklyMileageContribution: 5, intensityCategory: "easy",
  segments: [{ type: "easy", distance: 5, pace: 8, power: 250, description: "Easy" }] };
const date = "2027-02-16";
function plan(run = workout, when = date, secondaryWorkout?: Workout): MarathonPlan {
  return { weeks: [{ days: [{ date: when, workout: run, secondaryWorkout, isRestDay: false }] }] } as MarathonPlan;
}
function saved(): SavedWorkoutExport {
  return { source_workout_id: workout.id, updated_at: "2026-10-25T12:00:00Z", state: {
    confirmed: { ...plannedWorkoutVersion("user", "plan", workout, date, false, "pace", {}), workoutId: 42 },
  } };
}
describe("Garmin full-plan status", () => {
  it("marks pre-cadence confirmed exports changed while preserving their Garmin identity", () => {
    const legacy = plannedWorkoutVersion("user", "plan", workout, date, false, "pace", {}, false, false);
    const row: SavedWorkoutExport = { source_workout_id: workout.id, updated_at: new Date(), state: { confirmed: { ...legacy, workoutId: 42 } } };
    expect(buildPlanSyncReport("user", "plan", plan(), [row], "pace").entries[0]).toMatchObject({ status: "changed", url: expect.stringContaining("/42") });
    const current = plannedWorkoutVersion("user", "plan", workout, date, false, "pace", row.state);
    expect(current.payload.workoutName).toBe(legacy.payload.workoutName);
    expect(current.payload.workoutSegments[0].workoutSteps[0].secondaryTargetValueOne).toBe(180);
  });
  it.each([false, true])("reconciles pre-cadence unknown writes before changing targets (double day: %s)", (doubleDay) => {
    const legacy = plannedWorkoutVersion("user", "plan", workout, date, false, "pace", {}, doubleDay, false);
    for (const state of [
      { creation: { phase: "creating" as const, fingerprint: legacy.fingerprint } },
      { confirmed: { ...legacy, workoutId: 42 }, pending: { ...legacy, phase: "updating" as const } },
    ]) {
      expect(plannedWorkoutVersion("user", "plan", workout, date, false, "pace", state, true)).toEqual(legacy);
    }
  });
  it("reports persisted verified status and compares executable changes rather than object key order", () => {
    const row = saved();
    const reordered = Object.fromEntries(Object.entries(workout).reverse()) as unknown as Workout;
    expect(buildPlanSyncReport("user", "plan", plan(reordered), [row], "pace").entries[0]).toMatchObject({
      status: "synced", syncedAt: "2026-10-25T12:00:00.000Z", url: "https://connect.garmin.com/modern/workout/42",
    });
    for (const changed of [plan({ ...workout, title: "Edited" }), plan(workout, "2027-02-18"),
      plan({ ...workout, segments: [{ ...workout.segments[0], distance: 6 }] })]) {
      expect(buildPlanSyncReport("user", "plan", changed, [row], "pace").entries[0].status).toBe("changed");
    }
    expect(buildPlanSyncReport("user", "plan", plan(), [row], "power").entries[0].status).toBe("changed");
  });
  it("lists primary before secondary and labels both Garmin payloads by their intended order", () => {
    const secondary = { ...workout, id: "run-2" };
    const report = buildPlanSyncReport("user", "plan", plan(workout, date, secondary), [], "pace");
    expect(report.entries.map((entry) => entry.workout.id)).toEqual(["run-1", "run-2"]);
    expect(plannedWorkoutVersion("user", "plan", workout, date, false, "pace", {}, true).payload.workoutName).toContain("AM / first");
    expect(plannedWorkoutVersion("user", "plan", secondary, date, true, "pace", {}, true).payload.workoutName).toContain("PM / second");
  });
  it("reports unknown writes as unresolved and retains the last verified time", () => {
    const row = saved();
    row.state.confirmed!.verifiedAt = "2026-10-24T12:00:00Z";
    row.state.pending = { ...row.state.confirmed!, phase: "moving" };
    expect(buildPlanSyncReport("user", "plan", plan(), [row], "pace").entries[0]).toMatchObject({ status: "unresolved", syncedAt: "2026-10-24T12:00:00Z" });
    row.state = { creation: { phase: "creating", fingerprint: "unknown" } };
    expect(buildPlanSyncReport("user", "plan", plan(), [row], "pace").entries[0].status).toBe("unresolved");
  });
  it("reconciles pre-label double-day checkpoints using the exact dispatched version", () => {
    const row = saved();
    const legacy = plannedWorkoutVersion("user", "plan", workout, date, false, "pace", {});
    const creation = { creation: { phase: "creating" as const, fingerprint: legacy.fingerprint } };
    expect(plannedWorkoutVersion("user", "plan", workout, date, false, "pace", creation, true)).toEqual(legacy);
    row.state.pending = { ...legacy, phase: "updating" };
    expect(plannedWorkoutVersion("user", "plan", workout, date, false, "pace", row.state, true)).toEqual(legacy);
  });
  it("skips non-running days and identifies removed exports without hiding remaining remote schedules", () => {
    const report = buildPlanSyncReport("user", "plan", plan({ ...workout, type: "rest" }), [saved()], "pace");
    expect(report).toEqual({ entries: [], removedExports: 1 });
  });
  it("preflights unsupported power prescriptions and ambiguous workout IDs", () => {
    const noPower = { ...workout, segments: [{ ...workout.segments[0], power: undefined }] };
    expect(buildPlanSyncReport("user", "plan", plan(noPower), [], "power").entries[0]).toMatchObject({ status: "unsupported", error: expect.stringContaining("no power") });
    expect(buildPlanSyncReport("user", "plan", plan(workout, date, workout), [], "pace").entries.every((entry) => entry.status === "unsupported")).toBe(true);
  });
});
