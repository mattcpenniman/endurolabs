/** Durable, readback-verified updates to one previously exported Garmin workout. */
import { publishGarminWorkout, verifyRemoteWorkout } from "./workout-publisher";
import type { ExportCheckpoint, WorkoutTransport } from "./workout-publisher";
import type { GarminWorkoutPayload } from "./workout-export";

export interface WorkoutSyncTransport extends WorkoutTransport {
  put<T>(url: string, body: unknown): Promise<T>;
}
export interface WorkoutSyncVersion {
  payload: GarminWorkoutPayload;
  date: string;
  fingerprint: string;
}
export interface WorkoutSyncState {
  creation?: ExportCheckpoint;
  confirmed?: WorkoutSyncVersion & { workoutId: number; verifiedAt?: string };
  pending?: WorkoutSyncVersion & { phase: "updating" | "moving" };
}
export interface WorkoutSyncJournal {
  read(): Promise<WorkoutSyncState>;
  save(state: WorkoutSyncState): Promise<void>;
}
interface Schedule {
  workoutScheduleId: number;
  workout: { workoutId: number };
  calendarDate: string;
}
const BASE = "https://connectapi.garmin.com/workout-service";

/** Unknown writes are reconciled by GET, never automatically replayed. */
export async function syncGarminWorkout(
  transport: WorkoutSyncTransport,
  journal: WorkoutSyncJournal,
  desired: WorkoutSyncVersion,
): Promise<{ workoutId: number; date: string; verified: true }> {
  let state = await journal.read();
  const save = async (next: WorkoutSyncState): Promise<void> => {
    await journal.save(next);
    state = next;
  };
  if (!state.confirmed) {
    const result = await publishGarminWorkout(transport, {
      read: async () => state.creation ?? null,
      save: async (creation) => save({ ...state, creation }),
    }, desired.payload, desired.date, desired.fingerprint);
    await save({ confirmed: { ...desired, workoutId: result.workoutId, verifiedAt: new Date().toISOString() } });
    return result;
  }
  const previous = state.confirmed;
  const id = previous.workoutId;
  if (state.pending && state.pending.fingerprint !== desired.fingerprint) {
    throw new Error("A previous sync is unresolved. Restore that version and sync before making further changes.");
  }
  const remote = await transport.get<GarminWorkoutPayload & { workoutId: number }>(`${BASE}/workout/${id}`);
  if (remote.workoutId !== id) throw new Error("Garmin returned a different workout ID");
  let matchesDesired = false;
  try { verifyRemoteWorkout(remote, desired.payload); matchesDesired = true; } catch { /* Compare last confirmed version below. */ }
  if (!matchesDesired) {
    verifyRemoteWorkout(remote, previous.payload);
    if (state.pending) throw new Error("Previous workout update is unresolved; reconcile in Garmin before retrying.");
    await save({ ...state, pending: { ...desired, phase: "updating" } });
    await transport.put(`${BASE}/workout/${id}`, { ...desired.payload, workoutId: id });
    const updated = await transport.get<GarminWorkoutPayload & { workoutId: number }>(`${BASE}/workout/${id}`);
    if (updated.workoutId !== id) throw new Error("Garmin returned a different workout ID");
    verifyRemoteWorkout(updated, desired.payload);
  }
  const schedules = async (date: string): Promise<Schedule[]> => {
    const rows = await transport.get<Schedule[]>(`${BASE}/schedule/workoutScheduleByPeriod?startDate=${date}&endDate=${date}`);
    if (!Array.isArray(rows)) throw new Error("Invalid Garmin schedule response");
    const matches = rows.filter((row) => row.workout?.workoutId === id && row.calendarDate?.slice(0, 10) === date);
    if (matches.length > 1 || matches.some((row) => !Number.isSafeInteger(row.workoutScheduleId) || row.workoutScheduleId <= 0)) {
      throw new Error("Ambiguous Garmin schedule; reconcile in Garmin before retrying.");
    }
    return matches;
  };
  if (!(await schedules(desired.date)).length) {
    if (state.pending?.phase === "moving" ||
        previous.fingerprint === desired.fingerprint) {
      throw new Error("Previous schedule is unresolved; reconcile in Garmin before retrying.");
    }
    const old = previous.date !== desired.date ? await schedules(previous.date) : [];
    if (old.length) {
      const scheduleId = old[0].workoutScheduleId;
      const current = await transport.get<Schedule>(`${BASE}/schedule/${scheduleId}`);
      if (current.workoutScheduleId !== scheduleId || current.workout?.workoutId !== id ||
          current.calendarDate?.slice(0, 10) !== previous.date) throw new Error("Garmin schedule changed outside EnduroLab");
      await save({ ...state, pending: { ...desired, phase: "moving" } });
      await transport.put(`${BASE}/schedule/${scheduleId}`, {
        ...current, calendarDate: desired.date, workout: { workoutId: id },
      });
    } else {
      // A confirmed schedule disappearing externally is not permission to create another.
      throw new Error("Previous Garmin schedule is missing; reconcile in Garmin before retrying.");
    }
    if (!(await schedules(desired.date)).length) throw new Error("Garmin schedule not yet confirmed. Sync again to reconcile.");
  }
  if (previous.date !== desired.date) {
    if ((await schedules(previous.date)).length) throw new Error("Old Garmin date remains; reconcile in Garmin before retrying.");
  }
  await save({ confirmed: { ...desired, workoutId: id, verifiedAt: new Date().toISOString() } });
  return { workoutId: id, date: desired.date, verified: true };
}
