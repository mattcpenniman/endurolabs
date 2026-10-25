/** Saved-plan export identity and durable Garmin sync status (server only). */
import { createHash } from "node:crypto";
import { mapGarminWorkout, workoutCalendarDate } from "./workout-export";
import type { WorkoutSyncState, WorkoutSyncVersion } from "./workout-sync";
import type { MarathonPlan, Workout } from "../training/models";

export interface PlanSyncEntry {
  workout: Workout;
  date: string;
  status: "synced" | "changed" | "not_synced" | "unresolved" | "unsupported";
  syncedAt?: string;
  url?: string;
  error?: string;
}
export interface PlanSyncReport {
  entries: PlanSyncEntry[];
  removedExports: number;
}
export interface SavedWorkoutExport {
  source_workout_id: string;
  state: WorkoutSyncState;
  updated_at: string | Date;
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function plannedWorkoutVersion(userId: string, planId: string, workout: Workout,
  date: string, secondary: boolean, target: "pace" | "power", state: WorkoutSyncState,
  doubleDay = false, cadence = true, strides = true): WorkoutSyncVersion {
  const key = state.confirmed?.payload.description.split("\n")[0].replace("EnduroLab export ", "") ??
    digest([userId, planId, date, secondary, workout.id]).slice(0, 16);
  const payload = mapGarminWorkout(workout, {
    name: `EL ${date} ${doubleDay ? secondary ? "PM / second · " : "AM / first · " : ""}${workout.title.slice(0, 50)} [${key}]`,
    marker: `EnduroLab export ${key}`, target, cadence, strides,
  });
  const fingerprint = digest({ payload, date });
  payload.description += `\nSHA256 ${fingerprint}`;
  // New labels/targets must not strand an older write whose outcome is unknown.
  const unresolved = state.pending?.fingerprint ?? state.creation?.fingerprint;
  if (unresolved && unresolved !== fingerprint) {
    if (doubleDay) {
      const legacy = plannedWorkoutVersion(userId, planId, workout, date, secondary, target, state, false, cadence, strides);
      if (legacy.fingerprint === unresolved) return legacy;
    }
    if (cadence) {
      const legacy = plannedWorkoutVersion(userId, planId, workout, date, secondary, target, state, doubleDay, false, strides);
      if (legacy.fingerprint === unresolved) return legacy;
    }
    if (strides) {
      const legacy = plannedWorkoutVersion(userId, planId, workout, date, secondary, target, state, doubleDay, cadence, false);
      if (legacy.fingerprint === unresolved) return legacy;
    }
  }
  return { payload, date, fingerprint };
}

export function buildPlanSyncReport(userId: string, planId: string, plan: MarathonPlan,
  exports: SavedWorkoutExport[], target: "pace" | "power"): PlanSyncReport {
  const ids = new Set<string>();
  const entries: PlanSyncEntry[] = [];
  for (const week of plan.weeks) for (const day of week.days) {
    for (const secondary of [false, true]) {
      const workout = secondary ? day.secondaryWorkout : day.workout;
      if (day.isRestDay || !workout || ["rest", "strength", "cross_training"].includes(workout.type)) continue;
      ids.add(workout.id);
      const saved = exports.find((row) => row.source_workout_id === workout.id);
      const state = saved?.state ?? {};
      const entry: PlanSyncEntry = { workout, date: day.date.slice(0, 10), status: "not_synced" };
      if (state.confirmed) {
        entry.url = `https://connect.garmin.com/modern/workout/${state.confirmed.workoutId}`;
        entry.syncedAt = state.confirmed.verifiedAt ?? (!state.pending && saved
          ? new Date(saved.updated_at).toISOString() : undefined);
      }
      try {
        const desired = plannedWorkoutVersion(userId, planId, workout, workoutCalendarDate(day.date), secondary, target, state,
          Boolean(day.secondaryWorkout && !["rest", "strength", "cross_training"].includes(day.secondaryWorkout.type)));
        entry.status = state.pending || state.creation ? "unresolved"
          : !state.confirmed ? "not_synced"
          : state.confirmed.fingerprint === desired.fingerprint ? "synced" : "changed";
      } catch (error) {
        entry.status = "unsupported";
        entry.error = error instanceof Error ? error.message : "Unsupported prescription";
      }
      entries.push(entry);
    }
  }
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.workout.id, (counts.get(entry.workout.id) ?? 0) + 1);
  for (const entry of entries) if (counts.get(entry.workout.id)! > 1) {
    entry.status = "unsupported";
    entry.error = "Saved workout ID is ambiguous. Reload or repair the plan before syncing.";
  }
  return { entries, removedExports: exports.filter((row) => !ids.has(row.source_workout_id)).length };
}
