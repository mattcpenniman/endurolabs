/** Single-workout Garmin Connect publishing with durable write-ahead checkpoints. */
import type { GarminWorkoutPayload } from "./workout-export";

export interface WorkoutTransport {
  get<T>(url: string): Promise<T>;
  post<T>(url: string, body: unknown): Promise<T>;
}

export interface ExportCheckpoint {
  fingerprint: string;
  phase: "creating" | "created" | "scheduling" | "scheduled";
  workoutId?: number;
}

export interface ExportJournal {
  read(): Promise<ExportCheckpoint | null>;
  save(checkpoint: ExportCheckpoint): Promise<void>;
}

const BASE = "https://connectapi.garmin.com/workout-service";

function remoteId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Garmin returned an invalid workout ID; reconcile before retrying");
  }
  return value;
}

interface RemoteWorkout {
  workoutId: number;
  workoutName: string;
  description?: string;
  workoutSegments?: GarminWorkoutPayload["workoutSegments"];
}

interface RemoteSchedule {
  workoutScheduleId: number;
  workout: { workoutId: number };
  calendarDate: string;
}

function scheduleMatches(item: RemoteSchedule, id: number, date: string): boolean {
  return item.workout?.workoutId === id && item.calendarDate?.slice(0, 10) === date;
}

/** Compare executable prescription fields; Garmin may add IDs and display metadata. */
export function verifyRemoteWorkout(remote: RemoteWorkout, payload: GarminWorkoutPayload): void {
  if (remote.workoutName !== payload.workoutName || remote.description !== payload.description ||
      remote.workoutSegments?.length !== payload.workoutSegments.length) {
    throw new Error("Garmin workout identity/content mismatch");
  }
  const actual = remote.workoutSegments.flatMap((segment) => segment.workoutSteps);
  const expected = payload.workoutSegments.flatMap((segment) => segment.workoutSteps);
  if (actual.length !== expected.length) throw new Error("Garmin workout step count mismatch");
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i], e = expected[i];
    if (a.type !== e.type || a.stepOrder !== e.stepOrder ||
        a.stepType?.stepTypeKey !== e.stepType.stepTypeKey ||
        a.endCondition?.conditionTypeKey !== e.endCondition.conditionTypeKey ||
        (e.endCondition.conditionTypeKey !== "lap.button" &&
          (Math.abs(a.endConditionValue - e.endConditionValue) > 0.01 || !Number.isFinite(a.endConditionValue))) ||
        a.targetType?.workoutTargetTypeKey !== e.targetType.workoutTargetTypeKey ||
        (a.secondaryTargetType?.workoutTargetTypeKey ?? "no.target") !==
          (e.secondaryTargetType?.workoutTargetTypeKey ?? "no.target") ||
        ["targetValueOne", "targetValueTwo", "secondaryTargetValueOne", "secondaryTargetValueTwo"].some((key) => {
          const field = key as "targetValueOne" | "targetValueTwo" | "secondaryTargetValueOne" | "secondaryTargetValueTwo";
          return e[field] !== undefined && (typeof a[field] !== "number" ||
            !Number.isFinite(a[field]) || Math.abs(a[field]! - e[field]!) > 0.001);
        })) throw new Error(`Garmin prescription mismatch at step ${i + 1}`);
  }
}

/** No POST retry. Unknown outcomes remain journaled and require positive readback. */
export async function publishGarminWorkout(
  transport: WorkoutTransport,
  journal: ExportJournal,
  payload: GarminWorkoutPayload,
  date: string,
  fingerprint: string,
): Promise<{ workoutId: number; date: string; reused: boolean; verified: true }> {
  let checkpoint = await journal.read();
  if (checkpoint && checkpoint.fingerprint !== fingerprint) {
    throw new Error("Prescription changed; use explicit reconciliation instead of replacing an export");
  }
  let id = checkpoint?.workoutId;
  const reused = checkpoint !== null;
  // Search the whole bounded library for the deterministic export name. This also
  // protects reruns with a different journal path and reconciles an uncertain create.
  const matches: RemoteWorkout[] = [];
  let exhausted = false;
  for (let start = 0; start < 2000; start += 100) {
    const page = await transport.get<RemoteWorkout[]>(`${BASE}/workouts?start=${start}&limit=100`);
    if (!Array.isArray(page)) throw new Error("Garmin workout library response was not a list");
    matches.push(...page.filter((item) => item.workoutName === payload.workoutName));
    if (page.length < 100) { exhausted = true; break; }
  }
  if (!exhausted) throw new Error("Workout library exceeded scan limit; cannot establish uniqueness");
  if (matches.length > 1) throw new Error("Multiple matching exports; reconcile duplicates manually");
  if (matches.length === 1) {
    const found = remoteId(matches[0].workoutId);
    if (id !== undefined && id !== found) throw new Error("Journal and remote identity disagree");
    id = found;
  }
  if (id === undefined) {
    if (checkpoint) throw new Error("Previous create outcome is unknown; do not retry automatically");
    checkpoint = { fingerprint, phase: "creating" };
    await journal.save(checkpoint);
    const created = await transport.post<RemoteWorkout>(`${BASE}/workout`, payload);
    id = remoteId(created.workoutId);
    checkpoint = { fingerprint, phase: "created", workoutId: id };
    await journal.save(checkpoint);
  }
  const remote = await transport.get<RemoteWorkout>(`${BASE}/workout/${id}`);
  if (remote.workoutId !== id) throw new Error("Garmin readback returned a different workout ID");
  verifyRemoteWorkout(remote, payload);
  const schedules = await transport.get<RemoteSchedule[]>(
    `${BASE}/schedule/workoutScheduleByPeriod?startDate=${date}&endDate=${date}`,
  );
  if (!Array.isArray(schedules)) throw new Error("Garmin schedule response was not a list");
  const scheduled = schedules.some((item) => scheduleMatches(item, id, date));
  if (!scheduled) {
    if (checkpoint?.phase === "scheduling" || checkpoint?.phase === "scheduled") {
      throw new Error("Previous scheduling outcome is unresolved; do not retry automatically");
    }
    await journal.save({ fingerprint, phase: "scheduling", workoutId: id });
    await transport.post(`${BASE}/schedule/${id}`, { date });
    const readback = await transport.get<RemoteSchedule[]>(
      `${BASE}/schedule/workoutScheduleByPeriod?startDate=${date}&endDate=${date}`,
    );
    if (!Array.isArray(readback) || !readback.some((item) => scheduleMatches(item, id, date))) {
      throw new Error("Garmin schedule not yet confirmed; reconcile before retrying");
    }
  }
  await journal.save({ fingerprint, phase: "scheduled", workoutId: id });
  return { workoutId: id, date, reused: reused || matches.length > 0, verified: true };
}
